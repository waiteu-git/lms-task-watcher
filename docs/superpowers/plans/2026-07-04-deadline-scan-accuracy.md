# 締切スキャン精度向上・未取得削減 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LETUS締切パースの本番バグ（閉じた小テストが今日の日付に化ける）を修正し、精度向上・未取得削減とログイン検知の是正を行う。

**Architecture:** 締切解析ロジックを純粋関数モジュール `src/background/deadlineParser.ts` に切り出して単体テスト可能にし、①ラベル拡充・②コロン付きラベル優先・③スラッシュ日付・④タイトル締切フォールバックを段階実装。⑤ログイン検知は `checkIsLoggedIn` を `redirect:'manual'` 化して是正。

**Tech Stack:** TypeScript, Vite, Vitest, Chrome Extension MV3 (service worker), React 19。

## Global Constraints

- 対象バージョン/worktree: **v1.0.6 = `C:\dev\lms-task-watcher-main`（branch main）** / **v1.1.0 = `C:\dev\lms-task-watcher-v1.1.x-qa`（branch qa/v1.1.x-release）**。各Phaseは指定worktreeで作業する。
- パッケージマネージャは **pnpm**。テストは `pnpm exec vitest run <path>`。ビルドは `pnpm build`（本番）/ `pnpm build:dev`（開発版）。
- `background` はサービスワーカー。DOMParser は使わず**文字列/正規表現**で解析する（SWにDOMParserは無い）。
- 締切の時刻補完は既存挙動を厳守: **日付のみ→ `23:59`**、時刻あり→その時刻。ISOは `toIsoStringFromParts`（ローカルtz→`toISOString()`）経由。
- 精度方針は**バランス**: 誤った締切は「期限なし」より悪い。推定（③④）は誤検知を抑え、④はUIで「推定」を明示。
- コミットのフッタは `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- develop(v1.2.0) へは個別実装せず、完了後に v1.1.x → develop をマージフォワード（Phase C）。

---

## Phase A — v1.0.6 ホットフィックス（worktree: `C:\dev\lms-task-watcher-main`, branch main）

最小・低リスクの ①⑤ のみ。審査中リリースの追修正として素早く出す。

### Task A1: ① 締切ラベル `終了済み` 追加

**Files:**
- Modify: `src/background/index.ts`（`extractDeadlineText` 内 `deadlineKeywords` / `startKeywords`）

**Interfaces:**
- Consumes: 既存 `extractDeadlineText(plainText: string): string`
- Produces: 挙動変更のみ（シグネチャ不変）

- [ ] **Step 1: `deadlineKeywords` に `終了済み` を追加**

`src/background/index.ts` の該当配列を次のように変更（`終了予定` の直後に `終了済み` を追加）:

```ts
  const deadlineKeywords = [
    '提出期限', '提出締切', '締切日時', '締切', '期限', '終了予定', '終了済み', '終了日時',
    '利用終了日時', '受験終了', '回答終了',
    'Due date', 'Closing date', 'Close date', 'Closes', 'Due', 'Close',
  ]
```

- [ ] **Step 2: `startKeywords` に `開始済み` を追加**

```ts
  const startKeywords = [
    '開始予定', '開始日時', '開始済み', '開始', '利用開始日時', '受験開始', '公開日時', '公開',
    'Open date', 'Opened', 'Available from',
  ]
```

- [ ] **Step 3: 型チェック**

Run: `pnpm exec tsc -b`
Expected: エラーなし（0 exit）

- [ ] **Step 4: 既存テストが壊れないこと**

Run: `pnpm exec vitest run src/background/index.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/background/index.ts
git commit -m "fix(deadline): recognize 終了済み close label for finished quizzes

閉じた小テストは締切表示が『終了予定→終了済み』に変わり、終了済みが未登録の
ため自分の締切を拾えずナビの別課題名を誤爬取していた。終了済みを追加して是正。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task A2: ⑤ ログイン検知修正（未ログイン→login_required）

**Files:**
- Modify: `src/background/index.ts`（`checkIsLoggedIn`）
- Test: `src/background/checkIsLoggedIn.test.ts`（新規）

**Interfaces:**
- Consumes/Produces: `checkIsLoggedIn(courses: Course[]): Promise<'ok' | 'login_required' | 'network_error'>`（シグネチャ不変・判定改善）

