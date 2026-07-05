# ベータ用サブスクトグル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ベータ配布ビルド（`dist-beta`）に、サーバーの実サブスク状態を上書きする恒久的なサブスク ON/OFF/解除トグルを載せ、テスターがプレミアムUIを試せるようにする。

**Architecture:** 3つ目のViteビルドフレーバー `beta`（`__BETA__` フラグ・`dist-beta` 出力・拡張名「[ベータ]」）を追加する。新規 `src/core/betaOverride.ts` が `betaSubscriptionOverride` ストレージキー（`'on'|'off'|null`）と純関数 `resolveSubscriber` を提供し、`App.tsx` の `isSubscriber` 確定箇所でサーバー由来の値より優先させる。既存の `__DEV_TOOLS__` 開発パネルを `__DEV_TOOLS__ || __BETA__` に広げてトグルUIを出す。

**Tech Stack:** Vite 8 + React 19 + TypeScript、Vitest、`chrome.storage.local`。

## Global Constraints

- `chrome.storage.local` を状態ストアに使う（既存 `src/core/auth.ts` 等と同じ）。
- 本番 `pnpm build`（`dist`）には `__BETA__`・`__DEV_TOOLS__` ともに false となり、トグルUIが一切含まれないこと。
- 新規コード追加時は変更前/後の意図と内容を説明する（CLAUDE.md ルール）。
- override 未設定（`null`）時は現行挙動を完全維持する。
- 拡張名（ベータ）は「LETUS Task Watcher [ベータ]」で固定。
- テストは Vitest。純ロジックは App から切り出してユニットテストする。

---

### Task 1: betaOverride コアモジュール（ストレージ + resolveSubscriber）

**Files:**
- Create: `src/core/betaOverride.ts`
- Test: `src/core/betaOverride.test.ts`

**Interfaces:**
- Consumes: `chrome.storage.local`（グローバル）
- Produces:
  - `type BetaSubscriptionOverride = 'on' | 'off' | null`
  - `getBetaSubscriptionOverride(): Promise<BetaSubscriptionOverride>`
  - `setBetaSubscriptionOverride(v: 'on' | 'off'): Promise<void>`
  - `clearBetaSubscriptionOverride(): Promise<void>`
  - `resolveSubscriber(serverActive: boolean, override: BetaSubscriptionOverride): boolean`

- [ ] **Step 1: Write the failing test**

`src/core/betaOverride.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, unknown> = {}
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {}
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const k of keyList) result[k] = store[k]
        return result
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj) }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const k of keyList) delete store[k]
      }),
    },
  },
})

import {
  getBetaSubscriptionOverride,
  setBetaSubscriptionOverride,
  clearBetaSubscriptionOverride,
  resolveSubscriber,
} from './betaOverride'

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
})

describe('betaSubscriptionOverride storage', () => {
  it('未設定なら null を返す', async () => {
    expect(await getBetaSubscriptionOverride()).toBeNull()
  })

  it("set('on') 後は 'on' を返す", async () => {
    await setBetaSubscriptionOverride('on')
    expect(await getBetaSubscriptionOverride()).toBe('on')
  })

  it("set('off') 後は 'off' を返す", async () => {
    await setBetaSubscriptionOverride('off')
    expect(await getBetaSubscriptionOverride()).toBe('off')
  })

  it('clear 後は null を返す', async () => {
    await setBetaSubscriptionOverride('on')
    await clearBetaSubscriptionOverride()
    expect(await getBetaSubscriptionOverride()).toBeNull()
  })
})

describe('resolveSubscriber', () => {
  it("override 'on' なら serverActive に関わらず true", () => {
    expect(resolveSubscriber(false, 'on')).toBe(true)
    expect(resolveSubscriber(true, 'on')).toBe(true)
  })

  it("override 'off' なら serverActive に関わらず false", () => {
    expect(resolveSubscriber(true, 'off')).toBe(false)
    expect(resolveSubscriber(false, 'off')).toBe(false)
  })

  it('override null なら serverActive をそのまま返す', () => {
    expect(resolveSubscriber(true, null)).toBe(true)
    expect(resolveSubscriber(false, null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/core/betaOverride.test.ts`
Expected: FAIL（`./betaOverride` が存在しない → import エラー）

- [ ] **Step 3: Write minimal implementation**

`src/core/betaOverride.ts`:

