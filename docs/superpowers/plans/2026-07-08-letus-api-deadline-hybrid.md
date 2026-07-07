# LETUS API締切ハイブリッド Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 締切スキャンの締切値をMoodle sesskey AJAX API（Unix秒）で上書きし、日本語日付regexの誤読を排除する（常時ON・失敗時は現行regex経路へ自動フォールバック）。

**Architecture:** 純粋層 `src/core/letusApi.ts`（sesskey抽出・URL正規化・イベント→締切Map変換、litus移植前提でChrome/fetch非依存）と、I/O層 `src/background/index.ts`（service.phpへのPOST・既存ログイン確認fetchへのsesskey抽出相乗り・締切上書き結線）の2層。既存のHTML課題ページ訪問（提出状態の正）は無変更。

**Tech Stack:** TypeScript / Vite / vitest（`pnpm vitest run`）/ Chrome Extension MV3 background service worker

**Spec:** `docs/superpowers/specs/2026-07-08-letus-api-deadline-hybrid-design.md`

## Global Constraints

- sesskeyは関数引数の受け渡しのみ。`chrome.storage` 保存・`console.log` 出力・エラーメッセージへの混入を禁止
- API失敗時の挙動＝現行挙動（`apiDeadlines` 空Mapで全件regex経路）。scanStatusにAPIエラーを反映させない
- `src/core/letusApi.ts` はChrome API・fetch・DOMに依存しない純粋モジュール（litus移植のため）
- 候補スキャン・コース更新検知・月間ビューAPI・P2コース一覧APIは触らない
- テストは既存規約: 純粋層は素のvitest、background層は `checkIsLoggedIn.test.ts` のchromeスタブパターンを踏襲
- コミットメッセージは既存規約（`feat:`/`fix:`/`test:`、日本語本文）

**作業ブランチ**: 開始前に `git checkout develop && git pull origin develop && git checkout -b feature/letus-api-deadline`

---

### Task 1: extractSesskey（純粋層・sesskey抽出）

**Files:**
- Create: `src/core/letusApi.ts`
- Create: `src/core/letusApi.fixtures.ts`
- Test: `src/core/letusApi.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `extractSesskey(html: string): string | null` — 生HTML中の `"sesskey":"..."` を抽出。Task 5/6 が使用。

- [ ] **Step 1: Write the failing test**

```ts
// src/core/letusApi.test.ts
import { describe, it, expect } from 'vitest'
import { extractSesskey } from './letusApi'
import { SESSKEY_HTML_SNIPPET } from './letusApi.fixtures'

describe('extractSesskey', () => {
  it('ログイン済みページHTMLのM.cfgインラインJSONからsesskeyを抽出する', () => {
    expect(extractSesskey(SESSKEY_HTML_SNIPPET)).toBe('AbCd012345')
  })

  it('sesskeyを含まないHTMLはnull', () => {
    expect(extractSesskey('<html><body>login page</body></html>')).toBe(null)
  })

  it('壊れた入力（空文字）はnull', () => {
    expect(extractSesskey('')).toBe(null)
  })
})
```

```ts
// src/core/letusApi.fixtures.ts
/**
 * LETUS本番の実測データを匿名化したfixture（2026-07-07実測）。
 * 設計: docs/superpowers/specs/2026-07-08-letus-api-deadline-hybrid-design.md
 */

/** ログイン済みLETUSページの M.cfg インラインscript断片（sesskeyは10文字英数字・実測形状） */
export const SESSKEY_HTML_SNIPPET = `<html><head><script>
//<![CDATA[
var M = {}; M.yui = {};
M.pageloadstarttime = new Date();
M.cfg = {"wwwroot":"https:\\/\\/letus.ed.tus.ac.jp","sesskey":"AbCd012345","sessiontimeout":"28800","themerev":"1751000000","slasharguments":1,"theme":"classic"};
//]]>
</script></head><body>dashboard</body></html>`
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/letusApi.test.ts`
Expected: FAIL（`./letusApi` が存在しない）

- [ ] **Step 3: Write minimal implementation**

```ts
// src/core/letusApi.ts
/**
 * LETUS(Moodle) sesskey AJAX APIの純粋ロジック。
 * 設計: docs/superpowers/specs/2026-07-08-letus-api-deadline-hybrid-design.md
 * Chrome API・fetch・DOMに依存しない（litusへそのまま移植する前提）。
 */