- [ ] **Step 1: 失敗するテストを書く**

Create `src/background/checkIsLoggedIn.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { checkIsLoggedIn } from './index'
import type { Course } from '../core/types'

const courses: Course[] = [
  { id: 'c1', name: 'X', url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1', enabled: true },
]

afterEach(() => vi.unstubAllGlobals())

describe('checkIsLoggedIn', () => {
  it('未ログインで外部SSOへリダイレクト(opaqueredirect)なら login_required', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'opaqueredirect', ok: false, url: '', text: async () => '' })))
    expect(await checkIsLoggedIn(courses)).toBe('login_required')
  })

  it('/login/ に着地したら login_required', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'basic', ok: true, url: 'https://letus.ed.tus.ac.jp/login/index.php', text: async () => '' })))
    expect(await checkIsLoggedIn(courses)).toBe('login_required')
  })

  it('200だが未ログイン文言を含むなら login_required', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'basic', ok: true, url: courses[0].url, text: async () => 'あなたはログインしていません' })))
    expect(await checkIsLoggedIn(courses)).toBe('login_required')
  })

  it('正常な200・課題ページなら ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'basic', ok: true, url: courses[0].url, text: async () => '<html>コース</html>' })))
    expect(await checkIsLoggedIn(courses)).toBe('ok')
  })

  it('fetch例外は network_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    expect(await checkIsLoggedIn(courses)).toBe('network_error')
  })

  it('5xxは network_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'basic', ok: false, url: courses[0].url, text: async () => '' })))
    expect(await checkIsLoggedIn(courses)).toBe('network_error')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/background/checkIsLoggedIn.test.ts`
Expected: FAIL（opaqueredirectケースが現状 `network_error` を返すため）

- [ ] **Step 3: `checkIsLoggedIn` を実装**

`src/background/index.ts` の `checkIsLoggedIn` 本体を差し替え:

```ts
export async function checkIsLoggedIn(
  courses: Course[],
): Promise<'ok' | 'login_required' | 'network_error'> {
  const course = courses.find((c) => c.enabled)
  if (!course) return 'ok'
  try {
    const response = await fetch(course.url, {
      credentials: 'include',
      redirect: 'manual',
    })
    // 未ログイン時は course ページが login/SSO へリダイレクトする。
    // redirect:'manual' では（同一/別オリジン問わず）opaqueredirect になる。
    if (response.type === 'opaqueredirect') return 'login_required'
    if (!response.ok) return 'network_error'
    if (response.url.includes('/login/')) return 'login_required'
    const html = await response.text()
    return isNotLoggedInPageContent(html) ? 'login_required' : 'ok'
  } catch {
    return 'network_error'
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/background/checkIsLoggedIn.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: コミット**

```bash
git add src/background/index.ts src/background/checkIsLoggedIn.test.ts
git commit -m "fix(login): detect SSO redirect as login_required not network_error

未ログイン時にLETUSが外部SSOへリダイレクトすると fetch が例外化し通信エラー表示に
なっていた。redirect:'manual' で opaqueredirect を検出し login_required を返す。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task A3: v1.0.6 バージョン確認・ビルド

**Files:**
- Modify: `public/manifest.json`（version 確認）

- [ ] **Step 1: manifest の version が `1.0.6` であることを確認**

`public/manifest.json` の `"version"` を確認。`1.0.5` のままなら `1.0.6` に更新する。

- [ ] **Step 2: 本番ビルド**

Run: `pnpm build`
Expected: `dist/` に成功出力（エラーなし）

- [ ] **Step 3: dist の background に修正が入っていることを確認**

Run: `grep -c "終了済み" dist/background.js`
Expected: `1` 以上

- [ ] **Step 4: コミット（version変更があれば）**