```ts
const BETA_SUBSCRIPTION_OVERRIDE_KEY = 'betaSubscriptionOverride'

export type BetaSubscriptionOverride = 'on' | 'off' | null

export async function getBetaSubscriptionOverride(): Promise<BetaSubscriptionOverride> {
  const result = await chrome.storage.local.get(BETA_SUBSCRIPTION_OVERRIDE_KEY) as {
    betaSubscriptionOverride?: 'on' | 'off'
  }
  return result.betaSubscriptionOverride ?? null
}

export async function setBetaSubscriptionOverride(v: 'on' | 'off'): Promise<void> {
  await chrome.storage.local.set({ [BETA_SUBSCRIPTION_OVERRIDE_KEY]: v })
}

export async function clearBetaSubscriptionOverride(): Promise<void> {
  await chrome.storage.local.remove(BETA_SUBSCRIPTION_OVERRIDE_KEY)
}

// override がある間はサーバー由来の serverActive より override を優先する。
// null（未設定）のときは現行挙動どおり serverActive をそのまま使う。
export function resolveSubscriber(
  serverActive: boolean,
  override: BetaSubscriptionOverride,
): boolean {
  if (override === 'on') return true
  if (override === 'off') return false
  return serverActive
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/core/betaOverride.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add src/core/betaOverride.ts src/core/betaOverride.test.ts
git commit -m "feat(beta): betaSubscriptionOverride storage + resolveSubscriber"
```

---

### Task 2: ベータビルドフレーバー（`__BETA__` / `dist-beta` / build:beta）

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `package.json:6-12`（scripts）

**Interfaces:**
- Consumes: なし
- Produces: グローバル定数 `__BETA__: boolean`、`pnpm build:beta` スクリプト、`dist-beta/` 出力（拡張名「LETUS Task Watcher [ベータ]」）

- [ ] **Step 1: `vite.config.ts` を3フレーバー対応にする**

現状 `const isDev = mode === 'development'` と `const outDir = isDev ? 'dist-dev' : 'dist'`、`define` は `__DEV_TOOLS__: isDev`、`dev-manifest` プラグインは `if (!isDev) return`。

変更後（`vite.config.ts` 全体）:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync } from 'fs'

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'
  const isBeta = mode === 'beta'
  const outDir = isDev ? 'dist-dev' : isBeta ? 'dist-beta' : 'dist'

  return {
  base: './',
  define: {
    __DEV_TOOLS__: isDev,
    __BETA__: isBeta,
  },
  plugins: [
    react(),
    {
      name: 'dev-manifest',
      closeBundle() {
        if (!isDev && !isBeta) return
        const path = resolve(__dirname, `${outDir}/manifest.json`)
        const manifest = JSON.parse(readFileSync(path, 'utf-8')) as { name: string }
        manifest.name = isDev
          ? 'LETUS Task Watcher [開発版]'
          : 'LETUS Task Watcher [ベータ]'
        writeFileSync(path, JSON.stringify(manifest, null, 2))
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/courseDetector.ts'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js'
          if (chunk.name === 'content') return 'content.js'
          return 'assets/[name]-[hash].js'
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
  },
  }
})
```

- [ ] **Step 2: `src/vite-env.d.ts` に `__BETA__` を宣言**

現状に `declare const __DEV_TOOLS__: boolean` がある。直後に追記:

```ts
declare const __BETA__: boolean
```

- [ ] **Step 3: `package.json` に `build:beta` スクリプトを追加**

`package.json` の `scripts` を次にする（`build:dev` の下に `build:beta` を追加）:

```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "build:dev": "tsc -b && vite build --mode development",
    "build:beta": "tsc -b && vite build --mode beta",
    "lint": "eslint .",
    "preview": "vite preview"
  },
```

- [ ] **Step 4: ベータビルドを実行して出力を確認**

Run: `pnpm build:beta`
Expected: エラーなく完了し、`dist-beta/` が生成される。

Run: `node -e "console.log(require('./dist-beta/manifest.json').name)"`
Expected: `LETUS Task Watcher [ベータ]`

- [ ] **Step 5: 本番ビルドにトグルフラグが混入しないことを確認**

Run: `pnpm build`
Expected: エラーなく完了。`dist/manifest.json` の name は元のまま（「[ベータ]」「[開発版]」を含まない）。

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts src/vite-env.d.ts package.json
git commit -m "feat(beta): add beta build flavor (__BETA__, dist-beta, build:beta)"
```

---

### Task 3: App.tsx で override をサーバー状態より優先させる

**Files:**
- Modify: `src/App.tsx`（import 追加、マウント effect の `isSubscriber` 確定、`handleAfterLogin` の `isSubscriber` 確定）

**Interfaces:**
- Consumes: Task 1 の `getBetaSubscriptionOverride`, `resolveSubscriber`
- Produces: なし（App 内部挙動）

