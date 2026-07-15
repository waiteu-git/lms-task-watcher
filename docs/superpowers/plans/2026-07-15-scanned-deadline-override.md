# スキャン課題の締切をユーザーが設定/変更 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スキャン課題の締切を、LETUSページのバッジからユーザーが設定/変更/クリアでき、実効締切が表示・緊急度・締切通知の全てに反映される。

**Architecture:** パース済み締切は保持し、`deadlineOverrides`（正規化URL→ISO）を別キーに保存して読取時に重ねる（オーバーレイ方式）。純関数 `applyDeadlineOverrides` を popup/background で適用、content script は import ガードのため同ロジックをインライン。バッジ（core `computeBadgeState`）に overrides を渡して実効締切と `userSet` を出し、クリックで右下固定の締切エディタを開く。

**Tech Stack:** TypeScript / React 19 / Vite / Vitest / Chrome MV3（`chrome.storage.local`）

## Global Constraints

- ブランチ: `feature/scanned-deadline-override`（develop分岐・現在チェックアウト済）。
- **content script の import ガード維持**: `dist/content.js`・`dist/classTimetable.js` に `import` 文が残ってはいけない。**`src/core/deadlineOverride.ts` は `badgeState` を import しないこと**（popup/background が読むと `badgeState` が content と共有チャンク化しガード破損）＝ `normalizeAssignmentUrl` 相当（`url.split('#')[0]`）はインライン。`manualTaskWidget.ts` の overrides get/set もインライン（`deadlineOverride.ts` を import しない）。
- `badgeState`/`computeBadgeState` は content(manualTaskWidget)専用（popup/background 非使用）。拡張は content 限定で安全。
- `dist/` を手編集しない。`src/` 変更→`pnpm build`。
- 権限追加なし・外部送信なし（ローカル `deadlineOverrides` のみ）。
- 正規化キーは一貫して `url.split('#')[0]`。datetime-local→ISO は `new Date(v).toISOString()`（手動追加フォームと同じ）。
- 検証: 型 `./node_modules/.bin/tsc -b`、テスト `pnpm vitest run src`、lint `pnpm lint`、ビルド `pnpm build`、ガード `grep -nE "^[[:space:]]*import" dist/classTimetable.js dist/content.js || echo GUARD_OK`。

---

### Task 1: 純ロジック `deadlineOverride` ＋ 型拡張

**Files:**
- Create: `src/core/deadlineOverride.ts`
- Test: `src/core/deadlineOverride.test.ts`
- Modify: `src/core/types.ts:47`（`deadlineSource` に `'user'` 追加）
- Modify: `src/background/storageKeys.ts`（末尾にキー追加）

**Interfaces:**
- Produces: `applyDeadlineOverrides(assignments: Assignment[], overrides: Record<string,string>): Assignment[]`／`getDeadlineOverrides(): Promise<Record<string,string>>`／`DEADLINE_OVERRIDES_KEY`。

- [ ] **Step 1: 失敗するテストを書く**

Create `src/core/deadlineOverride.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyDeadlineOverrides } from './deadlineOverride'
import type { Assignment } from './types'

function a(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1', courseId: 'c1', courseName: '講義', title: '課題', url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1',
    deadline: null, deadlineText: '', deadlineSource: null, sourceText: '',
    submissionStatus: 'not_submitted', lifecycleStatus: 'open',
    detectedAt: '', firstSeenAt: '', lastSeenAt: '', lastCheckedAt: '',
    ...over,
  } as Assignment
}

describe('applyDeadlineOverrides', () => {
  it('override があれば deadline を差し替え deadlineSource を user にする', () => {
    const out = applyDeadlineOverrides([a()], { 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1': '2026-07-22T14:00:00.000Z' })
    expect(out[0].deadline).toBe('2026-07-22T14:00:00.000Z')
    expect(out[0].deadlineSource).toBe('user')
  })

  it('URL のフラグメント差は無視して一致（正規化）', () => {
    const out = applyDeadlineOverrides([a({ url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1#section' })], { 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1': '2026-07-22T14:00:00.000Z' })
    expect(out[0].deadline).toBe('2026-07-22T14:00:00.000Z')
  })

  it('override が無ければ不変（パース済み締切を保持）', () => {
    const src = [a({ deadline: '2026-07-01T00:00:00.000Z', deadlineSource: 'field' })]
    const out = applyDeadlineOverrides(src, {})
    expect(out[0].deadline).toBe('2026-07-01T00:00:00.000Z')
    expect(out[0].deadlineSource).toBe('field')
  })

  it('空マップは同一配列参照を返す（コスト回避）', () => {
    const src = [a()]
    expect(applyDeadlineOverrides(src, {})).toBe(src)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/core/deadlineOverride.test.ts`