```bash
git add public/manifest.json
git commit -m "chore(release): bump version to 1.0.6

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Phase B — v1.1.0 本改造（worktree: `C:\dev\lms-task-watcher-v1.1.x-qa`, branch qa/v1.1.x-release）

締切解析をモジュール化し ①②③④⑤ を実装。以降のコマンドはこの worktree で実行する。

### Task B1: 締切解析モジュール切り出し ＋ ①ラベル拡充（回帰テスト付き）

**Files:**
- Create: `src/background/deadlineParser.ts`
- Create: `src/background/deadlineParser.test.ts`
- Modify: `src/background/index.ts`（該当関数を削除し import に置換）

**Interfaces:**
- Produces:
  - `extractDeadlineText(plainText: string): string`
  - `parseDeadline(deadlineText: string): string | null`
  - `toIsoStringFromParts(year: string, month: string, day: string, hour: string, minute: string): string | null`
- Consumes: `index.ts` の `normalizeText`（モジュールにローカルコピーを持たせる）

- [ ] **Step 1: 失敗する回帰テストを書く**

Create `src/background/deadlineParser.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { extractDeadlineText, parseDeadline } from './deadlineParser'

const jst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null

describe('extractDeadlineText + parseDeadline (実データ回帰)', () => {
  it('終了済みの閉じた小テストを拾う', () => {
    const text = '創域特別講義: 小試験 開始済み: 2026年 06月 08日(月曜日) 00:00 終了済み: 2026年 06月 19日(金曜日) 23:59 受験可能期間：6月8日'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/6/19 23:59:00')
  })

  it('期限:フィールドの課題を拾う', () => {
    const text = '期限: 2026年 05月 18日(月曜日) 23:59 1回目のグループワークの提出フォームです。'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/5/18 23:59:00')
  })

  it('終了予定の受付中小テストを拾う', () => {
    const text = '終了予定: 2026年 07月 10日(金曜日) 00:00 制限時間は10分間'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/7/10 0:00:00')
  })

  it('締切なし(開始日時のみ)は null', () => {
    const text = '正誤問題 開始日時: 2026年 04月 21日(月曜日) 00:00 制限時間なし'
    expect(parseDeadline(extractDeadlineText(text))).toBe(null)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/background/deadlineParser.test.ts`
Expected: FAIL（モジュール未作成で import エラー）

- [ ] **Step 3: `deadlineParser.ts` を作成**

`index.ts` から `normalizeText`・`toIsoStringFromParts`・`extractDeadlineText`・`parseDeadline` を移設し、①（`終了済み`/`開始済み`）を反映して export する:

```ts
// 締切テキスト抽出・日付パース（純粋関数・単体テスト可能）

function normalizeText(text: unknown): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ')
}

export function toIsoStringFromParts(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
): string | null {
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  )
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const DEADLINE_KEYWORDS = [
  '提出期限', '提出締切', '締切日時', '締切', '期限', '終了予定', '終了済み', '終了日時',
  '利用終了日時', '受験終了', '回答終了',
  'Due date', 'Closing date', 'Close date', 'Closes', 'Due', 'Close',
]

const START_KEYWORDS = [
  '開始予定', '開始日時', '開始済み', '開始', '利用開始日時', '受験開始', '公開日時', '公開',
  'Open date', 'Opened', 'Available from',
]

export function extractDeadlineText(plainText: string): string {
  const text = normalizeText(plainText)
  const lowerText = text.toLowerCase()
  let bestIndex = -1

  for (const keyword of DEADLINE_KEYWORDS) {
    const index = lowerText.indexOf(keyword.toLowerCase())
    if (index >= 0 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index
    }
  }

  if (bestIndex >= 0) {
    return text.slice(bestIndex, Math.min(text.length, bestIndex + 320))
  }

  const hasStartOnlyKeyword = START_KEYWORDS.some((keyword) =>
    lowerText.includes(keyword.toLowerCase()),
  )
  if (hasStartOnlyKeyword) return ''
  return ''
}

export function parseDeadline(deadlineText: string): string | null {
  const text = normalizeText(deadlineText)

  const japaneseDateMatch = text.match(
    /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[(（][^)）]*[)）])?\s*(?:(\d{1,2})\s*(?:時|:|：)\s*(\d{1,2})?\s*分?)?/,
  )
  if (japaneseDateMatch) {
    const hasHour = japaneseDateMatch[4] !== undefined
    return toIsoStringFromParts(
      japaneseDateMatch[1],
      japaneseDateMatch[2],
      japaneseDateMatch[3],
      hasHour ? japaneseDateMatch[4] : '23',
      hasHour ? (japaneseDateMatch[5] ?? '00') : '59',
    )
  }

  const noYearJapaneseDateMatch = text.match(
    /(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[(（][^)）]*[)）])?\s*(?:(\d{1,2})\s*(?:時|:|：)\s*(\d{1,2})?\s*分?)?/,
  )
  if (noYearJapaneseDateMatch) {
    const currentYear = String(new Date().getFullYear())
    const hasHour = noYearJapaneseDateMatch[3] !== undefined
    return toIsoStringFromParts(
      currentYear,
      noYearJapaneseDateMatch[1],
      noYearJapaneseDateMatch[2],
      hasHour ? noYearJapaneseDateMatch[3] : '23',
      hasHour ? (noYearJapaneseDateMatch[4] ?? '00') : '59',
    )
  }

  return null
}
```

- [ ] **Step 4: `index.ts` から移設した関数を削除し import に置換**

`index.ts` 冒頭の import群に追加:

```ts
import {
  extractDeadlineText,
  parseDeadline,
  toIsoStringFromParts,
} from './deadlineParser'
```

`index.ts` 内の `toIsoStringFromParts`・`extractDeadlineText`・`parseDeadline` の**関数定義を削除**する（`normalizeText` は他でも使うため index.ts に残す）。

- [ ] **Step 5: テストと型チェック**

Run: `pnpm exec vitest run src/background/deadlineParser.test.ts && pnpm exec tsc -b`
Expected: PASS（4件）+ 型エラーなし

- [ ] **Step 6: 既存テストが壊れないこと**

Run: `pnpm exec vitest run`
Expected: 全 PASS

- [ ] **Step 7: コミット**

```bash
git add src/background/deadlineParser.ts src/background/deadlineParser.test.ts src/background/index.ts
git commit -m "refactor(deadline): extract deadlineParser module + add 終了済み label

