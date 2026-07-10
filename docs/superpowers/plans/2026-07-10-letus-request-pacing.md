# LETUSリクエストのペーシング Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拡張のLETUSスキャン（約112リクエストを同時5本・リクエスト間ディレイゼロで発射）を、共有ペーサーで約5.5 req/s に均し、瞬間密度を人間の巡回に近づける。

**Architecture:** 「前回の発射から最低180ms空ける」ゲートを `src/core/pacer.ts` に純粋な形で実装し、`src/background/index.ts` のモジュールレベルに1つ置いて3箇所の `fetch` の直前で `await pacer.acquire()` する。`nextAt` を `await` の前に同期更新することで、同時に呼ばれてもロックなしに 0/180/360/... と整列する。`now` と `sleep` を注入して決定的にテストする。

**Tech Stack:** TypeScript / Chrome Extension MV3 (service worker) / Vite / vitest

## Global Constraints

- 設計spec: `docs/superpowers/specs/2026-07-10-letus-request-pacing-design.md`
- ブランチ: `feature/request-pacing`（`origin/develop` から分岐済み）
- 定数の値は spec から一字一句そのまま: `LETUS_MIN_REQUEST_GAP_MS = 180`
- 公開名は `createPacer` / `Pacer` / `PacerDeps` / `LETUS_MIN_REQUEST_GAP_MS`
- `mapWithConcurrency` は変更しない。同時実行3/5はソケット上限として残す
- `src/core/syllabusStore.ts`・`src/core/premium.ts`・`src/background/index.ts:316` の fetch には手を入れない（spec の「適用しないもの」）
- 純ロジックは `src/core/` に置き vitest で単体テストする。`background/index.ts` 自体はテストしない
- ユニットテストで実時間の `setTimeout` を待たない。`checkIsLoggedIn` のテストにはno-opペーサーを注入する
- `dist/` は生成物。直接編集しない
- テスト実行: `pnpm vitest run src/core/pacer.test.ts`（単体） / `pnpm vitest run src/background src/core`（関連） / 型チェック: `npx tsc -b` / ビルド: `pnpm build`
- コミットメッセージに絵文字を使わない

## File Structure

| ファイル | 責務 | 変更 |
|---|---|---|
| `src/core/pacer.ts` | 発射間隔の計算と待機。純ロジック | 新規 |
| `src/core/pacer.test.ts` | 上記のテスト | 新規 |
| `src/background/index.ts` | 共有ペーサーの生成と、3箇所の fetch 直前での `acquire()` | 変更 |
| `src/background/checkIsLoggedIn.test.ts` | no-opペーサーを注入して実時間sleepを避ける | 変更 |

---

### Task 1: ペーサー本体

**Files:**
- Create: `src/core/pacer.ts`
- Test: `src/core/pacer.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `LETUS_MIN_REQUEST_GAP_MS: number` = 180
  - `type Pacer = { acquire(): Promise<void> }`
  - `type PacerDeps = { now: () => number; sleep: (ms: number) => Promise<void> }`
  - `createPacer(minIntervalMs: number, deps?: PacerDeps): Pacer`

- [ ] **Step 1: 失敗するテストを書く**

`src/core/pacer.test.ts` を新規作成する。

```ts
import { describe, it, expect } from 'vitest'
import { createPacer, LETUS_MIN_REQUEST_GAP_MS } from './pacer'

/**
 * 偽の時計。sleep が呼ばれた分だけ時刻を進める（実時間は使わない）。
 *
 * 時刻の更新は `await Promise.resolve()` の後ろに置く。現実の sleep は呼んだ瞬間に
 * 時計を進めないため。同期的に `t += ms` すると、Promise.all の同期スイープの途中で
 * 時計が進み、後続の acquire() が進んだ時刻を読んでしまう。結果、同時実行の待ちが
 * 0/180/360/540/720 ではなく 0/180/180/180/180 になり、実挙動を検証できなくなる。
 */