Expected: FAIL（`Failed to resolve import './deadlineOverride'`）

- [ ] **Step 3: 型に 'user' を追加**

Modify `src/core/types.ts:47`:

置換前: `  deadlineSource: 'field' | 'title' | null`
置換後: `  deadlineSource: 'field' | 'title' | 'user' | null`

- [ ] **Step 4: storageキーを追加**

Modify `src/background/storageKeys.ts` — 末尾に追加:

```ts
export const DEADLINE_OVERRIDES_KEY = 'deadlineOverrides'
```

- [ ] **Step 5: 実装を書く**

Create `src/core/deadlineOverride.ts`:

```ts
import type { Assignment } from './types'
import { DEADLINE_OVERRIDES_KEY } from '../background/storageKeys'

// content script と同じ正規化。badgeState を import すると popup/background 経由で
// content と共有チャンク化し import ガードを壊すため、ここでは import せずインライン化する。
function normalizeUrl(url: string): string {
  return url.split('#')[0]
}

/** スキャン課題のパース済み締切を保持したまま、ユーザー設定の締切を読取時に重ねる。 */
export function applyDeadlineOverrides(
  assignments: Assignment[],
  overrides: Record<string, string>,
): Assignment[] {
  if (!overrides || Object.keys(overrides).length === 0) return assignments
  return assignments.map((assignment) => {
    if (!assignment.url) return assignment
    const override = overrides[normalizeUrl(assignment.url)]
    return override ? { ...assignment, deadline: override, deadlineSource: 'user' } : assignment
  })
}

export async function getDeadlineOverrides(): Promise<Record<string, string>> {
  const result = (await chrome.storage.local.get(DEADLINE_OVERRIDES_KEY)) as {
    deadlineOverrides?: Record<string, string>
  }
  return result[DEADLINE_OVERRIDES_KEY] ?? {}
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm vitest run src/core/deadlineOverride.test.ts`
Expected: PASS（4件）

- [ ] **Step 7: 型チェック＋コミット**

```bash
./node_modules/.bin/tsc -b
git add src/core/deadlineOverride.ts src/core/deadlineOverride.test.ts src/core/types.ts src/background/storageKeys.ts
git commit -m "feat(deadline): 締切オーバーライドの純ロジックと型・キー"
```
Expected: tsc エラーなし。

---

### Task 2: `computeBadgeState` に overrides を追加

**Files:**
- Modify: `src/core/badgeState.ts`（型・関数）
- Modify: `src/core/badgeState.test.ts`（既存テストに追加）

**Interfaces:**
- Consumes: `Assignment`, `ManualAssignment`。
- Produces: `computeBadgeState(url, assignments, manualAssignments, overrides?: Record<string,string>)` の `scanned` が `{ kind:'scanned'; submitted; deadline; userSet: boolean }` を返す。

- [ ] **Step 1: 失敗するテストを追加**

Add to `src/core/badgeState.test.ts`（末尾の `describe` 内などに）:

