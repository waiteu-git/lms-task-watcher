# 時間割「取得した」表示強化＋初回のみ通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLASS時間割の取込を「取り込めた/いつのデータか」明確に伝え、初回取込時だけ1回OS通知する。

**Architecture:** 純ロジック（キー解析・通知判定・文言生成）を `src/core/timetableImportNotify.ts` に切り出しVitestでTDD。通知は content script から出せないため background の既存 `storage.onChanged`（`timetable:*` 検知）に配線。表示強化は content script のトースト文言と popup の TimetableSection ヘッダに最終取込日時（既存 `formatDateTime` 再利用）。

**Tech Stack:** TypeScript / React 19 / Vite / Vitest / Chrome MV3（`chrome.storage.local`・`chrome.notifications`）

## Global Constraints

- ブランチ: `feature/timetable-import-feedback`（develop分岐・現在チェックアウト済）。
- content script の import ガード維持: `dist/classTimetable.js`・`dist/content.js` に `import` 文が残ってはいけない。新規 pure モジュールは background/popup からのみ import する。`classTimetable.ts` には import を足さない（inline変更のみ）。
- `dist/` を手編集しない。`src/` を変更して `pnpm build` で再生成。
- 権限追加なし（`notifications` は既存）。外部送信なし。
- 通知idは固定 `'timetable-imported'`（二重発火時もChromeが同一idを上書き＝可視は1つ）。
- 学期ラベル: `zenki`→「前期」／`kouki`→「後期」。
- 検証コマンド: 型 `./node_modules/.bin/tsc -b`、テスト `pnpm vitest run src`、lint `pnpm lint`、ビルド `pnpm build`。

---

### Task 1: 純ロジック `timetableImportNotify`

**Files:**
- Create: `src/core/timetableImportNotify.ts`
- Test: `src/core/timetableImportNotify.test.ts`

**Interfaces:**
- Consumes: `Semester`（`'zenki' | 'kouki'`）を `src/core/timetableLink.ts` から type-only import。
- Produces:
  - `parseTimetableKey(key: string): { year: number; semester: Semester } | null`
  - `pickFirstImportNotification(setKeys: string[], alreadyNotified: boolean): { year: number; semester: Semester } | null`
  - `buildFirstImportNotification(year: number, semester: Semester): { title: string; message: string }`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/core/timetableImportNotify.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  parseTimetableKey,
  pickFirstImportNotification,
  buildFirstImportNotification,
} from './timetableImportNotify'

describe('parseTimetableKey', () => {
  it('timetable:YYYY:zenki/kouki を解析する', () => {
    expect(parseTimetableKey('timetable:2026:zenki')).toEqual({ year: 2026, semester: 'zenki' })
    expect(parseTimetableKey('timetable:2025:kouki')).toEqual({ year: 2025, semester: 'kouki' })
  })

  it('overrides/view/他キー/不正学期/2桁年は誤検知しない', () => {
    expect(parseTimetableKey('timetableOverrides:2026:zenki:1234567')).toBeNull()
    expect(parseTimetableKey('timetableView')).toBeNull()
    expect(parseTimetableKey('manualAssignments')).toBeNull()
    expect(parseTimetableKey('timetable:2026:haru')).toBeNull()
    expect(parseTimetableKey('timetable:26:zenki')).toBeNull()
  })
})

describe('pickFirstImportNotification', () => {
  it('通知済みなら null', () => {
    expect(pickFirstImportNotification(['timetable:2026:zenki'], true)).toBeNull()
  })

  it('該当キーがなければ null', () => {
    expect(pickFirstImportNotification(['timetableView', 'manualAssignments'], false)).toBeNull()
  })

  it('最初に一致した timetable キーを返す', () => {
    expect(
      pickFirstImportNotification(['manualAssignments', 'timetable:2026:kouki'], false),
    ).toEqual({ year: 2026, semester: 'kouki' })
  })
})

