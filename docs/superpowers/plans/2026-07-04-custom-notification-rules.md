# カスタム通知ルール Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サブスクライバーが締切通知のタイミング（全体しきい値＋コース別上書き/ミュート）をダッシュボードで設定でき、背景ワーカーがそれに従って通知する。無料/失効ユーザーは固定1h/3h/24h。

**Architecture:** 通知ルールは1つのJSONで`chrome.storage.local`に保存し、純粋関数モジュール`src/background/notificationRules.ts`で解決ロジックを実装（テスト可能に切り出し）。背景ワーカー`checkDeadlineWarningNotifications`がこれを使う。サーバー`user_settings`にJSONカラム＋専用タイムスタンプを追加し、`syncToServer`のpushとログイン/ダッシュボード起動時のpull（last-write-wins）でクロスデバイス同期する。UIはダッシュボードのサブスク限定ブロック内に追加。

**Tech Stack:** TypeScript, Vite, Vitest（`pnpm exec vitest run <path>`）, React 19, Node.js/Express + better-sqlite3 API（`cd api && npx jest`）, Chrome Extension MV3 service worker。

## Global Constraints

- 対象worktree/branch: `C:\dev\lms-task-watcher`（branch develop）。全タスクをここで作業する
- パッケージマネージャは pnpm。拡張のテストは `pnpm exec vitest run <path>`、ビルドは `pnpm build`、型は `pnpm exec tsc -b`。APIのテストは `cd api && npx jest <path>`
- 既存無料機能のダウングレード禁止。無料/失効ユーザーは固定しきい値 `[1, 3, 24]`（時間）で従来通り通知する
- 通知重複防止キーは現行形式 `{id}:{N}h` を踏襲（Nは任意時間）
- 通知ルールのタイムスタンプはクライアント供給のISO（`new Date().toISOString()`）で統一。サーバーは受け取った値をそのまま保存し、GETで同じ文字列を返す（LWW比較は全てISO文字列同士）
- サブスク関連のアップセルUIには「快適装備＋開発支援」の位置づけを文面に明記する（上位方針 `2026-07-04-free-first-strategy-design.md`）
- コミットのフッタは `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- background（service worker）はchrome API依存で単体テストしない。ロジックは純粋関数側で網羅し、背景改修は `tsc`＋`build` で検証する

## File Structure

- Create: `src/background/notificationRules.ts` — 型定義＋純粋関数（`resolveThresholds` / `pickThresholdToNotify` / `DEFAULT_THRESHOLDS`）
- Create: `src/background/notificationRules.test.ts` — 上記のvitestテスト
- Modify: `api/db/sqlite.js` — `user_settings` に2カラム追加（PRAGMAチェックのALTER）
- Modify: `api/routes/user.js` — `POST`/`GET /api/user/settings` 拡張
- Modify: `api/tests/user.test.js` — settingsエンドポイントの通知ルールテスト追加
- Modify: `src/core/premium.ts` — ルールのgetter/setter、`syncToServer`拡張、`pullSettingsFromServer`追加
- Modify: `src/core/premium.test.ts` — 上記テスト追加
- Modify: `src/background/index.ts` — `checkDeadlineWarningNotifications` をルール適用に改修
- Modify: `src/App.tsx` — 通知タイミング設定UI（全体＋コース別）とpull呼び出し
- Modify: `src/App.css` — 設定UIのスタイル

---

### Task 1: API スキーマ＋設定エンドポイント拡張

**Files:**
- Modify: `api/db/sqlite.js`
- Modify: `api/routes/user.js`
- Test: `api/tests/user.test.js`

**Interfaces:**
- Produces: `POST /api/user/settings` が `{ theme?, notificationRules?, notificationRulesUpdatedAt? }` を受理。`GET /api/user/settings` が `{ theme, notificationRules, notificationRulesUpdatedAt }` を返す（Task 3が消費）

- [ ] **Step 1: スキーマにカラム追加**

`api/db/sqlite.js` の末尾、既存の `discord_user_id` 追加ブロックの後に追記:

```js
const settingsColumns = db.prepare("PRAGMA table_info(user_settings)").all()
if (!settingsColumns.some((col) => col.name === 'notification_rules')) {
  db.exec('ALTER TABLE user_settings ADD COLUMN notification_rules TEXT')
}
if (!settingsColumns.some((col) => col.name === 'notification_rules_updated_at')) {
  db.exec('ALTER TABLE user_settings ADD COLUMN notification_rules_updated_at TEXT')
}
```

- [ ] **Step 2: 失敗するテストを書く**

`api/tests/user.test.js` の `describe('GET /api/user/settings', ...)` ブロックの後（ファイル末尾の最後の `})` の前）に追加:

```js
describe('POST/GET /api/user/settings 通知ルール', () => {
  it('notificationRules と updatedAt をラウンドトリップする', async () => {
    const rules = { version: 1, defaultThresholds: [1, 3, 24, 48], courseOverrides: {} }
    const postRes = await request(app)
      .post('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ notificationRules: rules, notificationRulesUpdatedAt: '2026-07-04T10:00:00.000Z' })
    expect(postRes.status).toBe(200)

    const getRes = await request(app)
      .get('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.status).toBe(200)
    expect(getRes.body.notificationRules).toEqual(rules)
    expect(getRes.body.notificationRulesUpdatedAt).toBe('2026-07-04T10:00:00.000Z')
  })

  it('theme のみの POST では notification_rules_updated_at が変わらない', async () => {
    await request(app)
      .post('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ notificationRules: { version: 1, defaultThresholds: [1], courseOverrides: {} }, notificationRulesUpdatedAt: '2026-07-04T09:00:00.000Z' })

    await request(app)
      .post('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'dark' })

    const getRes = await request(app)
      .get('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.body.notificationRulesUpdatedAt).toBe('2026-07-04T09:00:00.000Z')
    expect(getRes.body.theme).toBe('dark')
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd api && npx jest tests/user.test.js -t "通知ルール"`
Expected: FAIL（現状のPOSTはnotificationRulesを保存しない/GETが返さない）

- [ ] **Step 4: エンドポイントを実装する**

`api/routes/user.js` の既存 `router.post('/settings', ...)` と `router.get('/settings', ...)` を次に置き換える:

```js
router.get('/settings', requireAuth, (req, res) => {
  const row = db.prepare(
    'SELECT theme, notification_rules, notification_rules_updated_at FROM user_settings WHERE user_id = ?'
  ).get(req.userId)

  return res.json({
    theme: row?.theme ?? 'default',
    notificationRules: row?.notification_rules ? JSON.parse(row.notification_rules) : null,
    notificationRulesUpdatedAt: row?.notification_rules_updated_at ?? null,
  })
})

router.post('/settings', requireAuth, (req, res) => {
  const { theme, notificationRules, notificationRulesUpdatedAt } = req.body

  if (theme !== undefined && typeof theme !== 'string') {
    return res.status(400).json({ error: 'theme は文字列である必要があります' })
  }
  if (notificationRules !== undefined && typeof notificationRules !== 'object') {
    return res.status(400).json({ error: 'notificationRules はオブジェクトである必要があります' })
  }

  db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(req.userId)

  if (theme !== undefined) {
    db.prepare(
      "UPDATE user_settings SET theme = ?, updated_at = datetime('now') WHERE user_id = ?"
    ).run(theme, req.userId)
  }

  if (notificationRules !== undefined) {
    db.prepare(
      'UPDATE user_settings SET notification_rules = ?, notification_rules_updated_at = ? WHERE user_id = ?'
    ).run(JSON.stringify(notificationRules), notificationRulesUpdatedAt ?? new Date().toISOString(), req.userId)
  }

  return res.json({ ok: true })
})
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd api && npx jest tests/user.test.js`
Expected: PASS（既存のtheme保存/取得テスト含め全件）

- [ ] **Step 6: 全APIスイート**

Run: `cd api && npx jest`
Expected: PASS（全スイート）

- [ ] **Step 7: コミット**

```bash
git add api/db/sqlite.js api/routes/user.js api/tests/user.test.js
git commit -m "feat(api): store notification rules in user_settings with dedicated timestamp"
```

---

### Task 2: 純粋関数モジュール notificationRules.ts

**Files:**
- Create: `src/background/notificationRules.ts`
- Test: `src/background/notificationRules.test.ts`

**Interfaces:**
- Produces:
  - `type NotificationRules = { version: 1; defaultThresholds: number[]; courseOverrides: Record<string, { muted: boolean; thresholds: number[] }> }`
  - `const DEFAULT_THRESHOLDS: number[]`（= `[1, 3, 24]`）
  - `resolveThresholds(rules: NotificationRules | null, courseId: string, subscriptionActive: boolean): number[] | null`
  - `pickThresholdToNotify(diffMs: number, thresholds: number[], targetId: string, notifiedKeys: Set<string>): { thresholdHours: number; notifyKey: string } | null`
  - これらを Task 3（型）・Task 4（関数）が消費

- [ ] **Step 1: 失敗するテストを書く**

`src/background/notificationRules.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THRESHOLDS,
  resolveThresholds,
  pickThresholdToNotify,
  type NotificationRules,
} from './notificationRules'

const rules: NotificationRules = {
  version: 1,
  defaultThresholds: [1, 3, 24],
  courseOverrides: {
    'course-early': { muted: false, thresholds: [24, 48, 72] },
    'course-muted': { muted: true, thresholds: [1] },
  },
}

describe('resolveThresholds', () => {
  it('サブスク非activeなら常にデフォルト', () => {
    expect(resolveThresholds(rules, 'course-early', false)).toEqual(DEFAULT_THRESHOLDS)
  })
  it('activeでルール無しならデフォルト', () => {
    expect(resolveThresholds(null, 'course-x', true)).toEqual(DEFAULT_THRESHOLDS)
  })
  it('activeで上書きありならその値', () => {
    expect(resolveThresholds(rules, 'course-early', true)).toEqual([24, 48, 72])
  })
  it('activeでミュートならnull', () => {
    expect(resolveThresholds(rules, 'course-muted', true)).toBeNull()
  })
  it('activeで当該コースに上書き無しならdefaultThresholds', () => {
    expect(resolveThresholds(rules, 'course-none', true)).toEqual([1, 3, 24])
  })
})

describe('pickThresholdToNotify', () => {
  const HOUR = 60 * 60 * 1000
  it('diff内の最小の未通知しきい値を返す', () => {
    const r = pickThresholdToNotify(2 * HOUR, [1, 3, 24], 'a1', new Set())
    expect(r).toEqual({ thresholdHours: 3, notifyKey: 'a1:3h' })
  })
  it('最小しきい値が通知済みなら次を返す', () => {
    const r = pickThresholdToNotify(2 * HOUR, [1, 3, 24], 'a1', new Set(['a1:3h']))
    expect(r).toEqual({ thresholdHours: 24, notifyKey: 'a1:24h' })
  })
  it('全て通知済みならnull', () => {
    const r = pickThresholdToNotify(2 * HOUR, [1, 3, 24], 'a1', new Set(['a1:3h', 'a1:24h']))
    expect(r).toBeNull()
  })
  it('どのしきい値にも入らなければnull', () => {
    const r = pickThresholdToNotify(100 * HOUR, [1, 3, 24], 'a1', new Set())
    expect(r).toBeNull()
  })
  it('空しきい値配列ならnull', () => {
    const r = pickThresholdToNotify(HOUR, [], 'a1', new Set())
    expect(r).toBeNull()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/background/notificationRules.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装する**

`src/background/notificationRules.ts`:

```ts
export type CourseOverride = {
  muted: boolean
  thresholds: number[]
}

export type NotificationRules = {
  version: 1
  defaultThresholds: number[]
  courseOverrides: Record<string, CourseOverride>
}

export const DEFAULT_THRESHOLDS: number[] = [1, 3, 24]

// コースに適用するしきい値（時間）を解決する。muted なら null（= 通知しない）。
export function resolveThresholds(
  rules: NotificationRules | null,
  courseId: string,
  subscriptionActive: boolean,
): number[] | null {
  if (!subscriptionActive || !rules) return DEFAULT_THRESHOLDS

  const override = rules.courseOverrides[courseId]
  if (override) {
    if (override.muted) return null
    return override.thresholds
  }
  return rules.defaultThresholds
}

// 締切までの残差(ms)に対し、発火すべき最小の未通知しきい値を返す（無ければ null）。
export function pickThresholdToNotify(
  diffMs: number,
  thresholds: number[],
  targetId: string,
  notifiedKeys: Set<string>,
): { thresholdHours: number; notifyKey: string } | null {
  const sorted = [...thresholds].sort((a, b) => a - b)
  for (const hours of sorted) {
    const thresholdMs = hours * 60 * 60 * 1000
    if (diffMs <= thresholdMs) {
      const notifyKey = `${targetId}:${hours}h`
      if (!notifiedKeys.has(notifyKey)) {
        return { thresholdHours: hours, notifyKey }
      }
    }
  }
  return null
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/background/notificationRules.test.ts`
Expected: PASS（10 tests）

- [ ] **Step 5: コミット**

```bash
git add src/background/notificationRules.ts src/background/notificationRules.test.ts
git commit -m "feat(ext): add pure notification-rules resolution module"
```

---

### Task 3: premium.ts — ルールのストレージ・同期・pull

**Files:**
- Modify: `src/core/premium.ts`
- Test: `src/core/premium.test.ts`

**Interfaces:**
- Consumes: `NotificationRules` 型（Task 2）
- Produces:
  - `getNotificationRules(): Promise<NotificationRules | null>`
  - `getNotificationRulesUpdatedAt(): Promise<string | null>`
  - `saveNotificationRules(rules: NotificationRules, updatedAt?: string): Promise<void>`（updatedAt省略時は `new Date().toISOString()`）
  - `pullSettingsFromServer(apiBaseUrl: string): Promise<void>`
  - `syncToServer` が settings POST に `notificationRules` と `notificationRulesUpdatedAt` を含める（Task 5が消費）

- [ ] **Step 1: 失敗するテストを書く**

`src/core/premium.test.ts` の末尾（最後の記述の後）に追加:

```ts
import {
  getNotificationRules,
  saveNotificationRules,
  getNotificationRulesUpdatedAt,
  pullSettingsFromServer,
} from './premium'

describe('notification rules storage', () => {
  it('saveNotificationRules は rules と updatedAt を保存する', async () => {
    const rules = { version: 1 as const, defaultThresholds: [1, 3], courseOverrides: {} }
    await saveNotificationRules(rules, '2026-07-04T12:00:00.000Z')
    expect(await getNotificationRules()).toEqual(rules)
    expect(await getNotificationRulesUpdatedAt()).toBe('2026-07-04T12:00:00.000Z')
  })

  it('未設定なら getNotificationRules は null', async () => {
    await chrome.storage.local.clear()
    expect(await getNotificationRules()).toBeNull()
  })
})

describe('pullSettingsFromServer', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear()
    await chrome.storage.local.set({ authToken: 't', authTokenExpiresAt: new Date(Date.now() + 3600000).toISOString() })
  })

  it('サーバーが新しければローカルへ反映する', async () => {
    await saveNotificationRules({ version: 1, defaultThresholds: [1], courseOverrides: {} }, '2026-07-04T10:00:00.000Z')
    const serverRules = { version: 1, defaultThresholds: [1, 3, 24], courseOverrides: {} }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ theme: 'default', notificationRules: serverRules, notificationRulesUpdatedAt: '2026-07-04T20:00:00.000Z' }),
    }) as unknown as typeof fetch

    await pullSettingsFromServer('https://example.com')

    expect(await getNotificationRules()).toEqual(serverRules)
    expect(await getNotificationRulesUpdatedAt()).toBe('2026-07-04T20:00:00.000Z')
  })

  it('ローカルが新しければ保持する', async () => {
    const localRules = { version: 1 as const, defaultThresholds: [99], courseOverrides: {} }
    await saveNotificationRules(localRules, '2026-07-04T20:00:00.000Z')
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ theme: 'default', notificationRules: { version: 1, defaultThresholds: [1], courseOverrides: {} }, notificationRulesUpdatedAt: '2026-07-04T10:00:00.000Z' }),
    }) as unknown as typeof fetch

    await pullSettingsFromServer('https://example.com')

    expect(await getNotificationRules()).toEqual(localRules)
  })
})
```

（注: `premium.test.ts` 冒頭に `vi` と chrome-stub が既に用意されている前提。無ければ既存の import 群に合わせて `import { describe, it, expect, vi, beforeEach } from 'vitest'` を補う。既存テストの chrome スタブ実装をそのまま利用する。）

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/core/premium.test.ts`
Expected: FAIL（新関数が未export）

- [ ] **Step 3: premium.ts に実装する**

`src/core/premium.ts` の先頭 import に型を追加:

```ts
import type { NotificationRules } from '../background/notificationRules'
```

キー定数（既存の `THEME_KEY` の後）に追加:

```ts
const NOTIFICATION_RULES_KEY = 'notificationRules'
const NOTIFICATION_RULES_UPDATED_AT_KEY = 'notificationRulesUpdatedAt'
```

`saveTheme` の後に関数を追加:

```ts
export async function getNotificationRules(): Promise<NotificationRules | null> {
  const result = (await chrome.storage.local.get(NOTIFICATION_RULES_KEY)) as {
    notificationRules?: NotificationRules
  }
  return result.notificationRules ?? null
}

export async function getNotificationRulesUpdatedAt(): Promise<string | null> {
  const result = (await chrome.storage.local.get(NOTIFICATION_RULES_UPDATED_AT_KEY)) as {
    notificationRulesUpdatedAt?: string
  }
  return result.notificationRulesUpdatedAt ?? null
}

export async function saveNotificationRules(
  rules: NotificationRules,
  updatedAt: string = new Date().toISOString(),
): Promise<void> {
  await chrome.storage.local.set({
    [NOTIFICATION_RULES_KEY]: rules,
    [NOTIFICATION_RULES_UPDATED_AT_KEY]: updatedAt,
  })
}

// ログイン/ダッシュボード起動時に呼ぶ。サーバーの通知ルールが新しければローカルへ反映（last-write-wins）。
export async function pullSettingsFromServer(apiBaseUrl: string): Promise<void> {
  if (!apiBaseUrl) return
  const token = await getAuthToken()
  if (!token) return

  try {
    const res = await fetch(`${apiBaseUrl}/api/user/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = (await res.json()) as {
      notificationRules: NotificationRules | null
      notificationRulesUpdatedAt: string | null
    }
    if (!data.notificationRules || !data.notificationRulesUpdatedAt) return

    const localUpdatedAt = await getNotificationRulesUpdatedAt()
    if (!localUpdatedAt || data.notificationRulesUpdatedAt > localUpdatedAt) {
      await saveNotificationRules(data.notificationRules, data.notificationRulesUpdatedAt)
    }
  } catch {
    // pull失敗はサイレント（ローカルを保持）
  }
}
```

`syncToServer` 内、`const theme = await getTheme()` の行の直後に rules も取得する行を追加:

```ts
    const notificationRules = await getNotificationRules()
    const notificationRulesUpdatedAt = await getNotificationRulesUpdatedAt()
```

そして settings POST の fetch（現状 `body: JSON.stringify({ theme })`）を次に置き換える。rules が null の時は送らない（`typeof null === 'object'` でサーバーが `"null"` を保存するのを防ぐ）:

```ts
      fetch(`${apiBaseUrl}/api/user/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(
          notificationRules
            ? { theme, notificationRules, notificationRulesUpdatedAt }
            : { theme },
        ),
      }),
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/core/premium.test.ts`
Expected: PASS（既存＋新規）

- [ ] **Step 5: 型チェック**

Run: `pnpm exec tsc -b`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/core/premium.ts src/core/premium.test.ts
git commit -m "feat(ext): notification rules storage, sync push, and LWW pull"
```

---

### Task 4: 背景ワーカーの通知ロジック改修

**Files:**
- Modify: `src/background/index.ts`

**Interfaces:**
- Consumes: `resolveThresholds` / `pickThresholdToNotify`（Task 2）、`getNotificationRules`（Task 3）、`isSubscriptionActive`（`src/core/auth.ts`、既存）

- [ ] **Step 1: import を追加**

`src/background/index.ts` の先頭付近の import 群に追加:

```ts
import { resolveThresholds, pickThresholdToNotify } from './notificationRules'
import { getNotificationRules } from '../core/premium'
import { isSubscriptionActive } from '../core/auth'
```

（既存で `getManualAssignments` 等を import している行の近くに置く。`isSubscriptionActive` が既に import 済みなら重複させない。）

- [ ] **Step 2: `checkDeadlineWarningNotifications` を改修する**

現在の関数（`async function checkDeadlineWarningNotifications(): Promise<void> {` 〜 対応する `}` まで、通知ターゲット構築とループを含むブロック）を次に置き換える:

```ts
async function checkDeadlineWarningNotifications(): Promise<void> {
  const [assignments, ignoredIds, notifiedKeys, manualAssignments, rules, subscriptionActive] =
    await Promise.all([
      getAssignments(),
      getIgnoredAssignmentIds(),
      getNotifiedDeadlineKeys(),
      getManualAssignments(),
      getNotificationRules(),
      isSubscriptionActive(),
    ])

  const ignoredSet = new Set(ignoredIds)
  const notifiedSet = new Set(notifiedKeys)
  const nextNotifiedKeys = new Set(notifiedKeys)
  let changed = false

  const scanTargets = assignments.filter(
    (a) =>
      !ignoredSet.has(a.id) &&
      a.deadline !== null &&
      a.lifecycleStatus !== 'passed' &&
      a.lifecycleStatus !== 'submitted' &&
      a.submissionStatus !== 'submitted' &&
      a.submissionStatus !== 'completed',
  )

  const manualTargets = manualAssignments.filter((a) => !a.submitted)

  type NotifyTarget = {
    id: string
    courseId: string
    title: string
    courseName: string
    deadline: string
    url?: string
  }

  const allTargets: NotifyTarget[] = [
    ...scanTargets
      .filter((a): a is Assignment & { deadline: string } => a.deadline !== null)
      .map((a) => ({
        id: a.id,
        courseId: a.courseId,
        title: a.title,
        courseName: a.courseName,
        deadline: a.deadline,
        url: a.url,
      })),
    ...manualTargets.map((a) => ({
      id: a.id,
      courseId: a.courseId,
      title: a.title,
      courseName: a.courseName,
      deadline: a.deadline,
      url: a.letusUrl ?? undefined,
    })),
  ]

  for (const target of allTargets) {
    const diff = new Date(target.deadline).getTime() - Date.now()
    if (diff <= 0) continue

    const thresholds = resolveThresholds(rules, target.courseId, subscriptionActive)
    if (thresholds === null) continue // ミュート

    const pick = pickThresholdToNotify(diff, thresholds, target.id, notifiedSet)
    if (!pick) continue

    await createNotification({
      id: `task-watcher-deadline-${pick.thresholdHours}h-${target.id}`,
      title: `締切まで${pick.thresholdHours}時間以内`,
      message: `${target.title}\n${target.courseName}`,
      url: target.url,
    })
    nextNotifiedKeys.add(pick.notifyKey)
    changed = true
  }

  if (changed) {
    await saveNotifiedDeadlineKeys(Array.from(nextNotifiedKeys))
  }
}
```

（旧実装で使っていた定数 `ONE_HOUR_MS` / `THREE_HOURS_MS` / `TWENTY_FOUR_HOURS_MS` がこの関数専用だった場合、未使用になるので削除する。他で使われていれば残す。`grep -n "ONE_HOUR_MS\|THREE_HOURS_MS\|TWENTY_FOUR_HOURS_MS" src/background/index.ts` で確認し、未使用なら定義行を削除。）

- [ ] **Step 3: 未使用定数の確認と削除**

Run: `grep -n "ONE_HOUR_MS\|THREE_HOURS_MS\|TWENTY_FOUR_HOURS_MS" src/background/index.ts`
Expected: 定義行のみがヒットする（参照が消えている）なら該当の `const ... = ...` 行を削除。`isWithin24Hours` 等が `TWENTY_FOUR_HOURS_MS` を使っている場合はその定数を残す。

- [ ] **Step 4: 型チェック**

Run: `pnpm exec tsc -b`
Expected: エラーなし

- [ ] **Step 5: ビルド**

Run: `pnpm build`
Expected: 成功

- [ ] **Step 6: 既存テストが壊れないこと**

Run: `pnpm exec vitest run src/background/index.test.ts`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add src/background/index.ts
git commit -m "feat(ext): apply notification rules in deadline warning check"
```

---

### Task 5: ダッシュボードUI — 全体しきい値＋pull連携

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `getNotificationRules` / `saveNotificationRules` / `syncToServer` / `pullSettingsFromServer`（Task 3）、`NotificationRules` / `DEFAULT_THRESHOLDS`（Task 2）

**ゲーティング方針（specの「PremiumGateでラップ」からの意図的な差異）:** ダッシュボードのこの設定ブロックは既存コードで `isSubscriber ? (プレミアムブロック) : (<ProBanner .../>)` で分岐しており（`src/App.tsx` の該当三項演算子）、テーマセレクタもこの中にある。通知設定UIも同じプレミアムブロック内に置く＝サブスクライバーのみに表示され、非サブスクライバーは既存の `ProBanner`（アップセル面）を見る。新たに `PremiumGate` コンポーネントは導入せず、既存パターンに合わせる。快適装備＋開発支援の文面は通知セクションのヒント文に含める。

- [ ] **Step 1: import と state を追加**

`src/App.tsx` の `import { getTheme, saveTheme } from './core/premium'` を次に置き換える:

```ts
import {
  getTheme,
  saveTheme,
  getNotificationRules,
  saveNotificationRules,
  syncToServer,
  pullSettingsFromServer,
} from './core/premium'
import { DEFAULT_THRESHOLDS, type NotificationRules } from './background/notificationRules'
```

コンポーネント内の state 群（`const [theme, setTheme] = useState('default')` の近く）に追加:

```ts
  const [notificationRules, setNotificationRules] = useState<NotificationRules>({
    version: 1,
    defaultThresholds: DEFAULT_THRESHOLDS,
    courseOverrides: {},
  })
```

- [ ] **Step 2: 初期ロードで rules を読み、pull する**

`getTheme()` を呼んでいる初期化ブロック（`const [savedTheme, ...] = await Promise.all([...])` 付近）の後に追加:

```ts
      const savedRules = await getNotificationRules()
      if (savedRules) setNotificationRules(savedRules)
      if (API_BASE_URL) {
        await pullSettingsFromServer(API_BASE_URL)
        const pulledRules = await getNotificationRules()
        if (pulledRules) setNotificationRules(pulledRules)
      }
```

- [ ] **Step 3: 保存ヘルパを追加**

コンポーネント内、`toggleCourse` 等の関数定義の近くに追加:

```ts
  const persistNotificationRules = async (next: NotificationRules) => {
    setNotificationRules(next)
    await saveNotificationRules(next)
    if (API_BASE_URL) void syncToServer(API_BASE_URL)
  }

  const toggleDefaultThreshold = (hours: number) => {
    const has = notificationRules.defaultThresholds.includes(hours)
    const nextThresholds = has
      ? notificationRules.defaultThresholds.filter((h) => h !== hours)
      : [...notificationRules.defaultThresholds, hours].sort((a, b) => a - b)
    void persistNotificationRules({ ...notificationRules, defaultThresholds: nextThresholds })
  }
```

- [ ] **Step 4: 全体しきい値UIを描画する**

`src/App.tsx` の テーマ設定 `<div className="premiumSettingsRow">...テーマ...</div>`（`premiumSettingsRow` でテーマセレクタを含むブロック）の直後に追加:

```tsx
                <div className="notificationRulesSection">
                  <p className="premiumSectionLabel">通知タイミング（全体）</p>
                  <p className="notificationHint">
                    締切の何時間前に通知するかを選べます。快適機能のアンロックと、このサービスの開発・運営を支える支援です。
                  </p>
                  <div className="thresholdChips">
                    {[1, 3, 6, 12, 24, 48, 72].map((hours) => (
                      <button
                        key={hours}
                        type="button"
                        className={`thresholdChip ${notificationRules.defaultThresholds.includes(hours) ? 'active' : ''}`}
                        onClick={() => toggleDefaultThreshold(hours)}
                      >
                        {hours}時間前
                      </button>
                    ))}
                  </div>
                </div>
```

- [ ] **Step 5: CSS を追加**

`src/App.css` の末尾に追加:

```css
.notificationRulesSection {
  margin-top: 12px;
}

.notificationHint {
  font-size: 11px;
  color: #64748b;
  margin: 4px 0 8px;
}

.thresholdChips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.thresholdChip {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #ddd6fe;
  background: #fff;
  color: #4f46e5;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.thresholdChip.active {
  background: #4f46e5;
  color: #fff;
  border-color: #4f46e5;
}
```

- [ ] **Step 6: 型チェック＋ビルド**

Run: `pnpm exec tsc -b && pnpm build`
Expected: エラーなし・ビルド成功

- [ ] **Step 7: コミット**

```bash
git add src/App.tsx src/App.css
git commit -m "feat(ext): global notification threshold settings UI with pull sync"
```

---

### Task 6: ダッシュボードUI — コース別上書き/ミュート

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: Task 5 の `notificationRules` state・`persistNotificationRules`

- [ ] **Step 1: コース別操作ヘルパを追加**

`src/App.tsx` の `toggleDefaultThreshold` の後に追加:

```ts
  const toggleCourseOverride = (courseId: string) => {
    const overrides = { ...notificationRules.courseOverrides }
    if (overrides[courseId]) {
      delete overrides[courseId]
    } else {
      overrides[courseId] = { muted: false, thresholds: [...notificationRules.defaultThresholds] }
    }
    void persistNotificationRules({ ...notificationRules, courseOverrides: overrides })
  }

  const toggleCourseMuted = (courseId: string) => {
    const current = notificationRules.courseOverrides[courseId]
    if (!current) return
    const overrides = {
      ...notificationRules.courseOverrides,
      [courseId]: { ...current, muted: !current.muted },
    }
    void persistNotificationRules({ ...notificationRules, courseOverrides: overrides })
  }

  const toggleCourseThreshold = (courseId: string, hours: number) => {
    const current = notificationRules.courseOverrides[courseId]
    if (!current) return
    const has = current.thresholds.includes(hours)
    const nextThresholds = has
      ? current.thresholds.filter((h) => h !== hours)
      : [...current.thresholds, hours].sort((a, b) => a - b)
    const overrides = {
      ...notificationRules.courseOverrides,
      [courseId]: { ...current, thresholds: nextThresholds },
    }
    void persistNotificationRules({ ...notificationRules, courseOverrides: overrides })
  }
```

- [ ] **Step 2: コース別UIを描画する**

Task 5 で追加した `<div className="notificationRulesSection">...全体...</div>` の閉じタグの直後（同じ親要素内）に追加:

```tsx
                <div className="notificationRulesSection">
                  <p className="premiumSectionLabel">通知タイミング（コース別）</p>
                  {courses.length === 0 ? (
                    <p className="notificationHint">
                      LETUSのコースを開くと、ここでコース別に設定できます。
                    </p>
                  ) : (
                    courses.map((course) => {
                      const override = notificationRules.courseOverrides[course.id]
                      return (
                        <div key={course.id} className="courseRuleRow">
                          <label className="courseRuleHead">
                            <input
                              type="checkbox"
                              checked={Boolean(override)}
                              onChange={() => toggleCourseOverride(course.id)}
                            />
                            <span>{course.name}</span>
                          </label>
                          {override && (
                            <div className="courseRuleBody">
                              <label className="muteToggle">
                                <input
                                  type="checkbox"
                                  checked={override.muted}
                                  onChange={() => toggleCourseMuted(course.id)}
                                />
                                <span>このコースをミュート</span>
                              </label>
                              {!override.muted && (
                                <div className="thresholdChips">
                                  {[1, 3, 6, 12, 24, 48, 72].map((hours) => (
                                    <button
                                      key={hours}
                                      type="button"
                                      className={`thresholdChip ${override.thresholds.includes(hours) ? 'active' : ''}`}
                                      onClick={() => toggleCourseThreshold(course.id, hours)}
                                    >
                                      {hours}時間前
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
```

- [ ] **Step 3: CSS を追加**

`src/App.css` の末尾に追加:

```css
.courseRuleRow {
  border-top: 1px solid #f1f5f9;
  padding: 8px 0;
}

.courseRuleHead {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.courseRuleBody {
  margin: 8px 0 0 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.muteToggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #475569;
  cursor: pointer;
}
```

- [ ] **Step 4: 型チェック＋ビルド**

Run: `pnpm exec tsc -b && pnpm build`
Expected: エラーなし・ビルド成功

- [ ] **Step 5: 全拡張テスト（回帰確認）**

Run: `pnpm exec vitest run src`
Expected: PASS（src配下の全テスト。api/testsのjestファイルはvitest対象外で失敗表示されるが無関係）

- [ ] **Step 6: コミット**

```bash
git add src/App.tsx src/App.css
git commit -m "feat(ext): per-course notification override and mute UI"
```

---

## 完了条件

- Task 1〜6 の全チェックボックス完了
- `cd api && npx jest` 全件PASS、`pnpm exec vitest run src` 全件PASS、`pnpm exec tsc -b`・`pnpm build` 成功
- サブスクライバーがダッシュボードで全体しきい値を編集・コース別に別しきい値/ミュートを設定でき、背景ワーカーが従う（無料/失効は固定1h/3h/24h）
- 通知ルールが push＋pull（LWW）でクロスデバイス同期される。テーマは各デバイス独立のまま