```ts
it('override 付き scanned は実効締切と userSet を返す', () => {
  const assignments = [{ id: 'a1', url: 'https://x/mod/assign/view.php?id=1', deadline: null, submissionStatus: 'not_submitted', lifecycleStatus: 'open' }] as unknown as Parameters<typeof computeBadgeState>[1]
  const state = computeBadgeState('https://x/mod/assign/view.php?id=1', assignments, [], { 'https://x/mod/assign/view.php?id=1': '2026-07-22T14:00:00.000Z' })
  expect(state).toEqual({ kind: 'scanned', submitted: false, deadline: '2026-07-22T14:00:00.000Z', userSet: true })
})

it('override 無しの scanned は userSet:false・パース締切そのまま', () => {
  const assignments = [{ id: 'a1', url: 'https://x/mod/assign/view.php?id=1', deadline: '2026-07-01T00:00:00.000Z', submissionStatus: 'not_submitted', lifecycleStatus: 'open' }] as unknown as Parameters<typeof computeBadgeState>[1]
  const state = computeBadgeState('https://x/mod/assign/view.php?id=1', assignments, [])
  expect(state).toEqual({ kind: 'scanned', submitted: false, deadline: '2026-07-01T00:00:00.000Z', userSet: false })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm vitest run src/core/badgeState.test.ts`
Expected: FAIL（`userSet` が無い／引数不一致）

- [ ] **Step 3: 実装**

Modify `src/core/badgeState.ts`:

`BadgeState` の scanned に `userSet` を追加:
```ts
export type BadgeState =
  | { kind: 'scanned'; submitted: boolean; deadline: string | null; userSet: boolean }
  | { kind: 'manual'; id: string; submitted: boolean; deadline: string }
  | { kind: 'unadded' }
```

`computeBadgeState` を置換:
```ts
export function computeBadgeState(
  url: string,
  assignments: Assignment[],
  manualAssignments: ManualAssignment[],
  overrides: Record<string, string> = {},
): BadgeState {
  const target = normalizeAssignmentUrl(url)

  const scanned = assignments.find((a) => a.url && normalizeAssignmentUrl(a.url) === target)
  if (scanned) {
    const override = overrides[target]
    return {
      kind: 'scanned',
      submitted: isSubmitted(scanned),
      deadline: override ?? scanned.deadline,
      userSet: override != null,
    }
  }

  const manual = manualAssignments.find((a) => a.letusUrl && normalizeAssignmentUrl(a.letusUrl) === target)
  if (manual) {
    return { kind: 'manual', id: manual.id, submitted: manual.submitted, deadline: manual.deadline }
  }

  return { kind: 'unadded' }
}
```

- [ ] **Step 4: 全 badgeState テストが通ることを確認**

Run: `pnpm vitest run src/core/badgeState.test.ts`
Expected: PASS（既存＋新規2）。既存の scanned 期待値に `userSet:false` が必要なら追記する。

- [ ] **Step 5: 型チェック＋コミット**

```bash
./node_modules/.bin/tsc -b
git add src/core/badgeState.ts src/core/badgeState.test.ts
git commit -m "feat(badge): computeBadgeState に締切オーバーライドと userSet を追加"
```

---

### Task 3: content — 締切エディタ＋コースページのバッジをクリック可能に

**Files:**
- Modify: `src/content/manualTaskWidget.ts`

**Interfaces:**
- Consumes: 既存 `normalizeAssignmentUrl`（import 済）・`applyBadgeState`・`computeBadgeState`。
- Produces: `openDeadlineEditor(url, currentDeadline)`／inline `getDeadlineOverrides`/`setDeadlineOverride`/`clearDeadlineOverride`。

- [ ] **Step 1: overrides の inline ストアと日時ヘルパを追加**

`src/content/manualTaskWidget.ts` の `getManualAssignments`（既存の inline ストア群）付近に追加:

```ts
async function getDeadlineOverrides(): Promise<Record<string, string>> {
  const r = await chrome.storage.local.get('deadlineOverrides') as { deadlineOverrides?: Record<string, string> }
  return r.deadlineOverrides ?? {}
}
async function setDeadlineOverride(url: string, iso: string): Promise<void> {
  const cur = await getDeadlineOverrides()
  await chrome.storage.local.set({ deadlineOverrides: { ...cur, [normalizeAssignmentUrl(url)]: iso } })
}
async function clearDeadlineOverride(url: string): Promise<void> {
  const cur = await getDeadlineOverrides()
  const next = { ...cur }
  delete next[normalizeAssignmentUrl(url)]
  await chrome.storage.local.set({ deadlineOverrides: next })
}
function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
```