締切解析を純粋関数モジュール化して単体テスト可能にし、①終了済み/開始済みラベルを追加。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B2: ② コロン付きラベル優先抽出

**Files:**
- Modify: `src/background/deadlineParser.ts`（`extractDeadlineText`）
- Modify: `src/background/deadlineParser.test.ts`

**Interfaces:**
- 変更なし（`extractDeadlineText` の選択規則のみ改善）

- [ ] **Step 1: 失敗するテストを追加**

`deadlineParser.test.ts` に追記:

```ts
describe('② コロン付きラベル優先', () => {
  it('タイトルの締切(パレン)を無視し本文の期限:を優先', () => {
    const text = '締切（5/29 14:40) | LETUS 2026 ナビ 期限: 2026年 05月 29日(金曜日) 14:40 以下について取り組み'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/5/29 14:40:00')
  })

  it('ナビの締切：7月3日より本文の終了済み:を優先', () => {
    const text = '創域特別講義: 小試験 終了済み: 2026年 06月 19日(金曜日) 23:59 ……ナビ…… 第13回小テスト（締切：7月3日） 履修方法'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/6/19 23:59:00')
  })

  it('コロン付きが無ければ従来どおり最早キーワードにフォールバック', () => {
    const text = '締切 2026年 06月 01日(月曜日) 23:59'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/6/1 23:59:00')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/background/deadlineParser.test.ts`
Expected: FAIL（1件目が `締切（5/29` を拾い null/誤値になる）

- [ ] **Step 3: `extractDeadlineText` を改修**

キーワードの全出現を走査し、直後が `：`/`:` の「コロン付きフィールド」を最優先、無ければ最早の裸キーワードにフォールバックする:

```ts
export function extractDeadlineText(plainText: string): string {
  const text = normalizeText(plainText)
  const lowerText = text.toLowerCase()
  let bestColonIndex = -1
  let bestBareIndex = -1

  for (const keyword of DEADLINE_KEYWORDS) {
    const lowerKeyword = keyword.toLowerCase()
    let from = 0
    let index: number
    while ((index = lowerText.indexOf(lowerKeyword, from)) >= 0) {
      if (bestBareIndex === -1 || index < bestBareIndex) bestBareIndex = index
      // キーワード直後（空白を挟んで）が : or ： なら実フィールドとみなす
      const after = text.slice(index + keyword.length, index + keyword.length + 3)
      if (/^\s*[:：]/.test(after)) {
        if (bestColonIndex === -1 || index < bestColonIndex) bestColonIndex = index
      }
      from = index + keyword.length
    }
  }

  const chosen = bestColonIndex >= 0 ? bestColonIndex : bestBareIndex
  if (chosen >= 0) {
    return text.slice(chosen, Math.min(text.length, chosen + 320))
  }

  const hasStartOnlyKeyword = START_KEYWORDS.some((keyword) =>
    lowerText.includes(keyword.toLowerCase()),
  )
  if (hasStartOnlyKeyword) return ''
  return ''
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/background/deadlineParser.test.ts`
Expected: PASS（B1の4件 + B2の3件）