function fakeDeps(start = 1000) {
  let t = start
  const sleeps: number[] = []
  return {
    sleeps,
    advance: (ms: number) => {
      t += ms
    },
    deps: {
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms)
        await Promise.resolve()
        t += ms
      },
    },
  }
}

describe('createPacer', () => {
  it('初回の acquire は待たない', async () => {
    const f = fakeDeps()
    const pacer = createPacer(180, f.deps)
    await pacer.acquire()
    expect(f.sleeps).toEqual([])
  })

  it('逐次に呼ぶと2回目以降は毎回 minIntervalMs だけ待つ', async () => {
    const f = fakeDeps()
    const pacer = createPacer(180, f.deps)
    for (let i = 0; i < 5; i++) await pacer.acquire()
    expect(f.sleeps).toEqual([180, 180, 180, 180])
  })

  it('同時に5本呼ぶと 0/180/360/540/720 に整列する', async () => {
    const f = fakeDeps()
    const pacer = createPacer(180, f.deps)
    await Promise.all([
      pacer.acquire(),
      pacer.acquire(),
      pacer.acquire(),
      pacer.acquire(),
      pacer.acquire(),
    ])
    // 待ち 0 のぶんは sleep を呼ばない
    expect(f.sleeps).toEqual([180, 360, 540, 720])
  })

  it('前回の発射から minIntervalMs 以上経っていれば待たない', async () => {
    const f = fakeDeps()
    const pacer = createPacer(180, f.deps)
    await pacer.acquire()
    f.advance(500)
    await pacer.acquire()
    expect(f.sleeps).toEqual([])
  })

  it('長く間隔が空いても nextAt は過去に留まらない（次は即時、その次は180待つ）', async () => {
    const f = fakeDeps()
    const pacer = createPacer(180, f.deps)
    await pacer.acquire()
    f.advance(10_000)
    await pacer.acquire()
    await pacer.acquire()
    expect(f.sleeps).toEqual([180])
  })

  it('LETUS_MIN_REQUEST_GAP_MS は 180', () => {
    expect(LETUS_MIN_REQUEST_GAP_MS).toBe(180)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm vitest run src/core/pacer.test.ts`

Expected: FAIL。`Failed to resolve import "./pacer"` というエラーになる（モジュールがまだ存在しない）。

- [ ] **Step 3: 最小の実装を書く**

`src/core/pacer.ts` を新規作成する。

```ts
/**
 * LETUS へのリクエストを一定間隔に均すためのゲート。
 *
 * 設計: docs/superpowers/specs/2026-07-10-letus-request-pacing-design.md
 *
 * 1サイクルのスキャンは「ログイン確認1 + コースページN + 課題ページM」で、
 * 10コース×10課題なら約112リクエストになる。同時実行3/5でリクエスト間の待ちが
 * 無いため、瞬間密度が人間の巡回から逸脱する。総量ではなく密度が問題であり、
 * レートリミッタやWAFが見るのも req/s である。
 *
 * 並列数を絞る方式やワーカー内 sleep 方式では、実効レートがサーバーの応答速度に
 * 依存してしまう（速いサーバーほど強く叩く）。制御したい量を直接制御するため、
 * 発射間隔そのものを共有ゲートで固定する。
 */

/** 発射の最小間隔。180ms = 約5.5 req/s。112リクエストで約20秒。 */
export const LETUS_MIN_REQUEST_GAP_MS = 180

export type Pacer = {
  /** 次の発射が許可されるまで待つ。 */
  acquire(): Promise<void>
}

export type PacerDeps = {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

const defaultDeps: PacerDeps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

export function createPacer(minIntervalMs: number, deps: PacerDeps = defaultDeps): Pacer {
  let nextAt = 0

  return {
    async acquire(): Promise<void> {
      const now = deps.now()
      const at = Math.max(now, nextAt)
      // await より前に同期的に確定させるのが要点。JavaScript は各コールバックを
      // 最後まで実行してから次へ移るため、同時に呼ばれても順番に枠が割り当てられ、
      // ロックもキューも要らずに 0/180/360/... と整列する。
      nextAt = at + minIntervalMs
      const wait = at - now
      if (wait > 0) await deps.sleep(wait)
    },
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `pnpm vitest run src/core/pacer.test.ts`

Expected: PASS。6 test すべて green。

- [ ] **Step 5: コミット**

```bash
git add src/core/pacer.ts src/core/pacer.test.ts
git commit -m "feat(core): LETUSリクエストの共有ペーサーを追加

負荷対策項目3の純ロジック層。now/sleep を注入して決定的にテストする。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: スキャンへの適用

**Files:**
- Modify: `src/background/index.ts`
- Modify: `src/background/checkIsLoggedIn.test.ts`

**Interfaces:**
- Consumes: Task 1 の `createPacer`, `LETUS_MIN_REQUEST_GAP_MS`, `type Pacer`
- Produces:
  - `checkIsLoggedIn(courses: Course[], pacer?: Pacer): Promise<'ok' | 'login_required' | 'network_error'>` — 第2引数が増える（既定はモジュールの共有ペーサー）

**背景（実装者向け）:** `src/background/index.ts` には LETUS への `fetch` が3箇所ある。`await fetch(course.url, { credentials: 'include' })`（コースページ、`mapWithConcurrency` 同時実行3）、`await fetch(candidate.url, { credentials: 'include' })`（課題ページ、同時実行5）、`checkIsLoggedIn` 内の `await fetch(course.url, { credentials: 'include', redirect: 'manual' })`。行番号ではなくこの内容で場所を特定すること。

同ファイルには `fetch(`${API_BASE_URL}/api/user/courses`, ...)` もあるが、これは `if (!API_BASE_URL) return` でガードされ `API_BASE_URL` は空文字なので到達しない。**触らないこと。**

- [ ] **Step 1: import と共有ペーサーを追加する**

`src/background/index.ts` の import 群の末尾（`import { academicYear } from '../core/syllabus'` の直後）に追加する。

```ts
import { createPacer, LETUS_MIN_REQUEST_GAP_MS, type Pacer } from '../core/pacer'
```

続いて、import 群の直後（最初の関数定義より前）に共有ペーサーを置く。

```ts
/**
 * LETUS への全リクエストが通るゲート。課題スキャンと締切スキャンで共有するため、
 * 連続して走るときも境目でバーストしない。同時実行数(3/5)はソケット上限として残り、
 * 実効レートはこのペーサーが決める。
 */
const letusPacer = createPacer(LETUS_MIN_REQUEST_GAP_MS)
```

- [ ] **Step 2: コースページの fetch をペーシングする**

`mapWithConcurrency(enabledCourses, 3, ...)` の中、次の箇所を探す。

```ts
        let response: Response
        try {
          response = await fetch(course.url, { credentials: 'include' })
        } catch {
          return null
        }
```

これを次に置き換える。

```ts
        let response: Response
        try {
          await letusPacer.acquire()
          response = await fetch(course.url, { credentials: 'include' })
        } catch {
          return null
        }
```

- [ ] **Step 3: 課題ページの fetch をペーシングする**

`mapWithConcurrency(candidates, 5, ...)` の中、次の箇所を探す。

```ts
        let response: Response
        try {
          response = await fetch(candidate.url, { credentials: 'include' })
        } catch {
          return null
        }
```

これを次に置き換える。

```ts
        let response: Response
        try {
          await letusPacer.acquire()
          response = await fetch(candidate.url, { credentials: 'include' })
        } catch {
          return null
        }
```

- [ ] **Step 4: `checkIsLoggedIn` にペーサーを注入可能にする**

現行の関数シグネチャと冒頭は次のとおり。

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
```

これを次に置き換える。

```ts
export async function checkIsLoggedIn(
  courses: Course[],
  pacer: Pacer = letusPacer,
): Promise<'ok' | 'login_required' | 'network_error'> {
  const course = courses.find((c) => c.enabled)
  if (!course) return 'ok'
  try {
    await pacer.acquire()
    const response = await fetch(course.url, {
      credentials: 'include',
      redirect: 'manual',
    })
```

第2引数を足すのは、この関数が export され独自のユニットテストを持つため。既定値を共有ペーサーにすることで、`index.ts` 内の3箇所の呼び出し（`checkIsLoggedIn(enabledCourses)`）は**変更不要**である。

- [ ] **Step 5: `checkIsLoggedIn` のテストに no-op ペーサーを注入する**

`src/background/checkIsLoggedIn.test.ts` は `checkIsLoggedIn` を6回呼ぶ。既定の共有ペーサーのままだと、2回目以降が実時間で180msずつ眠り、テストが約0.9秒遅くなる。

ファイル先頭の import 群の直後に、no-op ペーサーを定義する。

```ts
// 実時間の setTimeout を待たないよう、テストではペーシングを無効化する。
const noopPacer = { acquire: async () => {} }
```

そのうえで、ファイル内の `checkIsLoggedIn(` の**すべての呼び出し**に第2引数として `noopPacer` を渡す。たとえば次のように書き換える。

```ts
    const result = await checkIsLoggedIn(courses)
```

を

```ts
    const result = await checkIsLoggedIn(courses, noopPacer)
```

に。呼び出しは6箇所ある。`grep -n "checkIsLoggedIn(" src/background/checkIsLoggedIn.test.ts` で漏れがないことを確認すること。

- [ ] **Step 6: 型チェックとテストを走らせる**

Run: `npx tsc -b`
Expected: エラーなしで終了（exit 0）。

Run: `pnpm vitest run src/background src/core`
Expected: すべてPASS。`checkIsLoggedIn.test.ts` の所要時間が1秒未満であること（実時間sleepが混入していない証拠）。

- [ ] **Step 7: ビルドが通ることを確認する**

Run: `pnpm build`
Expected: `dist/background.js` が生成され、エラーなし。

- [ ] **Step 8: コミット**

```bash
git add src/background/index.ts src/background/checkIsLoggedIn.test.ts
git commit -m "feat(background): LETUSへの全リクエストを共有ペーサーで均す

約112リクエストを同時5本・ディレイゼロで発射していたため、瞬間密度が
人間の巡回から逸脱していた。180ms間隔(約5.5 req/s)に固定する。

checkIsLoggedIn は export され独自テストを持つため、第2引数でペーサーを
注入できるようにした。既定は共有ペーサーで、呼び出し側は変更不要。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 実機検証（実装完了後・必須）

ユニットテストは純ロジック層しか触らない。**MV3 service worker が20秒のスキャンを完走するか**は実測でしか分からない。ここが本変更でいちばん壊れやすい箇所である。

MV3のSWは無操作で30秒後に停止し、`setTimeout` 単体では生存時間が延びない。`mapWithConcurrency` の `onProgress` が1件ごとに `chrome.storage` へ書いており、拡張API呼び出しは無操作タイマーをリセットするため大丈夫だと見ているが、これは仕様の推論であって実測ではない。

1. `pnpm build` して `chrome://extensions` から `dist` を読み込む
2. 規約に同意する（同意ゲートがあるため、未同意ではスキャンが走らない）
3. ダッシュボードで**10コース以上**を有効にする（候補が100件規模になるように）
4. popup の「今すぐ更新」を押し、ストップウォッチを開始する
5. 拡張カードの「Service Worker」からDevToolsを開き、Networkタブを見る

確認すること。

- スキャンが**最後まで完走**し、途中で service worker が停止しない
- 所要時間が **20〜30秒**に収まる
- Networkタブのリクエストが**等間隔に並ぶ**（従来のような同時5本の塊にならない）
- popup の進捗表示が最後まで更新される

スキャンが途中で止まる場合、service worker が殺されている。その場合は `chrome.alarms` による分割実行が必要になり、本planより大きな変更になる。**その時点で実装を止めて報告すること。**