- [ ] **Step 2: 締切エディタを追加**

`src/content/manualTaskWidget.ts` の `openQuickAddForm` の近く（後ろ）に追加:

```ts
function openDeadlineEditor(url: string, currentDeadline: string | null): void {
  const existing = document.getElementById('letus-task-watcher-deadline-editor')
  if (existing) existing.remove()

  const host = document.createElement('div')
  host.id = 'letus-task-watcher-deadline-editor'
  host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;'
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; font-family: sans-serif; font-size: 13px; }
    .panel { background:#fff; border:1px solid #d1d5db; border-radius:12px; padding:14px 16px; width:264px; box-shadow:0 2px 12px rgba(0,0,0,.15); }
    .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
    .title { font-weight:600; font-size:13px; color:#111827; }
    .x { background:none; border:none; cursor:pointer; color:#6b7280; font-size:16px; }
    input { width:100%; box-sizing:border-box; font-size:12px; border:1px solid #d1d5db; border-radius:6px; padding:6px 8px; color:#111827; background:#fff; }
    .actions { display:flex; gap:6px; margin-top:12px; }
    .clear { flex:1; border:1px solid #d1d5db; background:#fff; border-radius:6px; padding:6px; cursor:pointer; font-size:11px; color:#374151; }
    .save { flex:1; background:#2563eb; color:#fff; border:none; border-radius:6px; padding:6px; cursor:pointer; font-size:12px; }
    .err { color:#dc2626; font-size:11px; margin-top:6px; }
  `
  shadow.appendChild(style)

  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.innerHTML = `
    <div class="head"><span class="title">締切を設定</span><button class="x" type="button" aria-label="閉じる">✕</button></div>
    <input id="dl" type="datetime-local" />
    <div class="actions">
      <button class="clear" type="button">クリア（自動検出に戻す）</button>
      <button class="save" type="button">保存</button>
    </div>
    <div class="err" id="err"></div>
  `
  shadow.appendChild(panel)

  const input = shadow.getElementById('dl') as HTMLInputElement
  if (currentDeadline) input.value = toLocalInputValue(currentDeadline)

  const close = () => host.remove()
  panel.querySelector('.x')!.addEventListener('click', close)
  panel.querySelector('.save')!.addEventListener('click', async () => {
    const v = input.value
    if (!v) { shadow.getElementById('err')!.textContent = '日時を入力してください。'; return }
    await setDeadlineOverride(url, new Date(v).toISOString())
    close()
  })
  panel.querySelector('.clear')!.addEventListener('click', async () => {
    await clearDeadlineOverride(url)
    close()
  })
}
```

- [ ] **Step 3: scanned バッジをクリック可能に**

`src/content/manualTaskWidget.ts` の `applyBadgeState` 内 `if (state.kind === 'scanned')` ブロックを置換:

置換前:
```ts
  if (state.kind === 'scanned') {
    const icon = state.submitted ? '✓' : '！'
    fresh.className = `badge ${state.submitted ? 'submitted' : ''}`
    fresh.textContent = state.deadline ? `${formatDeadlineShort(state.deadline)} ${icon}` : icon
    return
  }
```
置換後:
```ts
  if (state.kind === 'scanned') {
    const icon = state.submitted ? '✓' : '！'
    fresh.className = `badge clickable ${state.submitted ? 'submitted' : ''}`
    const mark = state.userSet ? ' ✎' : ''
    fresh.textContent = state.deadline
      ? `${formatDeadlineShort(state.deadline)} ${icon}${mark}`
      : `＋締切 ${icon}`
    fresh.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openDeadlineEditor(entry.url, state.deadline)
    })
    return
  }