- [ ] **Step 5: コミット**

```bash
git add src/background/deadlineParser.ts src/background/deadlineParser.test.ts
git commit -m "fix(deadline): prefer colon-labeled fields over bare keyword mentions

タイトル/ナビのアクティビティ名(締切（…)/締切：…)より、本文の実フィールド
(期限:/終了済み:)を優先。締切(5/29)が期限:を拾って正しく回復。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B3: ③ スラッシュ日付対応

**Files:**
- Modify: `src/background/deadlineParser.ts`（`parseDeadline`）
- Modify: `src/background/deadlineParser.test.ts`

**Interfaces:**
- 変更なし（`parseDeadline` にフォールバック追加）

- [ ] **Step 1: 失敗するテストを追加**

```ts
describe('③ スラッシュ日付', () => {
  it('M/D HH:MM を解析', () => {
    const text = '締切: 5/29 14:40 まで'
    expect(jst(parseDeadline(text))).toBe('2026/5/29 14:40:00')
  })

  it('YYYY/M/D を解析(時刻なし→23:59)', () => {
    const text = '締切: 2026/6/1 提出のこと'
    expect(jst(parseDeadline(text))).toBe('2026/6/1 23:59:00')
  })

  it('不正な月日(13/40)は不採用でnull', () => {
    const text = '締切: 13/40'
    expect(parseDeadline(text)).toBe(null)
  })

  it('日本語日付が優先される(スラッシュより先)', () => {
    const text = '期限: 2026年 06月 19日 23:59 (7/3更新)'
    expect(jst(parseDeadline(text))).toBe('2026/6/19 23:59:00')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/background/deadlineParser.test.ts`
Expected: FAIL（スラッシュ3件が null）

- [ ] **Step 3: `parseDeadline` にスラッシュ・フォールバックを追加**

`return null` の直前に挿入（日本語日付マッチの後）:

```ts
  const slashDateMatch = text.match(
    /(?:(20\d{2})\/)?(\d{1,2})\/(\d{1,2})(?:\s*[(（][^)）]*[)）])?\s*(?:(\d{1,2})\s*[:：]\s*(\d{1,2}))?/,
  )
  if (slashDateMatch) {
    const month = Number(slashDateMatch[2])
    const day = Number(slashDateMatch[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = slashDateMatch[1] ?? String(new Date().getFullYear())
      const hasHour = slashDateMatch[4] !== undefined
      return toIsoStringFromParts(
        year,
        slashDateMatch[2],
        slashDateMatch[3],
        hasHour ? slashDateMatch[4] : '23',
        hasHour ? (slashDateMatch[5] ?? '00') : '59',
      )
    }
  }

  return null
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/background/deadlineParser.test.ts`
Expected: PASS（B1-B3 全件）

- [ ] **Step 5: コミット**

```bash
git add src/background/deadlineParser.ts src/background/deadlineParser.test.ts
git commit -m "feat(deadline): parse slash dates (M/D, YYYY/M/D) as fallback

日本語日付が無い場合のフォールバックとしてスラッシュ表記を解析。月日の妥当性
チェックで誤検知を抑制。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B4: ④ タイトル締切フォールバック（推定）＋ 型 ＋ UI

**Files:**
- Modify: `src/background/deadlineParser.ts`（`parseDeadlineFromTitle` 追加）
- Modify: `src/background/deadlineParser.test.ts`
- Modify: `src/core/types.ts`（`Assignment` に `deadlineSource`）
- Modify: `src/background/index.ts`（候補処理で本文→タイトルの順に締切決定・`deadlineSource` 設定）
- Modify: `src/components/AssignmentCard.tsx`（推定バッジ表示）

**Interfaces:**
- Produces: `parseDeadlineFromTitle(title: string): string | null`
- Produces: `Assignment.deadlineSource: 'field' | 'title' | null`

- [ ] **Step 1: 失敗するテスト（パーサ）を追加**

```ts
import { extractDeadlineText, parseDeadline, parseDeadlineFromTitle } from './deadlineParser'

describe('④ タイトル締切フォールバック', () => {
  it('（締切：7月3日）を推定', () => {
    expect(jst(parseDeadlineFromTitle('第13回小テスト（締切：7月3日）'))).toBe('2026/7/3 23:59:00')
  })
  it('（提出締め切り5月18日）を推定', () => {
    expect(jst(parseDeadlineFromTitle('課題提出フォーム（提出締め切り5月18日）'))).toBe('2026/5/18 23:59:00')
  })
  it('締切（5/29 14:40) を推定', () => {
    expect(jst(parseDeadlineFromTitle('締切（5/29 14:40)'))).toBe('2026/5/29 14:40:00')
  })
  it('日付の無い曜日〆は null', () => {
    expect(parseDeadlineFromTitle('WK1 宿題窓口（金曜日〆）')).toBe(null)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/background/deadlineParser.test.ts`
Expected: FAIL（`parseDeadlineFromTitle` 未定義）

- [ ] **Step 3: `parseDeadlineFromTitle` を実装**

`deadlineParser.ts` に追加。締切系の語（締切/締め切り/〆/期限/Due）が含まれる時のみ、タイトル全体を `parseDeadline` に通して日付を推定する:

```ts
export function parseDeadlineFromTitle(title: string): string | null {
  const text = normalizeText(title)
  // 締切を示す語が含まれるときのみ推定する（無関係な数字の誤検知を防ぐ）
  if (!/(締切|締め切り|〆|期限|due|close)/i.test(text)) return null
  return parseDeadline(text)
}
```

- [ ] **Step 4: パーサテストが通ることを確認**

Run: `pnpm exec vitest run src/background/deadlineParser.test.ts`
Expected: PASS（④4件含む全件）

- [ ] **Step 5: `Assignment` 型に `deadlineSource` を追加**

`src/core/types.ts` の `Assignment` の `deadlineText: string` の直後に追加:

```ts
  deadlineText: string
  deadlineSource: 'field' | 'title' | null
```

- [ ] **Step 6: `index.ts` の候補処理で締切決定を更新**

`import` にタイトルパーサを追加:

```ts
import {
  extractDeadlineText,
  parseDeadline,
  parseDeadlineFromTitle,
  toIsoStringFromParts,
} from './deadlineParser'
```

候補処理（`const deadlineText = extractDeadlineText(plainText)` 付近）を次のように変更し、本文で取れない時のみタイトル推定へフォールバックする。返却オブジェクトに `deadlineSource` を追加:

```ts
        const deadlineText = extractDeadlineText(plainText)
        const fieldDeadline = deadlineText ? parseDeadline(deadlineText) : null
        const titleDeadline = fieldDeadline
          ? null
          : parseDeadlineFromTitle(candidate.title)
        const deadline = fieldDeadline ?? titleDeadline
        const deadlineSource: 'field' | 'title' | null = fieldDeadline
          ? 'field'
          : titleDeadline
            ? 'title'
            : null
```

返却オブジェクトの `deadlineText: deadlineText ?? '',` の直後に追加:

```ts
          deadlineText: deadlineText ?? '',
          deadlineSource,
```

- [ ] **Step 7: `AssignmentCard.tsx` に推定バッジを表示**

`src/components/AssignmentCard.tsx` の締切表示（`<span className="dateText">{formatDeadline(assignment.deadline)}</span>`）を次のように変更:

```tsx
        <span className="dateText">
          {formatDeadline(assignment.deadline)}
          {assignment.deadlineSource === 'title' && (
            <span className="estimatedBadge" title="課題名から推定した締切です">
              （推定）
            </span>
          )}
        </span>
```

- [ ] **Step 8: 型チェック・全テスト・ビルド**

Run: `pnpm exec tsc -b && pnpm exec vitest run && pnpm build`
Expected: 型エラーなし・全 PASS・ビルド成功

（注: `Assignment` を生成する既存テスト/コードでコンパイルエラーが出たら、そこに `deadlineSource: null` を補って修正する。）

- [ ] **Step 9: コミット**

```bash
git add src/background/deadlineParser.ts src/background/deadlineParser.test.ts src/core/types.ts src/background/index.ts src/components/AssignmentCard.tsx
git commit -m "feat(deadline): title-embedded deadline fallback with estimated badge

本文に締切が無い場合のみ課題名の（締切…）等から推定。deadlineSourceで区別し
UIに（推定）バッジを表示。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B5: ⑤ ログイン検知修正（v1.1.0）

Phase A の Task A2 と同一内容を v1.1.x worktree に適用する。

**Files:**
- Modify: `src/background/index.ts`（`checkIsLoggedIn`）
- Test: `src/background/checkIsLoggedIn.test.ts`（新規）

- [ ] **Step 1: 失敗するテストを書く**

Task A2 Step 1 と同一のテストファイルを作成する（内容は A2 Step 1 のコードブロックを参照し、そのまま複製）。

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/background/checkIsLoggedIn.test.ts`
Expected: FAIL

- [ ] **Step 3: `checkIsLoggedIn` を実装**

Task A2 Step 3 と同一の実装に差し替える（`redirect:'manual'` + `opaqueredirect` 判定）。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/background/checkIsLoggedIn.test.ts`
Expected: PASS（6件）

- [ ] **Step 5: コミット**

```bash
git add src/background/index.ts src/background/checkIsLoggedIn.test.ts
git commit -m "fix(login): detect SSO redirect as login_required not network_error

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task B6: v1.1.0 総合確認

- [ ] **Step 1: 全テスト・型・本番ビルド**

Run: `pnpm exec vitest run && pnpm exec tsc -b && pnpm build`
Expected: 全 PASS・型エラーなし・ビルド成功

- [ ] **Step 2: dist 反映確認**

Run: `grep -c "終了済み" dist/background.js`
Expected: `1` 以上

- [ ] **Step 3: 拡張を読み込み手動確認（任意・推奨）**

`dist/` を Chrome にロードし、対象コースで「今すぐ更新」→ 閉じた小テストの締切が正しい日付になること、（推定）バッジ、未ログイン時に「ログインしてください」表示になることを確認。

---

## Phase C — develop へマージフォワード（worktree: `C:\dev\lms-task-watcher`, branch develop）

- [ ] **Step 1: develop を最新化**

Run: `git -C C:/dev/lms-task-watcher fetch origin && git -C C:/dev/lms-task-watcher status`
Expected: develop がクリーン

- [ ] **Step 2: v1.1.x を develop にマージ**

Run: `git -C C:/dev/lms-task-watcher merge qa/v1.1.x-release`
Expected: マージ成功。コンフリクトが出たら `src/background/index.ts`（develop固有のサブスク処理を残しつつ締切/ログイン変更を取り込む）・`src/core/types.ts`・`src/App.tsx`/`AssignmentCard.tsx` を手動解消。

- [ ] **Step 3: develop で全テスト・型・ビルド**

Run: `pnpm -C C:/dev/lms-task-watcher exec vitest run && pnpm -C C:/dev/lms-task-watcher exec tsc -b && pnpm -C C:/dev/lms-task-watcher build`
Expected: 全 PASS・ビルド成功

- [ ] **Step 4: マージコミット確認（コンフリクト解消時）**

解消した場合はコミットする（マージコミットメッセージに Co-Authored-By を付す）。

---

## Self-Review 結果

- **Spec coverage:** ①=A1/B1, ②=B2, ③=B3, ④=B4, ⑤=A2/B5, リファクタ=B1, テスト=各Task, develop伝播=Phase C。全項目に対応タスクあり。
- **Placeholder:** なし（全コード実体記載。B5はA2の複製を明示指示）。
- **Type consistency:** `deadlineSource: 'field' | 'title' | null` を types.ts(B4-5)・index.ts(B4-6)・AssignmentCard(B4-7) で統一。`checkIsLoggedIn` の戻り型は全Taskで `'ok'|'login_required'|'network_error'` 一致。`extractDeadlineText`/`parseDeadline`/`parseDeadlineFromTitle` のシグネチャは B1-B4 で一貫。