**注意:** マウント effect は `src/App.tsx` の subscription 取得ブロック（`if (token) { ... /api/subscription/status ... } else { setIsSubscriber(false) }`）。`handleAfterLogin` も同様に `/api/subscription/status` を叩いて `setIsSubscriber` する。両方で「サーバー/キャッシュ由来の active を出す → override で最終決定」に変える。

- [ ] **Step 1: import を追加**

`src/App.tsx` の core import 群（`from './core/auth'` の近く）に追加:

```ts
import { getBetaSubscriptionOverride, resolveSubscriber } from './core/betaOverride'
```

- [ ] **Step 2: マウント effect の subscription ブロックを override 優先にする**

変更前（マウント effect 内、トークン分岐）:

```ts
      if (token) {
        // トークンがある場合はサーバーから最新のサブスク状態を取得
        try {
          const res = await fetch(`${API_BASE_URL}/api/subscription/status`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const data = await res.json() as { status: string; currentPeriodEnd: string | null }
            await saveSubscriptionCache(data.status, data.currentPeriodEnd)
            setIsSubscriber(data.status === 'active')
            setNextPaymentDate(data.currentPeriodEnd)
          } else {
            setIsSubscriber(cachedSubscriber)
            setNextPaymentDate(await getSubscriptionCurrentPeriodEnd())
          }
        } catch {
          setIsSubscriber(cachedSubscriber)
          setNextPaymentDate(await getSubscriptionCurrentPeriodEnd())
        }
      } else {
        setIsSubscriber(false)
      }
```

変更後（`serverActive` を計算し、最後に override を適用）:

```ts
      const override = await getBetaSubscriptionOverride()
      if (token) {
        // トークンがある場合はサーバーから最新のサブスク状態を取得
        try {
          const res = await fetch(`${API_BASE_URL}/api/subscription/status`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) {
            const data = await res.json() as { status: string; currentPeriodEnd: string | null }
            await saveSubscriptionCache(data.status, data.currentPeriodEnd)
            setIsSubscriber(resolveSubscriber(data.status === 'active', override))
            setNextPaymentDate(data.currentPeriodEnd)
          } else {
            setIsSubscriber(resolveSubscriber(cachedSubscriber, override))
            setNextPaymentDate(await getSubscriptionCurrentPeriodEnd())
          }
        } catch {
          setIsSubscriber(resolveSubscriber(cachedSubscriber, override))
          setNextPaymentDate(await getSubscriptionCurrentPeriodEnd())
        }
      } else {
        setIsSubscriber(resolveSubscriber(false, override))
      }
```

- [ ] **Step 3: `handleAfterLogin` を override 優先にする**

変更前:

```ts
      if (res.ok) {
        const data = await res.json() as { status: string; currentPeriodEnd: string | null }
        await saveSubscriptionCache(data.status, data.currentPeriodEnd)
        setIsSubscriber(data.status === 'active')
      } else {
        setIsSubscriber(false)
      }
    } catch {
      const active = await isSubscriptionActive()
      setIsSubscriber(active)
    }
```

変更後（先頭で `override` を取得し、各 `setIsSubscriber` に適用。`token` が無い早期リターンも override を反映）:

```ts
    const override = await getBetaSubscriptionOverride()
    try {
      const token = await getAuthToken()
      if (!token) { setIsSubscriber(resolveSubscriber(false, override)); return }
      const res = await fetch(`${API_BASE_URL}/api/subscription/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json() as { status: string; currentPeriodEnd: string | null }
        await saveSubscriptionCache(data.status, data.currentPeriodEnd)
        setIsSubscriber(resolveSubscriber(data.status === 'active', override))
      } else {
        setIsSubscriber(resolveSubscriber(false, override))
      }
    } catch {
      const active = await isSubscriptionActive()
      setIsSubscriber(resolveSubscriber(active, override))
    }
```

注: 変更前の `handleAfterLogin` 冒頭は
`const token = await getAuthToken()` を `try` 内で取得している。上記のとおり
`const override = ...` を `try` の直前に置き、`token` 取得はそのまま `try` 内に残す。

- [ ] **Step 4: 型チェックとテストが通ることを確認**

Run: `pnpm build`
Expected: `tsc -b` がエラーなく完了（型不整合なし）。

Run: `pnpm vitest run`
Expected: 既存テスト全て PASS（回帰なし）。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(beta): honor betaSubscriptionOverride over server subscription status"
```

---

### Task 4: トグルUI（既存 dev パネルを `__DEV_TOOLS__ || __BETA__` に拡張・3状態化）

**Files:**
- Modify: `src/App.tsx`（`__DEV_TOOLS__` 開発パネル・import）