```

- [ ] **Step 4: バッジ描画側で overrides をロードして渡す**

`src/content/manualTaskWidget.ts` の4箇所の `computeBadgeState(...)` 呼び出しを overrides 付きにする。各関数はロードした `overrides` を保持して渡す:

1. `buildCourseBadges`（`for (const link of findAssignmentLinks())` の直前で overrides をロード）— 関数シグネチャに `overrides: Record<string,string>` を追加し、呼び出し `applyBadgeState(entry, computeBadgeState(url, assignments, manualAssignments, overrides), ...)`。
2. `refreshCourseBadges` — 同様に `overrides` 引数追加＋ `computeBadgeState(entry.url, assignments, manualAssignments, overrides)`。
3. `initManualTaskWidget` — `Promise.all` に `getDeadlineOverrides()` を追加し、`buildCourseBadges(..., overrides)`／assignmentページの `computeBadgeState(location.href, assignments, manualAssignments, overrides)` に渡す。
4. `repaint` — `Promise.all` に `getDeadlineOverrides()` を追加し、`refreshCourseBadges(..., overrides)`／`computeBadgeState(..., overrides)` に渡す。

例（`initManualTaskWidget`）:
```ts
  const [courses, assignments, manualAssignments, overrides] = await Promise.all([
    getCourses(),
    getAssignments(),
    getManualAssignments(),
    getDeadlineOverrides(),
  ])
  ...
  buildCourseBadges(courses, assignments, manualAssignments, overrides, currentCourseId)
  ...
  const state = computeBadgeState(location.href, assignments, manualAssignments, overrides)
```
（`buildCourseBadges`/`refreshCourseBadges` の引数順は `(courses, assignments, manualAssignments, overrides, currentCourseId?)` に統一する。）

- [ ] **Step 5: onChanged に deadlineOverrides を追加**

`watchStorage` 内の条件を更新:

置換前: `if (!('assignments' in changes || 'manualAssignments' in changes || 'courses' in changes)) return`
置換後: `if (!('assignments' in changes || 'manualAssignments' in changes || 'courses' in changes || 'deadlineOverrides' in changes)) return`

- [ ] **Step 6: 型・ビルド・ガード**

```bash
./node_modules/.bin/tsc -b
pnpm build
grep -nE "^[[:space:]]*import" dist/classTimetable.js dist/content.js || echo GUARD_OK
```
Expected: tsc OK／build 成功／`GUARD_OK`（content に import 文が漏れていない）。

- [ ] **Step 7: コミット**

```bash
git add src/content/manualTaskWidget.ts
git commit -m "feat(badge): コースページの締切バッジから締切を設定/変更/クリア"
```

---

### Task 4: content — 課題ページのインジケータからも締切設定

**Files:**
- Modify: `src/content/manualTaskWidget.ts`（`buildScannedIndicator`/`updateScannedIndicator`）

- [ ] **Step 1: インジケータのクリックを締切エディタに**

`buildScannedIndicator` 内の `el.addEventListener('click', ...)` を置換:

置換前:
```ts
  el.title = 'ダッシュボードで確認'
  ...
  el.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' })
  })
```
置換後:
```ts
  el.title = '締切を設定 / 変更'
  ...
  el.addEventListener('click', () => {
    openDeadlineEditor(normalizeAssignmentUrl(location.href), state.deadline)
  })
```

- [ ] **Step 2: 締切なしの表示を「設定」導線に**

`updateScannedIndicator` の deadline 行を置換:

置換前:
```ts
  el.querySelector('.deadline')!.textContent =
    `締切 ${state.deadline ? formatDeadlineShort(state.deadline) : '未取得'}`
```
置換後:
```ts
  el.querySelector('.deadline')!.textContent = state.deadline
    ? `締切 ${formatDeadlineShort(state.deadline)}${state.userSet ? ' ✎' : ''}`
    : '締切を設定（タップ）'