describe('buildFirstImportNotification', () => {
  it('title は固定、message に year と学期ラベルを含む', () => {
    const zenki = buildFirstImportNotification(2026, 'zenki')
    expect(zenki.title).toBe('時間割を取り込みました')
    expect(zenki.message).toContain('2026')
    expect(zenki.message).toContain('前期')
    expect(buildFirstImportNotification(2026, 'kouki').message).toContain('後期')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/core/timetableImportNotify.test.ts`
Expected: FAIL（`Failed to resolve import './timetableImportNotify'`）

- [ ] **Step 3: 最小実装を書く**

Create `src/core/timetableImportNotify.ts`:

```ts
import type { Semester } from './timetableLink'

const TIMETABLE_KEY_RE = /^timetable:(\d{4}):(zenki|kouki)$/

/** `timetable:2026:zenki` 形式のストレージキーだけを厳密一致で解析する。
 * `timetableOverrides:...` や `timetableView` は一致しない（アンカー必須）。 */
export function parseTimetableKey(key: string): { year: number; semester: Semester } | null {
  const m = TIMETABLE_KEY_RE.exec(key)
  if (!m) return null
  return { year: Number(m[1]), semester: m[2] as Semester }
}

/** 変更のあった（セットされた）キー群のうち、まだ通知していなければ最初の時間割キーを返す。
 * 初回取込のみ通知するための判定。 */
export function pickFirstImportNotification(
  setKeys: string[],
  alreadyNotified: boolean,
): { year: number; semester: Semester } | null {
  if (alreadyNotified) return null
  for (const key of setKeys) {
    const parsed = parseTimetableKey(key)
    if (parsed) return parsed
  }
  return null
}

export function buildFirstImportNotification(
  year: number,
  semester: Semester,
): { title: string; message: string } {
  const label = semester === 'zenki' ? '前期' : '後期'
  return {
    title: '時間割を取り込みました',
    message: `${year}年度${label}の時間割を登録しました。ダッシュボードで確認できます。`,
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm vitest run src/core/timetableImportNotify.test.ts`
Expected: PASS（8アサーション相当・3 describe 全緑）

- [ ] **Step 5: コミット**

```bash
git add src/core/timetableImportNotify.ts src/core/timetableImportNotify.test.ts
git commit -m "feat(timetable): 初回取込通知の純ロジック（キー解析・判定・文言）"
```

---

### Task 2: background 配線（storageキー・onChanged・onInstalled移行）

**Files:**
- Modify: `src/background/storageKeys.ts`（末尾に新キー追加）
- Modify: `src/background/index.ts`（import追加・`maybeNotifyFirstTimetableImport` 追加・`storage.onChanged` 修正・`handleInstalled` 移行追加）

**Interfaces:**
- Consumes: `pickFirstImportNotification`, `buildFirstImportNotification`（Task 1）／既存 `createNotification({id,title,message,url})`（`index.ts:401`）／既存 `applyAutoSelect()`（`index.ts:302`）。
- Produces: 副作用のみ（storage `timetableImportNotified` フラグ・`chrome.notifications`）。新しい公開シグネチャなし。

- [ ] **Step 1: storageキーを追加**

Modify `src/background/storageKeys.ts` — 末尾（既存の最後の `export const` の後）に追加:

```ts
export const TIMETABLE_IMPORT_NOTIFIED_KEY = 'timetableImportNotified'
```

- [ ] **Step 2: index.ts に import を追加**

`src/background/index.ts` の storageKeys import ブロック（`import { ... } from './storageKeys'`, 概ね 8–20 行）に `TIMETABLE_IMPORT_NOTIFIED_KEY,` を1行追加する。例（`WELCOME_GUIDE_SHOWN_KEY,` の次に）:

```ts
  TERMS_CONSENT_KEY,
  WELCOME_GUIDE_SHOWN_KEY,
  TIMETABLE_IMPORT_NOTIFIED_KEY,
} from './storageKeys'
```

さらに `../core/` からの import 群の近く（例: `import { computeCourseUpdate } from '../core/courseUpdates'` の次の行）に追加:

```ts
import { pickFirstImportNotification, buildFirstImportNotification } from '../core/timetableImportNotify'
```

- [ ] **Step 3: `maybeNotifyFirstTimetableImport` を追加**

`src/background/index.ts` の `chrome.storage.onChanged.addListener((changes, area) => {`（`index.ts:1003`）の**直前**に、トップレベル関数として追加:

```ts
/** 初回の時間割取込時にだけ1回OS通知する。フラグは取込前に立てて再入を防ぐ。
 * 通知idは固定なので万一の二重発火でも可視通知は1つ。クリックはダッシュボードへ。 */
async function maybeNotifyFirstTimetableImport(setKeys: string[]): Promise<void> {
  const stored = (await chrome.storage.local.get(TIMETABLE_IMPORT_NOTIFIED_KEY)) as {
    timetableImportNotified?: boolean
  }
  const pick = pickFirstImportNotification(setKeys, stored.timetableImportNotified === true)
  if (!pick) return
  await chrome.storage.local.set({ [TIMETABLE_IMPORT_NOTIFIED_KEY]: true })
  const { title, message } = buildFirstImportNotification(pick.year, pick.semester)
  await createNotification({
    id: 'timetable-imported',
    title,
    message,
    url: `${chrome.runtime.getURL('index.html')}#dashboard`,
  })
}
```

- [ ] **Step 4: `storage.onChanged` リスナを修正**

`src/background/index.ts:1003-1010` の既存ブロックを置換:

置換前:
```ts
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (Object.keys(changes).some((k) => k.startsWith('timetable:'))) {
    applyAutoSelect().catch((error) => {
      console.error('[LETUS Task Watcher] auto select failed', error)
    })
  }
})
```

置換後:
```ts
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  const setTimetableKeys = Object.keys(changes).filter(
    (k) => k.startsWith('timetable:') && changes[k].newValue !== undefined,
  )
  if (setTimetableKeys.length > 0) {
    applyAutoSelect().catch((error) => {
      console.error('[LETUS Task Watcher] auto select failed', error)
    })
    maybeNotifyFirstTimetableImport(setTimetableKeys).catch((error) => {
      console.error('[LETUS Task Watcher] timetable import notify failed', error)
    })
  }
})
```

注: `startsWith('timetable:')` は `timetable:*`・`timetableOverrides:*`・`timetableView` を拾うが、`maybeNotifyFirstTimetableImport` 内の `pickFirstImportNotification`→`parseTimetableKey` が厳密一致で `timetable:YYYY:(zenki|kouki)` 以外を除外する。`applyAutoSelect` の発火条件は従来と実質同じ（削除イベントを除外した点のみ厳密化）。

- [ ] **Step 5: `handleInstalled` に既存ユーザー移行を追加**

`src/background/index.ts` の `handleInstalled` 内 `if (details.reason === 'update') {`（`index.ts:959`）ブロックの**先頭**（`const result = await chrome.storage.local.get(WELCOME_GUIDE_SHOWN_KEY)` の前）に追加:

```ts
    const allKeys = await chrome.storage.local.get(null)
    if (Object.keys(allKeys).some((k) => k.startsWith('timetable:'))) {
      await chrome.storage.local.set({ [TIMETABLE_IMPORT_NOTIFIED_KEY]: true })
    }
```

これで、更新前に既に時間割を取り込んでいた利用者は「初回」通知の対象外になる。

- [ ] **Step 6: 型・テスト・lint・ビルドを確認**

```bash
./node_modules/.bin/tsc -b
pnpm vitest run src
pnpm lint
pnpm build
```
Expected: tsc エラーなし／全テスト緑（既存＋Task1）／lint 0 warning・0 error／build 成功。

- [ ] **Step 7: content script import ガードを確認**

Run:
```bash
grep -nE "^[[:space:]]*import" dist/classTimetable.js dist/content.js || echo "GUARD_OK"
```
Expected: `GUARD_OK`（背景の変更が content script バンドルに import を漏らしていないこと）。

- [ ] **Step 8: コミット**

```bash
git add src/background/storageKeys.ts src/background/index.ts
git commit -m "feat(timetable): 初回取込時のみOS通知（onChanged配線＋既存ユーザー移行）"
```

---

### Task 3: CLASSページのトースト詳細化

**Files:**
- Modify: `src/content/classTimetable.ts`（`capture()` 内の `showToast` 呼び出し・`index.ts` の行 88 相当）

**Interfaces:**
- Consumes: `capture()` 内の既存局所変数 `year`（`detectYear()`）と `semester`（`detectSemester()`）。
- Produces: なし（DOM トーストのみ）。**import は追加しない。**

- [ ] **Step 1: トースト文言を変更**

`src/content/classTimetable.ts` の `capture()` 内、`.then(() => { showToast('時間割を取り込みました') })` を置換:

置換前:
```ts
  void chrome.storage.local.set({ [key]: value }).then(() => {
    showToast('時間割を取り込みました')
  })
```

置換後:
```ts
  const semesterLabel = semester === 'zenki' ? '前期' : '後期'
  void chrome.storage.local.set({ [key]: value }).then(() => {
    showToast(`${year}年度${semesterLabel}の時間割を取り込みました`)
  })
```

（`year`・`semester` は同関数内で既に定義済み。新規 import なし。）

- [ ] **Step 2: ビルドして import ガードを確認**

```bash
pnpm build
grep -nE "^[[:space:]]*import" dist/classTimetable.js dist/content.js || echo "GUARD_OK"
```
Expected: build 成功／`GUARD_OK`。

- [ ] **Step 3: 型チェック**

Run: `./node_modules/.bin/tsc -b`
Expected: エラーなし。

- [ ] **Step 4: コミット**

```bash
git add src/content/classTimetable.ts
git commit -m "feat(timetable): CLASS取込トーストに年度・学期を明記"
```

---

### Task 4: 時間割ヘッダに最終取込日時を表示

**Files:**
- Modify: `src/components/TimetableSection.tsx`（`capturedAt` state 追加・ロード・ヘッダ下に表示・`formatDateTime` import）
- Modify: `src/App.css`（`.timetableCapturedAt` 追加）

**Interfaces:**
- Consumes: `getTimetableCapture(year, semester)` の戻り値 `TimetableCapture`（`{ rawTableHtml, jigenText, capturedAt }`）／`formatDateTime(value: string | null): string`（`src/utils/date.ts`）。
- Produces: なし（表示のみ）。

- [ ] **Step 1: `formatDateTime` を import**

`src/components/TimetableSection.tsx` の import 群に追加:

```ts
import { formatDateTime } from '../utils/date'
```

- [ ] **Step 2: `capturedAt` state を追加**

`const [rawHtml, setRawHtml] = useState<string | null>(null)`（`TimetableSection.tsx:26`）の次の行に追加:

```ts
  const [capturedAt, setCapturedAt] = useState<string | null>(null)
```

- [ ] **Step 3: ロード effect で `capturedAt` をセット**

`TimetableSection.tsx:40-47` の effect 内、`setRawHtml(cap?.rawTableHtml ?? null)` の直後に追加:

```ts
      setCapturedAt(cap?.capturedAt ?? null)
```

（この effect は `getTimetableCapture(year, semester)` を `cap` に読み込んでいる。`setRawHtml` の隣に置く。）

- [ ] **Step 4: ヘッダ直下に最終取込日時を表示**

`TimetableSection.tsx` の `</div>`（`timetableHeader` の閉じ・`:112` 相当）と `{open && (` の間に挿入:

```tsx
      {rawHtml !== null && capturedAt && (
        <p className="timetableCapturedAt">最終取込 {formatDateTime(capturedAt)}</p>
      )}
```

- [ ] **Step 5: CSS を追加**

`src/App.css` の `.timetableEmpty {`（`:747`）の直前に追加:

```css
.timetableCapturedAt { font-size: 11.5px; color: var(--faint); margin: -4px 0 10px; }
```

- [ ] **Step 6: 型・lint・ビルドを確認**

```bash
./node_modules/.bin/tsc -b
pnpm lint
pnpm build
```
Expected: エラー/警告なし・build 成功。

- [ ] **Step 7: コミット**

```bash
git add src/components/TimetableSection.tsx src/App.css
git commit -m "feat(timetable): 時間割ヘッダに最終取込日時を表示"
```

---

## 実装後の総合確認（全タスク完了後）

- [ ] `pnpm vitest run src` 全緑（既存 + Task1）
- [ ] `./node_modules/.bin/tsc -b` エラーなし
- [ ] `pnpm lint` 0 warning / 0 error
- [ ] `pnpm build` 成功
- [ ] `grep -nE "^[[:space:]]*import" dist/classTimetable.js dist/content.js` が空（`GUARD_OK`）
- [ ] 実機目視（ユーザー）: (a) CLASS学生時間割表を開く→右下トーストが「2026年度 前期の時間割を取り込みました」／(b) ポップアップの時間割ヘッダに「最終取込 M/D HH:mm」／(c) 拡張を新規インストール相当（フラグ未設定）の初回取込でChrome通知が1回・クリックでダッシュボード／(d) 2回目以降の取込では通知が出ない

## 非目標（YAGNI）

学期別の初回通知（毎学期の最初の取込）・取込失敗通知・サーバー同期・通知からの学期直リンク。