/** ログイン済みLETUSページの生HTMLから sesskey を抽出する（M.cfgのインラインJSON形状）。 */
export function extractSesskey(html: string): string | null {
  const m = String(html).match(/"sesskey":"([A-Za-z0-9]+)"/)
  return m ? m[1] : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/letusApi.test.ts`
Expected: PASS（3件）

- [ ] **Step 5: Commit**

```bash
git add src/core/letusApi.ts src/core/letusApi.fixtures.ts src/core/letusApi.test.ts
git commit -m "feat(core): LETUS APIハイブリッドの純粋層を開始（extractSesskey）"
```

---

### Task 2: normalizeAssignmentUrl（純粋層・URL正規化）

**Files:**
- Modify: `src/core/letusApi.ts`
- Test: `src/core/letusApi.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `normalizeAssignmentUrl(url: string): string | null` — `/mod/<module>/view.php?id=N` をオリジン＋パス＋idのみへ射影。対象外URL・不正URLは null。Task 3/6 が突合キーとして使用。

- [ ] **Step 1: Write the failing test**

`src/core/letusApi.test.ts` に追記:

```ts
import { extractSesskey, normalizeAssignmentUrl } from './letusApi'

describe('normalizeAssignmentUrl', () => {
  it('余計なクエリ（forceview等）を落としてid のみに正規化する', () => {
    expect(
      normalizeAssignmentUrl('https://letus.ed.tus.ac.jp/mod/assign/view.php?id=2204486&forceview=1'),
    ).toBe('https://letus.ed.tus.ac.jp/mod/assign/view.php?id=2204486')
  })

  it('フラグメントを落とす', () => {
    expect(
      normalizeAssignmentUrl('https://letus.ed.tus.ac.jp/mod/assign/view.php?id=123#intro'),
    ).toBe('https://letus.ed.tus.ac.jp/mod/assign/view.php?id=123')
  })

  it('quiz等の非assignモジュールも対象（/mod/*/view.php 全般）', () => {
    expect(
      normalizeAssignmentUrl('https://letus.ed.tus.ac.jp/mod/quiz/view.php?id=2212000'),
    ).toBe('https://letus.ed.tus.ac.jp/mod/quiz/view.php?id=2212000')
  })

  it('/mod/*/view.php 以外のURLはnull', () => {
    expect(normalizeAssignmentUrl('https://letus.ed.tus.ac.jp/course/view.php?id=216427')).toBe(null)
    expect(normalizeAssignmentUrl('https://letus.ed.tus.ac.jp/my/')).toBe(null)
  })

  it('idパラメータ欠落・非数値・不正URLはnull', () => {
    expect(normalizeAssignmentUrl('https://letus.ed.tus.ac.jp/mod/assign/view.php')).toBe(null)
    expect(normalizeAssignmentUrl('https://letus.ed.tus.ac.jp/mod/assign/view.php?id=abc')).toBe(null)
    expect(normalizeAssignmentUrl('not a url')).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/letusApi.test.ts`
Expected: FAIL（`normalizeAssignmentUrl` 未定義）

- [ ] **Step 3: Write minimal implementation**

`src/core/letusApi.ts` に追記:

```ts
/**
 * /mod/<module>/view.php?id=N をオリジン＋パス＋idのみへ正規化する（突合キー）。
 * APIイベントの url と候補リンクの url でクエリ順・余計なパラメータが揺れるため。
 * 対象外URL（コースページ等）・id欠落・不正URLは null。
 */
export function normalizeAssignmentUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (!/\/mod\/[^/]+\/view\.php$/.test(u.pathname)) return null
    const id = u.searchParams.get('id')
    if (!id || !/^\d+$/.test(id)) return null
    return `${u.origin}${u.pathname}?id=${id}`
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/letusApi.test.ts`
Expected: PASS（8件）

- [ ] **Step 5: Commit**

```bash
git add src/core/letusApi.ts src/core/letusApi.test.ts
git commit -m "feat(core): 課題URL正規化 normalizeAssignmentUrl（API突合キー）"
```

---

### Task 3: mapActionEvents（純粋層・API応答→締切Map）

**Files:**
- Modify: `src/core/letusApi.ts`
- Modify: `src/core/letusApi.fixtures.ts`
- Test: `src/core/letusApi.test.ts`

**Interfaces:**
- Consumes: `normalizeAssignmentUrl`（Task 2）
- Produces: `type LetusApiDeadline = { deadlineIso: string; overdue: boolean }` / `mapActionEvents(json: unknown): Map<string, LetusApiDeadline>` — service.php応答のパース済みJSONを検証し、正規化URL→締切のMapへ。不正入力は空Map/エントリスキップ。Task 6 が使用。

- [ ] **Step 1: Write the failing test**

`src/core/letusApi.fixtures.ts` に追記（2026-07-07実測応答の匿名化。フィールド構成は実測どおり）:

```ts
/** P1成功応答（実測形状の匿名化）。assign 2件（1件overdue）＋quiz 1件＋不正1件 */
export const ACTION_EVENTS_RESPONSE = [
  {
    error: false,
    data: {
      events: [
        {
          id: 111,
          name: '「6月19日提示レポート」の提出期限',
          activityname: '6月19日提示レポート',
          modulename: 'assign',
          instance: 2204486,
          eventtype: 'due',
          timesort: 1782399600,
          overdue: true,
          course: {
            id: 216427,
            fullname: '線形代数学１（１組） (9973515)',
            viewurl: 'https://letus.ed.tus.ac.jp/course/view.php?id=216427',
          },
          url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=2204486',
        },
        {
          id: 112,
          name: '「課題の提出」の提出期限',
          activityname: '課題の提出',
          modulename: 'assign',
          instance: 2210330,
          eventtype: 'due',
          timesort: 1783436340,
          overdue: false,
          course: {
            id: 216404,
            fullname: '基礎情報工学Ａ (9973339)',
            viewurl: 'https://letus.ed.tus.ac.jp/course/view.php?id=216404',
          },
          url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=2210330&forceview=1',
        },
        {
          id: 113,
          name: '「第10回小テスト」終了日時',
          activityname: '第10回小テスト',
          modulename: 'quiz',
          instance: 900001,
          eventtype: 'close',
          timesort: 1783609200,
          overdue: false,
          course: {
            id: 216404,
            fullname: '基礎情報工学Ａ (9973339)',
            viewurl: 'https://letus.ed.tus.ac.jp/course/view.php?id=216404',
          },
          url: 'https://letus.ed.tus.ac.jp/mod/quiz/view.php?id=2212000',
        },
        { id: 114, name: 'url欠落の不正イベント', timesort: 1783609200 },
      ],
      firstid: 111,
      lastid: 114,
    },
  },
]

/** sesskey不正時のエラー応答（実測形状） */
export const ACTION_EVENTS_ERROR_RESPONSE = [
  { error: true, exception: { errorcode: 'invalidsesskey', message: 'Invalid sesskey' } },
]
```

`src/core/letusApi.test.ts` に追記:

```ts
import { extractSesskey, normalizeAssignmentUrl, mapActionEvents } from './letusApi'
import {
  SESSKEY_HTML_SNIPPET,
  ACTION_EVENTS_RESPONSE,
  ACTION_EVENTS_ERROR_RESPONSE,
} from './letusApi.fixtures'

describe('mapActionEvents', () => {
  it('実測形状の成功応答から正規化URL→締切のMapを作る（不正イベントはスキップ）', () => {
    const map = mapActionEvents(ACTION_EVENTS_RESPONSE)
    expect(map.size).toBe(3)
    expect(map.get('https://letus.ed.tus.ac.jp/mod/assign/view.php?id=2204486')).toEqual({
      deadlineIso: new Date(1782399600 * 1000).toISOString(),
      overdue: true,
    })
    // forceview=1 付きイベントも正規化キーで引ける
    expect(map.get('https://letus.ed.tus.ac.jp/mod/assign/view.php?id=2210330')).toEqual({
      deadlineIso: new Date(1783436340 * 1000).toISOString(),
      overdue: false,
    })
    // quizも対象
    expect(map.has('https://letus.ed.tus.ac.jp/mod/quiz/view.php?id=2212000')).toBe(true)
  })

  it('エラー応答（error:true）は空Map', () => {
    expect(mapActionEvents(ACTION_EVENTS_ERROR_RESPONSE).size).toBe(0)
  })

  it('events空・非配列・null・非JSON形状は空Map', () => {
    expect(mapActionEvents([{ error: false, data: { events: [] } }]).size).toBe(0)
    expect(mapActionEvents({ error: 'x' }).size).toBe(0)
    expect(mapActionEvents(null).size).toBe(0)
    expect(mapActionEvents('html error page').size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/letusApi.test.ts`
Expected: FAIL（`mapActionEvents` 未定義）

- [ ] **Step 3: Write minimal implementation**

`src/core/letusApi.ts` に追記:

```ts
export type LetusApiDeadline = { deadlineIso: string; overdue: boolean }

/**
 * service.php応答（パース済みJSON）を検証し、正規化URL→締切のMapへ変換する。
 * 応答全体が不正なら空Map、個々のイベントが不正ならそのエントリだけ落とす。
 */
export function mapActionEvents(json: unknown): Map<string, LetusApiDeadline> {
  const map = new Map<string, LetusApiDeadline>()
  if (!Array.isArray(json)) return map
  const first = json[0] as { error?: unknown; data?: { events?: unknown } } | undefined
  if (!first || first.error !== false) return map
  const events = first.data?.events
  if (!Array.isArray(events)) return map
  for (const raw of events) {
    const ev = raw as { url?: unknown; timesort?: unknown; overdue?: unknown }
    if (typeof ev.url !== 'string' || typeof ev.timesort !== 'number') continue
    const key = normalizeAssignmentUrl(ev.url)
    if (!key) continue
    const date = new Date(ev.timesort * 1000)
    if (Number.isNaN(date.getTime())) continue
    map.set(key, { deadlineIso: date.toISOString(), overdue: ev.overdue === true })
  }
  return map
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/letusApi.test.ts`
Expected: PASS（11件）

- [ ] **Step 5: Commit**

```bash
git add src/core/letusApi.ts src/core/letusApi.fixtures.ts src/core/letusApi.test.ts
git commit -m "feat(core): P1応答→締切Map変換 mapActionEvents（実測fixture付き）"
```

---

### Task 4: extractSubmissionStatus 文言バグ修正

**Files:**
- Modify: `src/background/index.ts:196-228`（`extractSubmissionStatus` を export 化＋照合語追加）
- Test: `src/background/submissionStatus.test.ts`（新規）

**Interfaces:**
- Consumes: なし
- Produces: `export function extractSubmissionStatus(plainText: string, url: string): AssignmentSubmissionStatus`（既存関数のexport化。挙動追加: 「まだ提出されていません」→ `'not_submitted'`）

背景（実測 2026-07-07）: LETUS 2026の未提出表示は「まだ提出されていません。」で、照合語「未提出」を含まないため `unknown` に落ちている。

- [ ] **Step 1: Write the failing test**

```ts
// src/background/submissionStatus.test.ts
import { describe, it, expect, vi } from 'vitest'

// ./index はモジュール読込時にchrome APIへ触るためスタブ必須（checkIsLoggedIn.test.ts と同パターン）
vi.stubGlobal('chrome', {
  storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
  notifications: { create: vi.fn(), onClicked: { addListener: vi.fn() }, onClosed: { addListener: vi.fn() } },
  alarms: { create: vi.fn(), get: vi.fn(), onAlarm: { addListener: vi.fn() } },
  runtime: { onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() }, onMessage: { addListener: vi.fn() }, getURL: vi.fn((p: string) => p) },
  tabs: { create: vi.fn() },
})

const { extractSubmissionStatus } = await import('./index')

const ASSIGN_URL = 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1'

describe('extractSubmissionStatus', () => {
  it('LETUS 2026実文言「まだ提出されていません」を not_submitted と判定する', () => {
    const text = '提出ステータス まだ提出されていません。 評定ステータス 未評定 残り時間 残り 23 分'
    expect(extractSubmissionStatus(text, ASSIGN_URL)).toBe('not_submitted')
  })

  it('「評定のために提出済み」は submitted（既存挙動の回帰）', () => {
    const text = '提出ステータス 評定のために提出済み 評定ステータス 未評定'
    expect(extractSubmissionStatus(text, ASSIGN_URL)).toBe('submitted')
  })

  it('どの文言も無ければ unknown（既存挙動の回帰）', () => {
    expect(extractSubmissionStatus('関係ないページ', ASSIGN_URL)).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/background/submissionStatus.test.ts`
Expected: FAIL（`extractSubmissionStatus` が export されていない）

- [ ] **Step 3: Write minimal implementation**

`src/background/index.ts:196` の関数宣言を export 化し、`:224` の not_submitted 判定に照合語を追加:

```ts
export function extractSubmissionStatus(
  plainText: string,
  url: string,
): AssignmentSubmissionStatus {
```

```ts
  if (
    text.includes('未提出') ||
    text.includes('まだ提出されていません') ||
    text.includes('not submitted')
  ) {
    return 'not_submitted'
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/background/submissionStatus.test.ts`
Expected: PASS（3件）。続けて `pnpm vitest run` で全テスト回帰確認 → PASS

- [ ] **Step 5: Commit**

```bash
git add src/background/index.ts src/background/submissionStatus.test.ts
git commit -m "fix(background): LETUS 2026の未提出文言「まだ提出されていません」を not_submitted と判定"
```

---

### Task 5: deadlineSource型拡張＋checkIsLoggedInDetailed（sesskey相乗り）

**Files:**
- Modify: `src/core/types.ts:45`（`deadlineSource` に `'api'` 追加）
- Modify: `src/background/index.ts:852-872`（`checkIsLoggedInDetailed` 追加、既存 `checkIsLoggedIn` は薄いラッパーに）
- Test: `src/background/checkIsLoggedIn.test.ts`（ケース追加）

**Interfaces:**
- Consumes: なし
- Produces:
  - `Assignment.deadlineSource: 'api' | 'field' | 'title' | null`（型変更）
  - `export type LoginCheckResult = { status: 'ok' | 'login_required' | 'network_error'; html: string | null; origin: string | null }`
  - `export async function checkIsLoggedInDetailed(courses: Course[]): Promise<LoginCheckResult>` — ログイン確認と同じ1回のfetchでHTML・オリジンを持ち帰る（Task 6 がsesskey抽出に使用）
  - `checkIsLoggedIn(courses)` は従来シグネチャのまま（`.status` を返すラッパー。他2箇所の呼び出し元とテストは無変更で通る）

- [ ] **Step 1: Write the failing test**

`src/background/checkIsLoggedIn.test.ts` に追記（既存のchromeスタブ・fetchスタブのパターンをそのまま使う）:

```ts
const { checkIsLoggedIn, checkIsLoggedInDetailed } = await import('./index')

describe('checkIsLoggedInDetailed', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ログイン済みならhtmlとoriginを持ち帰る', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      type: 'basic',
      ok: true,
      url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1',
      text: async () => '<html>M.cfg = {"sesskey":"AbCd012345"}</html>',
    })))
    const r = await checkIsLoggedInDetailed(courses)
    expect(r.status).toBe('ok')
    expect(r.html).toContain('sesskey')
    expect(r.origin).toBe('https://letus.ed.tus.ac.jp')
  })

  it('未ログイン（opaqueredirect）はhtml/origin共にnull', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ type: 'opaqueredirect', ok: false, url: '', text: async () => '' })))
    const r = await checkIsLoggedInDetailed(courses)
    expect(r).toEqual({ status: 'login_required', html: null, origin: null })
  })

  it('fetch例外はnetwork_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const r = await checkIsLoggedInDetailed(courses)
    expect(r).toEqual({ status: 'network_error', html: null, origin: null })
  })
})
```

※ `courses` は既存テストファイル冒頭で定義済みのfixtureを使う。既存 `checkIsLoggedIn` のテストは無変更のまま通ること（ラッパー化の回帰確認）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/background/checkIsLoggedIn.test.ts`
Expected: FAIL（`checkIsLoggedInDetailed` 未定義）

- [ ] **Step 3: Write minimal implementation**

`src/core/types.ts:45`:

```ts
  deadlineSource: 'api' | 'field' | 'title' | null
```

`src/background/index.ts:852-872` を置換:

```ts
export type LoginCheckResult = {
  status: 'ok' | 'login_required' | 'network_error'
  html: string | null
  origin: string | null
}

/**
 * ログイン確認と同じ1回のfetchでページHTMLとオリジンを持ち帰る。
 * HTMLはsesskey抽出（LETUS API締切ハイブリッド）に使う＝追加リクエストゼロ。
 */
export async function checkIsLoggedInDetailed(courses: Course[]): Promise<LoginCheckResult> {
  const course = courses.find((c) => c.enabled)
  if (!course) return { status: 'ok', html: null, origin: null }
  try {
    const response = await fetch(course.url, {
      credentials: 'include',
      redirect: 'manual',
    })
    // 未ログイン時は course ページが login/SSO へリダイレクトする。
    // redirect:'manual' では（同一/別オリジン問わず）opaqueredirect になる。
    if (response.type === 'opaqueredirect') return { status: 'login_required', html: null, origin: null }
    if (!response.ok) return { status: 'network_error', html: null, origin: null }
    if (response.url.includes('/login/')) return { status: 'login_required', html: null, origin: null }
    const html = await response.text()
    if (isNotLoggedInPageContent(html)) return { status: 'login_required', html: null, origin: null }
    return { status: 'ok', html, origin: new URL(course.url).origin }
  } catch {
    return { status: 'network_error', html: null, origin: null }
  }
}

export async function checkIsLoggedIn(
  courses: Course[],
): Promise<'ok' | 'login_required' | 'network_error'> {
  return (await checkIsLoggedInDetailed(courses)).status
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/background/checkIsLoggedIn.test.ts`
Expected: PASS（既存ケース含む全件）。`pnpm tsc -b` も通ること（`deadlineSource` 拡張はunion拡大なので既存代入は壊れない）

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/background/index.ts src/background/checkIsLoggedIn.test.ts
git commit -m "feat(background): checkIsLoggedInDetailed（sesskey相乗り用）とdeadlineSource'api'追加"
```

---

### Task 6: fetchActionEvents＋締切スキャン結線

**Files:**
- Modify: `src/background/index.ts`（`fetchActionEvents` 追加・`scanDeadlinesInBackground` 結線。import追加: `extractSesskey, normalizeAssignmentUrl, mapActionEvents, type LetusApiDeadline` from `'../core/letusApi'`）
- Test: `src/background/fetchActionEvents.test.ts`（新規）

**Interfaces:**
- Consumes: `extractSesskey` / `normalizeAssignmentUrl` / `mapActionEvents` / `LetusApiDeadline`（Task 1-3）、`checkIsLoggedInDetailed`（Task 5）
- Produces: `export async function fetchActionEvents(origin: string, sesskey: string): Promise<Map<string, LetusApiDeadline>>` — P1をページングで叩き統合Mapを返す。**いかなる失敗も空Map**（呼び出し側は分岐不要）。

- [ ] **Step 1: Write the failing test**

```ts
// src/background/fetchActionEvents.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.stubGlobal('chrome', {
  storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
  notifications: { create: vi.fn(), onClicked: { addListener: vi.fn() }, onClosed: { addListener: vi.fn() } },
  alarms: { create: vi.fn(), get: vi.fn(), onAlarm: { addListener: vi.fn() } },
  runtime: { onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() }, onMessage: { addListener: vi.fn() }, getURL: vi.fn((p: string) => p) },
  tabs: { create: vi.fn() },
})

const { fetchActionEvents } = await import('./index')
const { ACTION_EVENTS_RESPONSE } = await import('../core/letusApi.fixtures')

const ORIGIN = 'https://letus.ed.tus.ac.jp'

function makeEvent(id: number) {
  return {
    id,
    timesort: 1783000000 + id,
    overdue: false,
    url: `${ORIGIN}/mod/assign/view.php?id=${id}`,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchActionEvents', () => {
  it('成功応答をMapにする（fixture: 有効3件）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ACTION_EVENTS_RESPONSE })))
    const map = await fetchActionEvents(ORIGIN, 'AbCd012345')
    expect(map.size).toBe(3)
  })

  it('50件返るとaftereventidで次ページを取り、50未満で打ち切る', async () => {
    const page1 = [{ error: false, data: { events: Array.from({ length: 50 }, (_, i) => makeEvent(i + 1)), lastid: 50 } }]
    const page2 = [{ error: false, data: { events: [makeEvent(51)], lastid: 51 } }]
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => page1 })
      .mockResolvedValueOnce({ ok: true, json: async () => page2 })
    vi.stubGlobal('fetch', fetchMock)
    const map = await fetchActionEvents(ORIGIN, 'AbCd012345')
    expect(map.size).toBe(51)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondBody[0].args.aftereventid).toBe(50)
  })

  it('HTTP非200は空Map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    expect((await fetchActionEvents(ORIGIN, 'x')).size).toBe(0)
  })

  it('fetch例外（タイムアウト含む）は空Map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('aborted') }))
    expect((await fetchActionEvents(ORIGIN, 'x')).size).toBe(0)
  })

  it('sesskeyをURLにエンコードして送り、bodyにmethodnameを含む', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [{ error: false, data: { events: [] } }] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchActionEvents(ORIGIN, 'AbCd012345')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/lib/ajax/service.php?sesskey=AbCd012345&info=core_calendar_get_action_events_by_timesort')
    expect(String(init.body)).toContain('core_calendar_get_action_events_by_timesort')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/background/fetchActionEvents.test.ts`
Expected: FAIL（`fetchActionEvents` 未定義）

- [ ] **Step 3: Write minimal implementation**

`src/background/index.ts` のimportに追加:

```ts
import {
  extractSesskey,
  normalizeAssignmentUrl,
  mapActionEvents,
  type LetusApiDeadline,
} from '../core/letusApi'
```

`checkIsLoggedInDetailed` の近く（`isNotLoggedInPageContent` の下）に追加:

```ts
// ─── LETUS API deadline hybrid ───────────────────────────────────────────────

const LETUS_API_TIMEOUT_MS = 15000
const LETUS_API_PAGE_LIMIT = 50
const LETUS_API_MAX_PAGES = 4
const LETUS_API_LOOKBACK_SEC = 90 * 24 * 60 * 60 // 期限超過・未提出の残留通知をカバーする90日

/**
 * P1(core_calendar_get_action_events_by_timesort)をページングで叩き、
 * 正規化URL→締切 の統合Mapを返す。いかなる失敗も空Map＝呼び出し側は全件regex経路に自然に落ちる。
 * sesskeyはログ・storageに出さないこと（Global Constraints）。
 */
export async function fetchActionEvents(
  origin: string,
  sesskey: string,
): Promise<Map<string, LetusApiDeadline>> {
  const merged = new Map<string, LetusApiDeadline>()
  let aftereventid: number | null = null
  for (let page = 0; page < LETUS_API_MAX_PAGES; page++) {
    const args: Record<string, number> = {
      limitnum: LETUS_API_PAGE_LIMIT,
      timesortfrom: Math.floor(Date.now() / 1000) - LETUS_API_LOOKBACK_SEC,
    }
    if (aftereventid !== null) args.aftereventid = aftereventid
    let json: unknown
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), LETUS_API_TIMEOUT_MS)
      const response = await fetch(
        `${origin}/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=core_calendar_get_action_events_by_timesort`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([
            { index: 0, methodname: 'core_calendar_get_action_events_by_timesort', args },
          ]),
          signal: controller.signal,
        },
      )
      clearTimeout(timer)
      if (!response.ok) return new Map()
      json = await response.json()
    } catch {
      return new Map()
    }
    const pageMap = mapActionEvents(json)
    for (const [k, v] of pageMap) merged.set(k, v)
    const first = (json as Array<{ data?: { events?: unknown[]; lastid?: unknown } }>)[0]
    const events = first?.data?.events
    if (!Array.isArray(events) || events.length < LETUS_API_PAGE_LIMIT) break
    if (typeof first.data?.lastid !== 'number') break
    aftereventid = first.data.lastid
  }
  return merged
}
```

`scanDeadlinesInBackground` の結線（2箇所）:

(1) `src/background/index.ts:597` 付近 — ログイン確認をdetailed版に差し替え、API締切Mapを構築:

```ts
  const loginCheck = await checkIsLoggedInDetailed(enabledCourses)
  const loginStatus = loginCheck.status
```

（既存の `loginStatus !== 'ok'` 分岐はそのまま）。分岐の後、`const candidates = await getAssignmentCandidates()` の直前に:

```ts
  // API締切マップ（締切の正）。失敗時は空Map＝全件regex経路（現行挙動）
  const sesskey = loginCheck.html ? extractSesskey(loginCheck.html) : null
  const apiDeadlines =
    sesskey && loginCheck.origin
      ? await fetchActionEvents(loginCheck.origin, sesskey)
      : new Map<string, LetusApiDeadline>()
```

(2) `src/background/index.ts:649-658` 付近 — 候補ループ内の締切決定を上書き:

変更前:

```ts
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

変更後:

```ts
        const fieldDeadline = deadlineText ? parseDeadline(deadlineText) : null
        const titleDeadline = fieldDeadline
          ? null
          : parseDeadlineFromTitle(candidate.title)
        // API締切（未提出課題のUnix秒）を最優先。無ければ現行regex値
        const apiKey = normalizeAssignmentUrl(candidate.url)
        const apiEntry = apiKey ? apiDeadlines.get(apiKey) : undefined
        const deadline = apiEntry ? apiEntry.deadlineIso : (fieldDeadline ?? titleDeadline)
        const deadlineSource: 'api' | 'field' | 'title' | null = apiEntry
          ? 'api'
          : fieldDeadline
            ? 'field'
            : titleDeadline
              ? 'title'
              : null
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/background/fetchActionEvents.test.ts`
Expected: PASS（5件）。続けて `pnpm vitest run` 全件PASS、`pnpm tsc -b` エラーゼロ

- [ ] **Step 5: Commit**

```bash
git add src/background/index.ts src/background/fetchActionEvents.test.ts
git commit -m "feat(background): 締切スキャンにLETUS API締切上書きを結線（常時ON・失敗時regex）"
```

---

### Task 7: 全体検証・手動スモーク

**Files:**
- なし（検証のみ。問題があれば該当Taskに戻る）

**Interfaces:**
- Consumes: Task 1-6 の全成果物
- Produces: 検証済みブランチ

- [ ] **Step 1: 自動検証**

Run:
```bash
pnpm vitest run
pnpm tsc -b
pnpm lint
```
Expected: 全テストPASS / 型エラーゼロ / lintエラーゼロ

- [ ] **Step 2: 拡張の手動スモーク（開発者環境）**

1. `pnpm build:dev` → `chrome://extensions` で `dist/` を再読み込み
2. LETUSログイン済みブラウザでダッシュボードから締切スキャンを実行
3. 確認項目:
   - スキャンが完走し、未提出課題の `deadlineSource` が `'api'` になっている（DevTools → 拡張のservice worker → `chrome.storage.local.get('assignments')` で確認。sesskeyがconsole・storageに現れていないことも同時に確認）
   - API締切がダッシュボード表示の締切と一致（例: 23:59 JST）
   - 提出済み課題・締切なし課題は従来どおり `'field'`/`'title'`/`null`
   - ネットワークタブで service.php POST が1回（候補50件以下の場合）だけ増えている
4. フォールバック確認: LETUSからログアウト→スキャン→「ログインしてください」の既存挙動が出る（API起因の新規エラーが出ない）

- [ ] **Step 3: Commit（検証中の微修正があれば）**

```bash
git status  # 修正が無ければコミット不要
```

---

## 対象外（このプランではやらない）

- litusへの移植（純粋層 `letusApi.ts`＋fixtures を `litus/src/parsers/` へ、I/Oは注入JS化、`litus/src/parsers/letus.ts` への文言修正適用）— **別プラン**。本プラン完了・実機安定後に作成
- 案2（API事前フィルタでHTML訪問削減）・月間ビューP1'
- develop へのマージ・リリース（`superpowers:finishing-a-development-branch` で判断）