```

- [ ] **Step 3: 型・ビルド・ガード・コミット**

```bash
./node_modules/.bin/tsc -b && pnpm build
grep -nE "^[[:space:]]*import" dist/classTimetable.js dist/content.js || echo GUARD_OK
git add src/content/manualTaskWidget.ts
git commit -m "feat(badge): 課題ページのインジケータからも締切を設定"
```
Expected: tsc OK／`GUARD_OK`。

---

### Task 5: popup/dashboard に override を反映

**Files:**
- Modify: `src/App.tsx`（import・`refreshAll`・consent effect の締切チェック）
- Modify: `src/components/AssignmentCard.tsx`（ユーザー設定締切のマーカー）

**Interfaces:**
- Consumes: `applyDeadlineOverrides`, `getDeadlineOverrides`（Task 1）。

- [ ] **Step 1: import 追加**

`src/App.tsx` の import 群に追加:
```ts
import { applyDeadlineOverrides, getDeadlineOverrides } from './core/deadlineOverride'
```

- [ ] **Step 2: `refreshAll` で override を適用**

`src/App.tsx` の `refreshAll`（`Promise.all([...])` で assignments を読み `setAssignments` する箇所）を修正。`getDeadlineOverrides()` を Promise.all に足し、`setAssignments(applyDeadlineOverrides(savedAssignments, overrides))` にする:

```ts
    const [
      savedAssignments,
      savedCourses,
      savedIgnoredAssignmentIds,
      savedAssignmentScanStatus,
      savedDeadlineScanStatus,
      savedLastRefreshAt,
      savedManualAssignments,
      overrides,
    ] = await Promise.all([
      getAssignments(),
      getCourses(),
      getIgnoredAssignmentIds(),
      getAssignmentScanStatus(),
      getDeadlineScanStatus(),
      getLastRefreshAt(),
      getManualAssignments(),
      getDeadlineOverrides(),
    ])

    setAssignments(applyDeadlineOverrides(savedAssignments, overrides))
```
（他の `setXxx` はそのまま。`assignments` state が実効締切になり、表示・緊急度・`TimetableSection`・`getUrgentAssignments` すべてに波及する。）

- [ ] **Step 3: ポップアップの締切通知チェックにも適用**

`src/App.tsx` の consent effect 内、`getAssignments()` を読んで `checkDeadlineWarningNotifications(...)` に渡す箇所を修正:

```ts
      const savedAssignments = await getAssignments()
      const savedCourses = await getCourses()
      const savedIgnoredIds = await getIgnoredAssignmentIds()
      const savedManualAssignments = await getManualAssignments()
      const overrides = await getDeadlineOverrides()

      await checkDeadlineWarningNotifications(
        applyDeadlineOverrides(savedAssignments, overrides),
        savedCourses,
        savedIgnoredIds,
        savedManualAssignments,
      )
```

- [ ] **Step 4: AssignmentCard にユーザー設定マーカー**

`src/components/AssignmentCard.tsx:68` 付近の `deadlineSource === 'title'` の表示の近くに追加（締切表示のそば）:

```tsx
          {assignment.deadlineSource === 'user' && (
            <span className="deadlineSourceTag">自分で設定</span>
          )}