**Interfaces:**
- Consumes: Task 1 の `getBetaSubscriptionOverride`, `setBetaSubscriptionOverride`, `clearBetaSubscriptionOverride`, `resolveSubscriber`（および既存 `saveSubscriptionCache`, `isSubscriptionActive`）
- Produces: なし

- [ ] **Step 1: import を拡張**

Task 3 で追加した betaOverride import に set/clear を足す:

```ts
import {
  getBetaSubscriptionOverride,
  setBetaSubscriptionOverride,
  clearBetaSubscriptionOverride,
  resolveSubscriber,
} from './core/betaOverride'
```

- [ ] **Step 2: 開発パネルを override ベースの3状態トグルに置き換え**

変更前（`src/App.tsx` の開発パネル）:

```tsx
          {__DEV_TOOLS__ && (
            <details className="settings devPanel">
              <summary>🛠 開発用: サブスク状態</summary>
              <div className="devPanelBody">
                <span>現在: <strong>{isSubscriber ? '✅ サブスクライバー' : '❌ 非サブスクライバー'}</strong></span>
                <div className="devPanelActions">
                  <button
                    type="button"
                    onClick={async () => {
                      await saveSubscriptionCache('active', null)
                      setIsSubscriber(true)
                    }}
                  >
                    サブスクON
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await chrome.storage.local.remove(['subscriptionStatus', 'subscriptionCheckedAt', 'subscriptionGraceUntil'])
                      setIsSubscriber(false)
                    }}
                  >
                    サブスクOFF
                  </button>
                </div>
              </div>
            </details>
          )}
```

変更後（ゲートを `__DEV_TOOLS__ || __BETA__` に広げ、override を書く3ボタン化。解除は実サブスク状態を再取得して反映）:

```tsx
          {(__DEV_TOOLS__ || __BETA__) && (
            <details className="settings devPanel">
              <summary>{__DEV_TOOLS__ ? '🛠 開発用: サブスク状態' : 'ベータ設定: サブスク状態'}</summary>
              <div className="devPanelBody">
                <span>現在: <strong>{isSubscriber ? '✅ サブスクライバー' : '❌ 非サブスクライバー'}</strong></span>
                <div className="devPanelActions">
                  <button
                    type="button"
                    onClick={async () => {
                      await setBetaSubscriptionOverride('on')
                      setIsSubscriber(true)
                    }}
                  >
                    サブスクON（強制）
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await setBetaSubscriptionOverride('off')
                      setIsSubscriber(false)
                    }}
                  >
                    サブスクOFF（強制）
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await clearBetaSubscriptionOverride()
                      const active = await isSubscriptionActive()
                      setIsSubscriber(resolveSubscriber(active, null))
                    }}
                  >
                    オーバーライド解除（実状態に戻す）
                  </button>
                </div>
              </div>
            </details>
          )}
```

- [ ] **Step 3: 型チェックとテストを確認**

Run: `pnpm build`
Expected: `tsc -b` エラーなし。

Run: `pnpm vitest run`
Expected: 既存テスト全て PASS。

- [ ] **Step 4: ベータビルドで手動確認**

Run: `pnpm build:beta`
Expected: 成功。`dist-beta/` を Chrome に unpacked ロードし、設定内「ベータ設定: サブスク状態」パネルで:
- 「サブスクON（強制）」→ プレミアムUIが出る。ポップアップを閉じて開き直しても維持される。
- 「サブスクOFF（強制）」→ 無料UI（`ProBanner`）に戻る。
- 「オーバーライド解除」→ 実サブスク状態に戻る。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(beta): expose subscription override toggle in beta build"
```

---

## Self-Review

**Spec coverage:**
- ベータビルドフレーバー新設 → Task 2 ✓
- 恒久オーバーライド（storage + resolveSubscriber + App適用）→ Task 1 + Task 3 ✓
- トグルUI（既存パネル流用・`__DEV_TOOLS__ || __BETA__`・3状態）→ Task 4 ✓
- デフォルト null=実状態 → Task 1 の resolveSubscriber(null) + Task 3 の各適用 ✓
- テスト（betaOverride.test.ts）→ Task 1 ✓
- 受け入れ基準（build:beta 名・ON維持・OFF・解除・本番非混入・既存green）→ Task 2/3/4 の確認ステップ ✓

**Placeholder scan:** プレースホルダなし。全ステップに実コード/実コマンド記載。

**Type consistency:** `resolveSubscriber(serverActive: boolean, override: BetaSubscriptionOverride)` を Task 1 で定義し Task 3/4 で同一シグネチャ使用。`getBetaSubscriptionOverride`/`setBetaSubscriptionOverride`/`clearBetaSubscriptionOverride` 名は全タスクで一致。`__BETA__` は Task 2 で宣言し Task 4 で使用。整合。