```
（既存の title マーカーと同じ体裁のクラスを流用。無ければ小さめの muted テキストで可。CSS が必要なら `src/App.css` に `.deadlineSourceTag { font-size: 10.5px; color: var(--faint); }` を追加。）

- [ ] **Step 5: 型・lint・テスト・ビルド**

```bash
./node_modules/.bin/tsc -b
pnpm lint
pnpm vitest run src
pnpm build
```
Expected: tsc OK／lint 新規エラーなし（既存の syllabusParse/exhaustive-deps を除く）／テスト緑／build 成功。

- [ ] **Step 6: コミット**

```bash
git add src/App.tsx src/components/AssignmentCard.tsx src/App.css
git commit -m "feat(deadline): ポップアップ/ダッシュボードに締切オーバーライドを反映"
```

---

### Task 6: background の通知に override を反映

**Files:**
- Modify: `src/background/index.ts`（import・`checkDeadlineWarningNotifications`・`scanDeadlinesInBackground` の `notifyDeadlineSummary`・`runManualUpdate` の getUrgent）

**Interfaces:**
- Consumes: `applyDeadlineOverrides`, `getDeadlineOverrides`（Task 1）。

- [ ] **Step 1: import 追加**

`src/background/index.ts` の `../core/` import 群に追加:
```ts
import { applyDeadlineOverrides, getDeadlineOverrides } from '../core/deadlineOverride'
```

- [ ] **Step 2: `checkDeadlineWarningNotifications` に適用**

`src/background/index.ts:834-841` の Promise.all に `getDeadlineOverrides()` を足し、assignments に override を重ねる:

```ts
async function checkDeadlineWarningNotifications(): Promise<void> {
  const [rawAssignments, ignoredIds, notifiedKeys, manualAssignments, rules, overrides] = await Promise.all([
    getAssignments(),
    getIgnoredAssignmentIds(),
    getNotifiedDeadlineKeys(),
    getManualAssignments(),
    getNotificationRules(),
    getDeadlineOverrides(),
  ])
  const assignments = applyDeadlineOverrides(rawAssignments, overrides)
```
（以降の `assignments.filter(...)` はそのまま。実効締切で締切通知が出る。）

- [ ] **Step 3: 完了サマリ通知に適用**

`src/background/index.ts` の `scanDeadlinesInBackground` 内、`await notifyDeadlineSummary(finalAssignments)` を置換:

置換前: `    await notifyDeadlineSummary(finalAssignments)`
置換後:
```ts
    await notifyDeadlineSummary(applyDeadlineOverrides(finalAssignments, await getDeadlineOverrides()))
```

- [ ] **Step 4: 手動更新の緊急サマリに適用**

`src/background/index.ts` の `runManualUpdate` 内、`getAssignments()` を読んで `getUrgentAssignments` に渡す箇所を修正:

```ts
  const [rawAssignments, courses, ignoredIds] = await Promise.all([
    getAssignments(),
    getCourses(),
    getIgnoredAssignmentIds(),
  ])
  const assignments = applyDeadlineOverrides(rawAssignments, await getDeadlineOverrides())
  const visible = assignments.filter((a) => !ignoredIds.includes(a.id))
  const urgent = getUrgentAssignments(visible, courses)
```
（変数名 `assignments` を使うよう既存行を合わせる。）

- [ ] **Step 5: 型・テスト・ビルド・ガード**

```bash
./node_modules/.bin/tsc -b
pnpm vitest run src
pnpm build
grep -nE "^[[:space:]]*import" dist/classTimetable.js dist/content.js || echo GUARD_OK
```
Expected: tsc OK／テスト緑／build 成功／`GUARD_OK`。

- [ ] **Step 6: コミット**

```bash
git add src/background/index.ts
git commit -m "feat(deadline): 背景の締切通知・完了サマリに締切オーバーライドを反映"
```

---

## 実装後の総合確認（全タスク完了後）

- [ ] `pnpm vitest run src` 全緑（既存＋deadlineOverride＋badgeState）
- [ ] `./node_modules/.bin/tsc -b` エラーなし
- [ ] `pnpm lint` 新規エラーなし
- [ ] `pnpm build` 成功
- [ ] `grep -nE "^[[:space:]]*import" dist/classTimetable.js dist/content.js` が空（`GUARD_OK`）
- [ ] 実機目視（ユーザー）: (a) 締切なしスキャン課題のバッジが「＋締切 ！」でクリック可→エディタで日時保存→バッジに `M/D ！ ✎` が出る／(b) ポップアップ/ダッシュボードで締切が表示・緊急度色・締切通知の対象になる／(c) クリア で自動検出（元のパース値 or 未設定）に戻る／(d) 課題ページのインジケータからも設定できる／(e) 再スキャン後も override が維持される

## 非目標（YAGNI）

ポップアップ一覧から直接締切設定／手動課題の締切編集／締切の個別リマインド設定。
