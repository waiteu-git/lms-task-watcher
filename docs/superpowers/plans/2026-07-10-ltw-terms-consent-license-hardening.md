# LTW リスク抑制パッケージ（利用規約＋同意ゲート／LICENSE強化） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LETUS Task Watcher に利用規約と同意ゲートを新設し、同意するまで一切の収集を行わないようにしたうえで、LICENSE に免責・不正利用禁止・準拠法を追記して v1.2.1 として公開する。

**Architecture:** 同意状態は `chrome.storage.local` の `termsConsent = { version, acceptedAt }` 単一キーに持ち、`TERMS_VERSION` との一致だけを「同意済み」とみなす。収集の起点は background の alarm（`runAutoScan`）、background の `onMessage` 収集系3種、content script 2本の計3系統であり、そのすべてを未同意で塞ぐ。規約本文は `docs/legal/terms-ja.md` を単一正典とし、拡張内の `TERMS_BODY` と `landing/terms.html` を生成スクリプトで導出して同期ズレを構造的に防ぐ。

**Tech Stack:** TypeScript / React 19 / Vite / Vitest / Chrome Manifest V3

## Global Constraints

- 対象リリースは **v1.2.1**。`public/manifest.json` の `version` は **1.2.1 のまま。bump しない**。
- ブランチは `feature/risk-mitigation`。
- `TERMS_VERSION` の初版は **`1`**。
- 規約本文の正典は **`docs/legal/terms-ja.md`**。`src/legal/termsBody.ts` と `landing/terms.html` は**生成物であり手編集しない**。
- ソースの非公開化・private 隔離は**行わない**（LICENSE 冒頭の透明性の約束と矛盾するため）。
- 決済・アカウント条項は規約に**含めない**（`api/` は凍結中）。
- cabetus（`github.com/haya9924/cabetus`）への個別許諾は **現状のまま維持**する。
- 既存の収集済みデータ（`assignments` 等）は再同意時も**削除しない**。
- Chrome 通知は同意督促に**使わない**。督促は `chrome.action.setBadgeText` のバッジのみ。
- `public/welcome.html` は MV3 CSP のため inline script 禁止。スクリプトは `public/welcome.js` に置く。
- `public/changelog.html` にはリタス（Litus）関連の掲載を継続する（プロジェクトの changelog ルール）。
- テストは `pnpm vitest run src`、型検査は `pnpm build`（`tsc -b && vite build`）で通すこと。
- `dist/` は生成物。直接編集しない。

---

## File Structure

**新規作成:**
- `src/legal/termsVersion.ts` — `TERMS_VERSION` 定数のみ
- `src/legal/termsConsent.ts` — 純関数 `hasValidConsent` と storage I/O
- `src/legal/termsConsent.test.ts`
- `src/legal/termsBody.ts` — **生成物**（`TERMS_BODY`）
- `src/legal/termsBody.test.ts` — 生成物が正典と一致するかの検証
- `src/components/TermsConsentScreen.tsx` — 同意画面
- `src/components/TermsConsentScreen.test.tsx`
- `docs/legal/terms-ja.md` — 規約の正典
- `scripts/gen-terms.mjs` — 正典から派生物を生成
- `landing/terms.html` — **生成物**
- `store-submission-v1.2.1.md`

**変更:**
- `src/background/storageKeys.ts` — `TERMS_CONSENT_KEY` 追加
- `src/background/index.ts` — `runAutoScan` ガード、`onMessage` 収集系3種の拒否、バッジ制御
- `src/background/index.test.ts` — 上記のテスト
- `src/content/courseDetector.ts` — 未同意なら no-op
- `src/content/classTimetable.ts` — 未同意なら observer を張らない
- `src/App.tsx` — 同意ゲートと自動 refresh のガード
- `src/App.css` — 同意画面のスタイル
- `LICENSE` — 条項追記
- `README.md` — ライセンス節を追随
- `privacy-policy.md` / `docs/privacy-policy.md` — 規約への相互リンク
- `public/changelog.html` — 規約の節を最上部に
- `public/welcome.html` / `public/welcome.js` — 同意への案内
- `package.json` — `gen:terms` スクリプト追加

---

## Task 1: 規約の正典と生成スクリプト

規約本文を1箇所で管理し、拡張内文字列と Web ページを機械的に導出する。以降のタスクはすべて `TERMS_BODY` に依存するため最初に置く。

**Files:**
- Create: `docs/legal/terms-ja.md`
- Create: `scripts/gen-terms.mjs`
- Create: `src/legal/termsVersion.ts`
- Create: `src/legal/termsBody.ts`（生成物）
- Create: `landing/terms.html`（生成物）
- Create: `src/legal/termsBody.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: なし
- Produces:
  - `TERMS_VERSION: number`（`src/legal/termsVersion.ts`）
  - `TERMS_BODY: string`（`src/legal/termsBody.ts`）— Markdown 原文そのまま
  - `pnpm gen:terms` コマンド

- [ ] **Step 1: 規約の正典を書く**

`docs/legal/terms-ja.md` を作成:

```markdown
# LETUS Task Watcher 利用規約

- 版（TERMS_VERSION）: **1**
- 制定・最終改定日: 2026-07-10（JST）

本規約は、ブラウザ拡張機能「LETUS Task Watcher」（以下「本拡張」）の利用条件を定めるものです。本拡張を利用するには、本規約への同意が必要です。同意画面で「同意して始める」を押した時点で、本規約に同意したものとみなします。同意いただくまで、本拡張は課題の収集と通知を行いません。

## 1. 位置づけ（非公式の拡張機能）

本拡張は、東京理科大学（以下「大学」）の**公式の拡張機能ではありません**。個人が学習・利便のために提供する非公式のソフトウェアです。大学および大学の関連組織は、本拡張の提供・運営に関与していません。

## 2. 本人利用・認証情報

- 本拡張は、利用者**本人**がブラウザで既にログインしているセッションを用いて動作します。他人のアカウントでの利用や、なりすましは禁止します。
- 本拡張は認証情報（ID・パスワード）を**取得も保存もしません**。ログインは大学の公式ログイン画面で行われます。

## 3. 取得する情報の範囲・通信先

- LETUS（`letus.ed.tus.ac.jp`）から取得するのは、**コース・課題・締切・提出状態**に関する情報のみです。
- CLASS（`class.admin.tus.ac.jp`）から取得するのは、**履修科目・時間割・シラバス**に関する情報のみです。**成績等の機微な情報は取得しません**。
- 取得した情報はすべて利用者の端末内（ブラウザのローカルストレージ）に保存され、**外部への送信は行いません**。提供者はサーバーを運用していません。

## 4. 禁止事項

利用者は、次の行為を行ってはなりません。

1. LETUS・CLASS・大学のシステムに**過度な負荷**をかける行為。
2. スキャン間隔の改変その他の方法により、スクレイピングを乱用する行為。
3. 他人のアカウントでの利用、なりすまし。
4. 大学の規程・利用規約・法令に違反する利用。
5. 本拡張のコード・技術を用いて上記に相当する行為を行うこと。

## 5. 自己責任・免責

- 本拡張の利用に伴う一切の責任は**利用者が負います**。大学規程・法令の遵守は利用者の責任です。
- 本拡張は**現状有姿**で提供され、正確性・完全性・可用性その他いかなる保証もありません。課題や締切の表示漏れ・誤りが生じる可能性があります。**最終的な確認は必ず LETUS・CLASS の公式画面で行ってください**。
- 本拡張の利用または利用不能に起因して利用者または第三者に生じた損害について、提供者は一切の責任を負いません。

## 6. 規約の改定・準拠法

- 本規約は改定されることがあります。改定した場合は版番号（TERMS_VERSION）を更新し、**再度の同意**を求めます。
- 本規約は**日本法**に準拠します。
```

- [ ] **Step 2: 生成スクリプトを書く**

`scripts/gen-terms.mjs` を作成。既存の `scripts/gen-promo.mjs` と同じく Node の ESM で書く。

```js
// docs/legal/terms-ja.md を単一正典として、拡張内の TERMS_BODY と
// 公開ページ landing/terms.html を生成する。生成物は手編集しないこと。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'docs/legal/terms-ja.md')

const GENERATED_HEADER = '// 自動生成ファイル。編集しないこと。`pnpm gen:terms` で再生成する。\n'

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function renderTermsBodyTs(markdown) {
  return `${GENERATED_HEADER}\nexport const TERMS_BODY = ${JSON.stringify(markdown)}\n`
}

export function renderTermsHtml(markdown) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>利用規約 — LETUS Task Watcher</title>
<style>
body { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; line-height: 1.8;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; color: #1a1a1a; }
pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 15px; }
</style>
</head>
<body>
<!-- 自動生成ファイル。編集しないこと。pnpm gen:terms で再生成する。 -->
<pre>${escapeHtml(markdown)}</pre>
</body>
</html>
`
}

const markdown = readFileSync(SOURCE, 'utf8')
writeFileSync(join(root, 'src/legal/termsBody.ts'), renderTermsBodyTs(markdown))
writeFileSync(join(root, 'landing/terms.html'), renderTermsHtml(markdown))
console.log('generated: src/legal/termsBody.ts, landing/terms.html')
```

`landing/terms.html` を `<pre>` で素直に出すのは、正典 Markdown との文字列一致を検証可能に保つため。Markdown レンダラを挟むと一致検証が壊れる。

- [ ] **Step 3: `package.json` にスクリプトを追加**

`package.json` の `scripts` に1行足す（既存の行は変えない）:

```json
    "gen:terms": "node scripts/gen-terms.mjs",
```

- [ ] **Step 4: `TERMS_VERSION` を定義**

`src/legal/termsVersion.ts` を作成:

```ts
/** 規約の版。実体的な改定のたびに +1 し、利用者へ再同意を求める。 */
export const TERMS_VERSION = 1
```

- [ ] **Step 5: 生成を実行**

Run: `pnpm gen:terms`
Expected: `generated: src/legal/termsBody.ts, landing/terms.html` と出力され、両ファイルが作られる。

- [ ] **Step 6: 生成物が正典と一致することを検証するテストを書く**

`src/legal/termsBody.test.ts` を作成:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TERMS_BODY } from './termsBody'
import { TERMS_VERSION } from './termsVersion'

const SOURCE = 'docs/legal/terms-ja.md'

describe('TERMS_BODY', () => {
  it('正典 docs/legal/terms-ja.md と完全に一致する（手編集・再生成漏れの検出）', () => {
    expect(TERMS_BODY).toBe(readFileSync(SOURCE, 'utf8'))
  })

  it('正典に記載された版番号が TERMS_VERSION と一致する', () => {
    const m = TERMS_BODY.match(/版（TERMS_VERSION）: \*\*(\d+)\*\*/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(TERMS_VERSION)
  })
})
```

- [ ] **Step 7: テストを実行して通ることを確認**

Run: `pnpm vitest run src/legal`
Expected: 2 tests PASS

このテストは、正典を編集して `pnpm gen:terms` を忘れると即座に落ちる。それが狙い。

- [ ] **Step 8: 意図的に壊して検証が効くことを確認**

`docs/legal/terms-ja.md` の末尾に一時的に空行を足し、`pnpm vitest run src/legal` を実行。
Expected: 1つ目のテストが FAIL する。確認したら空行を戻し、再度 PASS することを確認する。

- [ ] **Step 9: コミット**

```bash
git add docs/legal/terms-ja.md scripts/gen-terms.mjs package.json src/legal landing/terms.html
git commit -m "feat(legal): 利用規約の正典と生成スクリプトを追加"
```

---

## Task 2: 同意状態のストア

同意状態の判定を純関数に閉じ込め、storage I/O と分離する。以降のすべてのガードがこれを使う。

**Files:**
- Create: `src/legal/termsConsent.ts`
- Create: `src/legal/termsConsent.test.ts`
- Modify: `src/background/storageKeys.ts`

**Interfaces:**
- Consumes: `TERMS_VERSION`（Task 1）
- Produces:
  - `type TermsConsent = { version: number; acceptedAt: string }`
  - `hasValidConsent(stored: unknown, version: number): boolean`
  - `getConsent(): Promise<TermsConsent | null>`
  - `saveConsent(version?: number): Promise<void>`
  - `isConsented(): Promise<boolean>` — `hasValidConsent(await getConsent(), TERMS_VERSION)` の糖衣。以降の全ガードはこれを呼ぶ
  - `TERMS_CONSENT_KEY = 'termsConsent'`（`src/background/storageKeys.ts`）

- [ ] **Step 1: 失敗するテストを書く**

`src/legal/termsConsent.test.ts` を作成:

```ts
import { describe, expect, it } from 'vitest'
import { hasValidConsent } from './termsConsent'

describe('hasValidConsent', () => {
  it('未設定(null/undefined)は未同意', () => {
    expect(hasValidConsent(null, 1)).toBe(false)
    expect(hasValidConsent(undefined, 1)).toBe(false)
  })

  it('版が一致すれば同意済み', () => {
    expect(hasValidConsent({ version: 1, acceptedAt: '2026-07-10T00:00:00.000Z' }, 1)).toBe(true)
  })

  it('版が古ければ未同意（規約改定で再同意を求める）', () => {
    expect(hasValidConsent({ version: 1, acceptedAt: '2026-07-10T00:00:00.000Z' }, 2)).toBe(false)
  })

  it('版が新しすぎる場合も未同意（ダウングレード時の安全側）', () => {
    expect(hasValidConsent({ version: 3, acceptedAt: '2026-07-10T00:00:00.000Z' }, 2)).toBe(false)
  })

  it('壊れた値は未同意', () => {
    expect(hasValidConsent({}, 1)).toBe(false)
    expect(hasValidConsent({ version: '1' }, 1)).toBe(false)
    expect(hasValidConsent('yes', 1)).toBe(false)
    expect(hasValidConsent(42, 1)).toBe(false)
    expect(hasValidConsent({ version: 1 }, 1)).toBe(false)
    expect(hasValidConsent({ version: 1, acceptedAt: '' }, 1)).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/legal/termsConsent.test.ts`
Expected: FAIL — `Failed to resolve import "./termsConsent"`

- [ ] **Step 3: storage キーを追加**

`src/background/storageKeys.ts` の末尾に追記:

```ts
export const TERMS_CONSENT_KEY = 'termsConsent'
```

- [ ] **Step 4: 最小実装を書く**

`src/legal/termsConsent.ts` を作成:

```ts
import { TERMS_CONSENT_KEY } from '../background/storageKeys'
import { TERMS_VERSION } from './termsVersion'

export type TermsConsent = { version: number; acceptedAt: string }

/**
 * 保存された同意記録が、指定した版に対して有効かを判定する純関数。
 * 版が一致するときのみ同意済みとみなす。未設定・版不一致・壊れた値はすべて未同意。
 */
export function hasValidConsent(stored: unknown, version: number): boolean {
  if (typeof stored !== 'object' || stored === null) return false
  const c = stored as Partial<TermsConsent>
  if (typeof c.version !== 'number') return false
  if (typeof c.acceptedAt !== 'string' || c.acceptedAt === '') return false
  return c.version === version
}

export async function getConsent(): Promise<TermsConsent | null> {
  const result = await chrome.storage.local.get(TERMS_CONSENT_KEY) as {
    termsConsent?: unknown
  }
  const stored = result.termsConsent
  return hasValidConsent(stored, TERMS_VERSION) ? (stored as TermsConsent) : null
}

export async function saveConsent(version: number = TERMS_VERSION): Promise<void> {
  const consent: TermsConsent = { version, acceptedAt: new Date().toISOString() }
  await chrome.storage.local.set({ [TERMS_CONSENT_KEY]: consent })
}

/** 収集を行ってよいか。すべてのガードはこれを呼ぶ。 */
export async function isConsented(): Promise<boolean> {
  const result = await chrome.storage.local.get(TERMS_CONSENT_KEY) as {
    termsConsent?: unknown
  }
  return hasValidConsent(result.termsConsent, TERMS_VERSION)
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm vitest run src/legal`
Expected: 全 PASS（Task 1 の 2 件 + 本タスクの 5 件）

- [ ] **Step 6: コミット**

```bash
git add src/legal/termsConsent.ts src/legal/termsConsent.test.ts src/background/storageKeys.ts
git commit -m "feat(legal): 同意状態のストアと hasValidConsent 純関数を追加"
```

---

## Task 3: background の収集ガードとバッジ

未同意のとき、alarm 駆動のスキャンと収集系メッセージをすべて止める。**このタスクが同意ゲートの実効性を担う中核**であり、画面側のゲート（Task 5）は補助にすぎない。

**Files:**
- Modify: `src/background/index.ts`
- Modify: `src/background/index.test.ts`

**Interfaces:**
- Consumes: `isConsented()`（Task 2）
- Produces:
  - `updateConsentBadge(): Promise<void>` — export する（テストから呼ぶため）
  - `runAutoScan()` の未同意時 early return
  - `onMessage` での `UPSERT_COURSES` / `START_ASSIGNMENT_SCAN` / `START_DEADLINE_SCAN` 拒否（`{ ok: false, reason: 'consent_required' }` を返す）

- [ ] **Step 1: 失敗するテストを書く**

`src/background/index.test.ts` の末尾に追記。既存のテストが `chrome` をどうスタブしているかを先に読み、その流儀に合わせること（既存に `storage.onChanged` のスタブを足した前例が `2f2128d` にある）。

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { TERMS_CONSENT_KEY } from './storageKeys'

describe('未同意時の収集ガード', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('未同意なら runAutoScan は何も収集せずに return する', async () => {
    // storage は termsConsent 未設定を返す
    const getSpy = vi.fn().mockResolvedValue({})
    vi.stubGlobal('chrome', {
      ...globalThis.chrome,
      storage: { ...globalThis.chrome.storage, local: { ...globalThis.chrome.storage.local, get: getSpy } },
    })
    const mod = await import('./index')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await mod.runAutoScan()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('同意済みなら runAutoScan はコース取得まで進む', async () => {
    const getSpy = vi.fn().mockResolvedValue({
      [TERMS_CONSENT_KEY]: { version: 1, acceptedAt: '2026-07-10T00:00:00.000Z' },
      courses: [],
    })
    vi.stubGlobal('chrome', {
      ...globalThis.chrome,
      storage: { ...globalThis.chrome.storage, local: { ...globalThis.chrome.storage.local, get: getSpy } },
    })
    const mod = await import('./index')

    await mod.runAutoScan()

    // enabledCourses が空なので早期 return するが、同意判定を越えて courses を読んだことを確認
    expect(getSpy).toHaveBeenCalled()
  })

  it('updateConsentBadge は未同意なら "!" を、同意済みなら "" を設定する', async () => {
    const setBadgeText = vi.fn().mockResolvedValue(undefined)
    const setBadgeBackgroundColor = vi.fn().mockResolvedValue(undefined)
    const getSpy = vi.fn().mockResolvedValue({})
    vi.stubGlobal('chrome', {
      ...globalThis.chrome,
      action: { setBadgeText, setBadgeBackgroundColor },
      storage: { ...globalThis.chrome.storage, local: { ...globalThis.chrome.storage.local, get: getSpy } },
    })
    const mod = await import('./index')

    await mod.updateConsentBadge()
    expect(setBadgeText).toHaveBeenCalledWith({ text: '!' })

    getSpy.mockResolvedValue({
      [TERMS_CONSENT_KEY]: { version: 1, acceptedAt: '2026-07-10T00:00:00.000Z' },
    })
    await mod.updateConsentBadge()
    expect(setBadgeText).toHaveBeenLastCalledWith({ text: '' })
  })
})
```

`runAutoScan` は現在 export されていない。テストのため `export async function runAutoScan()` に変える。

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm vitest run src/background/index.test.ts`
Expected: FAIL — `mod.runAutoScan is not a function` および `mod.updateConsentBadge is not a function`

- [ ] **Step 3: import を追加し `runAutoScan` をガード**

`src/background/index.ts` の import 群に追加:

```ts
import { isConsented } from '../legal/termsConsent'
import { TERMS_CONSENT_KEY } from './storageKeys'
```

`runAutoScan` を export に変え、冒頭にガードを入れる:

```ts
export async function runAutoScan(): Promise<void> {
  // 規約に同意していない利用者のデータは一切扱わない。
  if (!(await isConsented())) return

  const courses = await getCourses()
  const enabledCourses = courses.filter((c) => c.enabled)

  if (enabledCourses.length === 0) return
  // ...以降は既存のまま
```

- [ ] **Step 4: バッジ制御を実装**

`src/background/index.ts` に追加（`handleInstalled` の直前あたり）:

```ts
/** 未同意のあいだ拡張アイコンに "!" を出し、同意で消す。通知は使わない。 */
export async function updateConsentBadge(): Promise<void> {
  const consented = await isConsented()
  await chrome.action.setBadgeText({ text: consented ? '' : '!' })
  if (!consented) {
    await chrome.action.setBadgeBackgroundColor({ color: '#d93025' })
  }
}
```

`handleInstalled` の冒頭（`chrome.alarms.create` の直後）に1行足す:

```ts
  await updateConsentBadge()
```

ファイル末尾の `chrome.runtime.onStartup` 登録の近くに、同意状態の変化を監視してバッジを更新するリスナを足す:

```ts
chrome.storage.local.onChanged.addListener((changes) => {
  if (TERMS_CONSENT_KEY in changes) {
    void updateConsentBadge()
  }
})
```

- [ ] **Step 5: `onMessage` の収集系3種を拒否**

`chrome.runtime.onMessage.addListener` の中、`OPEN_DASHBOARD` の分岐の**直後**に置く。`OPEN_DASHBOARD` は収集を伴わないので通す。

```ts
  // 収集を伴うメッセージは、規約同意まで一切受け付けない。
  // popup の自動 refresh は React の useEffect であり画面ゲートでは止まらないため、
  // ここが実効的な防波堤になる。
  const COLLECTING_MESSAGES = ['UPSERT_COURSES', 'START_ASSIGNMENT_SCAN', 'START_DEADLINE_SCAN']
  if (COLLECTING_MESSAGES.includes(message?.type)) {
    void isConsented().then((consented) => {
      if (!consented) {
        sendResponse({ ok: false, reason: 'consent_required' })
      } else {
        handleCollectingMessage(message, sendResponse)
      }
    })
    return true
  }
```

既存の `UPSERT_COURSES` / `START_ASSIGNMENT_SCAN` / `START_DEADLINE_SCAN` の3つの分岐ブロックを、そのまま `handleCollectingMessage` という関数に切り出す。中身のロジックは一切変えない。`sendResponse` を引数で受け取る形にし、`START_ASSIGNMENT_SCAN` の非同期 `sendResponse` は元のまま維持する（呼び出し側で `return true` 済みのため動作する）。

```ts
function handleCollectingMessage(
  message: { type: string; [k: string]: unknown },
  sendResponse: (response: unknown) => void,
): void {
  if (message.type === 'UPSERT_COURSES') {
    const courses = (message.courses ?? []) as Course[]
    sendResponse({ ok: true, count: courses.length })
    upsertCourses(courses)
      .then(() => applyAutoSelect())
      .then(() => syncCoursesToServerIfSubscriber(courses))
      .catch((error) => {
        console.error('[LETUS Task Watcher] upsertCourses failed', error)
      })
    return
  }

  if (message.type === 'START_ASSIGNMENT_SCAN') {
    if (isAssignmentScanning) {
      sendResponse({ ok: false, reason: 'already_running' })
      return
    }
    const scanLevel = (message.scanLevel ?? 'standard') as ScanLevel
    void (async () => {
      const courses = await getCourses()
      const enabledCourses = courses.filter((c) => c.enabled)
      const loginStatus = await checkIsLoggedIn(enabledCourses)
      if (loginStatus !== 'ok') {
        sendResponse({
          ok: false,
          reason: loginStatus === 'login_required' ? 'not_logged_in' : 'network_error',
        })
        return
      }
      sendResponse({ ok: true, reason: 'started' })
      scanAssignmentCandidatesInBackground(scanLevel).catch((error) => {
        console.error('[LETUS Task Watcher] assignment scan failed', error)
      })
    })()
    return
  }

  if (message.type === 'START_DEADLINE_SCAN') {
    if (isDeadlineScanning) {
      sendResponse({ ok: false, reason: 'already_running' })
      return
    }
    sendResponse({ ok: true, reason: 'started' })
    scanDeadlinesInBackground().catch((error) => {
      console.error('[LETUS Task Watcher] deadline scan failed', error)
    })
    return
  }
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `pnpm vitest run src/background`
Expected: 全 PASS（既存テストを壊していないこと。特に `index.test.ts` の既存ケース）

- [ ] **Step 7: 型検査**

Run: `pnpm build`
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add src/background/index.ts src/background/index.test.ts
git commit -m "feat(background): 未同意なら収集を実行せず、拡張アイコンに督促バッジを出す"
```

---

## Task 4: content script のガード

LETUS / CLASS のページ上で動く2本を、未同意なら完全に沈黙させる。DOM 注入（`initManualTaskWidget`）も止める。

**Files:**
- Modify: `src/content/courseDetector.ts`
- Modify: `src/content/classTimetable.ts`

**Interfaces:**
- Consumes: `isConsented()`（Task 2）
- Produces: なし

content script は Vitest の対象外（DOM とブラウザ拡張 API に密結合）。ここは手動確認で検証する。純ロジックを足さないこと。

- [ ] **Step 1: `courseDetector.ts` をガード**

`src/content/courseDetector.ts` の import に追加:

```ts
import { isConsented } from '../legal/termsConsent'
```

末尾の `run()` 呼び出しを差し替える。`run()` 自体は変更しない:

```ts
// 規約未同意のあいだは、コース検出も DOM 注入も行わない。
void isConsented().then((consented) => {
  if (!consented) {
    console.log('[LETUS Task Watcher] terms not accepted; content script is inactive')
    return
  }
  run()
})
```

- [ ] **Step 2: `classTimetable.ts` をガード**

`src/content/classTimetable.ts` の先頭に import を追加:

```ts
import { isConsented } from '../legal/termsConsent'
```

末尾3行を差し替える。**未同意なら `MutationObserver` を登録しない**ことが重要。登録してしまうと CLASS ページ上で監視が走り続ける。

変更前:

```ts
const observer = new MutationObserver(() => capture())
observer.observe(document.documentElement, { childList: true, subtree: true })
capture()
```

変更後:

```ts
// 規約未同意のあいだは observer を張らず、capture も行わない。
void isConsented().then((consented) => {
  if (!consented) {
    console.log('[LETUS Task Watcher] terms not accepted; CLASS timetable capture is inactive')
    return
  }
  const observer = new MutationObserver(() => capture())
  observer.observe(document.documentElement, { childList: true, subtree: true })
  capture()
})
```

ファイル冒頭のコメントは「`timetableStore` を import しない（Rollup 共有チャンク化で import 文が出力され classic content script が壊れる）」と警告している。`src/legal/termsConsent.ts` は `chrome.storage` と `storageKeys` にしか依存しない小さなモジュールなので同じ問題を起こしにくいが、**Step 3 で必ずビルド出力を確認すること**。

- [ ] **Step 3: ビルドして content script に import 文が出ていないことを確認**

Run: `pnpm build`

その後、生成物に ESM の `import` 文が出ていないことを確認する。content script は classic script として読み込まれるため、`import` 文が1つでも出力されると実行時に構文エラーで死ぬ。

Run: `rg -n "^\s*import[\s{'\"]" dist/classTimetable.js dist/content.js`
Expected: **1件もヒットしない**（`rg` は該当なしで exit code 1 を返す。これが正常）

`rg` が無ければ `grep -nE "^[[:space:]]*import[[:space:]{'\"]" dist/classTimetable.js dist/content.js` でも同じ。

**`NG` が出た場合:** `vite.config.ts` の rollup 設定で content script のチャンク分割を抑止するか、`isConsented` の中身（`chrome.storage.local.get` と `hasValidConsent` の呼び出し）を各 content script 内にインライン展開する。共有モジュールを import しないことが最優先。

- [ ] **Step 4: 手動確認**

1. `pnpm build` 後、`chrome://extensions` で `dist` を読み込み直す
2. `chrome.storage.local` をクリア（DevTools の Application タブ、または拡張を削除して再読み込み）
3. LETUS のコースページを開く → コンソールに `terms not accepted; content script is inactive` が出て、手動タスクウィジェットが**注入されない**こと
4. CLASS の学生時間割表を開く → `CLASS timetable capture is inactive` が出て、「時間割を取り込みました」トーストが**出ない**こと

- [ ] **Step 5: コミット**

```bash
git add src/content/courseDetector.ts src/content/classTimetable.ts
git commit -m "feat(content): 未同意ならコース検出・時間割取り込み・DOM注入を行わない"
```

---

## Task 5: 同意画面

popup とダッシュボードの双方を、同意するまで全面で塞ぐ。

**Files:**
- Create: `src/components/TermsConsentScreen.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `TERMS_BODY`（Task 1）、`isConsented()` / `saveConsent()`（Task 2）
- Produces: `<TermsConsentScreen onAccept={() => void} />`

**このタスクにコンポーネントテストは書かない。** `@testing-library/react` は未導入で（`devDependencies` にあるのは `jsdom` のみ）、この画面のためだけに依存を増やす価値はない。表示とゲート挙動は Step 6 の手動確認で検証する。同意判定のロジック自体は Task 2 の `hasValidConsent` で既にテスト済みであり、この画面はその表示層にすぎない。

- [ ] **Step 1: 同意画面を実装**

`src/components/TermsConsentScreen.tsx` を作成:

```tsx
import { TERMS_BODY } from '../legal/termsBody'

type Props = {
  onAccept: () => void
}

/**
 * 規約の同意画面。スキップ・閉じる導線を持たない。
 * 同意するまで収集は行われない（実効的な停止は background 側のガードが担う）。
 */
export function TermsConsentScreen({ onAccept }: Props) {
  return (
    <div className="termsConsent">
      <h1 className="termsConsentTitle">ご利用の前に</h1>
      <p className="termsConsentLead">
        LETUS Task Watcher をご利用いただくには、利用規約への同意が必要です。
        同意いただくまで、課題の収集と通知は行いません。
      </p>
      <pre className="termsConsentBody">{TERMS_BODY}</pre>
      <button type="button" className="termsConsentAccept" onClick={onAccept}>
        同意して始める
      </button>
    </div>
  )
}
```

本文はスクロール領域に全文を出す。スクロール完了の検出は入れない（`overflow` の実測に依存して壊れやすく、規約が短いと押せなくなる。YAGNI）。

- [ ] **Step 2: `App.tsx` にゲートを配線**

`src/App.tsx` の import に追加:

```ts
import { isConsented, saveConsent } from './legal/termsConsent'
import { TermsConsentScreen } from './components/TermsConsentScreen'
```

`export default function App() {` の直後、他の `useState` 群に並べて追加:

```ts
  const [consentState, setConsentState] = useState<'loading' | 'needed' | 'ok'>('loading')
```

同意判定の `useEffect` を、`getOnboardingCompleted` の `useEffect`（現在 306 行付近）の**直前**に追加:

```ts
  useEffect(() => {
    void isConsented().then((consented) => {
      setConsentState(consented ? 'ok' : 'needed')
    })
  }, [])
```

自動 refresh の `useEffect`（`hasAutoRefreshCheckedRef` を使うもの、現在 466 行付近）の冒頭にガードを足す。**hooks は早期 return より前に走るため、ここを塞がないと未同意でも `START_*` が送られる**（background 側で拒否されるので実害はないが、無駄な往復を避ける）:

```ts
  useEffect(() => {
    if (consentState !== 'ok') {
      return
    }
    if (hasAutoRefreshCheckedRef.current) {
      return
    }
    // ...以降は既存のまま
```

依存配列を `[]` から `[consentState]` に変える。同様に、締切通知チェックの `useEffect`（`hasCheckedDeadlineNotificationRef` を使うもの）にも同じガードと依存配列の変更を入れる。

そして `return (` の**直前**にゲートを置く。`isDashboard` 分岐より前なので popup / ダッシュボード双方を塞ぐ:

```ts
  if (consentState === 'loading') {
    return <main className="app popup" />
  }

  if (consentState === 'needed') {
    return (
      <main className={`app ${isDashboard ? 'dashboard' : 'popup'}`}>
        <TermsConsentScreen
          onAccept={() => {
            void saveConsent().then(() => setConsentState('ok'))
          }}
        />
      </main>
    )
  }

  return (
    // ...既存の JSX
```

- [ ] **Step 3: スタイルを追加**

`src/App.css` の末尾に追記:

```css
.termsConsent {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  height: 100%;
  box-sizing: border-box;
}

.termsConsentTitle {
  margin: 0;
  font-size: 18px;
}

.termsConsentLead {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
}

.termsConsentBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 0;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background: #fafafa;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.termsConsentAccept {
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: #1d9e75;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.termsConsentAccept:hover {
  background: #178360;
}
```

- [ ] **Step 4: テストと型検査**

Run: `pnpm vitest run src`
Expected: 全 PASS（既存テストを壊していないこと）

Run: `pnpm build`
Expected: エラーなし

- [ ] **Step 5: 手動確認**

1. `chrome.storage.local` をクリアして拡張を読み込み直す
2. 拡張アイコンに `!` バッジが出ること
3. popup を開くと同意画面が出て、閉じる導線が無いこと
4. 規約本文が全文スクロールできること
5. 「同意して始める」→ 通常画面に遷移し、バッジが消えること
6. `index.html#dashboard` を直接開いても、未同意なら同意画面が出ること

- [ ] **Step 6: コミット**

```bash
git add src/components/TermsConsentScreen.tsx src/App.tsx src/App.css
git commit -m "feat(ui): 規約同意画面を追加し popup とダッシュボードをゲートする"
```

---

## Task 6: LICENSE 強化

**Files:**
- Modify: `LICENSE`
- Modify: `README.md`

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: 日本語パートに追記**

`LICENSE` の「■ 禁止される行為」の直後、「本ソフトウェアは現状有姿で提供され〜」の**前**に以下を挿入:

```
■ 不正利用の禁止
本ソフトウェアのコード、技術または知見を用いて、次の行為を行うことを
禁止する。
1. 大学のシステム（LETUS・CLASS を含む）に過度な負荷をかけること
2. スクレイピングを乱用すること、および収集間隔の改変等によりこれを
   容易にすること
3. 自動化ツールその他、大学の規程・利用規約・法令に違反する用途へ
   転用すること
```

「本ソフトウェアは現状有姿で〜」の段落を、以下に置き換える:

```
■ 自己責任・免責
本ソフトウェアは現状有姿で提供され、著作権者は、明示黙示を問わず、
商品性、特定目的への適合性および非侵害を含むいかなる保証も行わない。
著作権者は、本ソフトウェアの使用または使用不能に起因して生じた
直接損害、間接損害、特別損害、結果的損害、逸失利益その他一切の
損害について、その可能性を知らされていた場合であっても、責任を
負わない。本ソフトウェアの利用に伴う一切の責任は利用者が負う。

■ 違反時の自動終了
利用者が本ライセンスのいずれかの条項に違反した場合、本ライセンスに
基づき付与された許可は、通知を要することなく自動的に終了する。

■ 準拠法・管轄
本ライセンスは日本法に準拠する。本ライセンスに関する紛争については、
東京地方裁判所を第一審の専属的合意管轄裁判所とする。
```

「■ 個別許諾」の節は**そのまま維持**する（cabetus への許諾を狭めない）。

- [ ] **Step 2: 英語パートに追記**

`PROHIBITED:` のリストの直後に挿入:

```
PROHIBITED USES:
Using the code, techniques, or knowledge derived from this software to:
1. Impose excessive load on university systems (including LETUS and CLASS);
2. Abuse scraping, or facilitate such abuse by modifying collection intervals;
3. Repurpose it for automation tools or any use that violates university
   regulations, terms of service, or applicable law.
```

`THE SOFTWARE IS PROVIDED "AS IS"...` の段落を置き換える:

```
DISCLAIMER:
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
CONSEQUENTIAL DAMAGES OR LOSS OF PROFITS ARISING FROM THE USE OR INABILITY
TO USE THE SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
THE USER BEARS ALL RESPONSIBILITY FOR THEIR USE OF THE SOFTWARE.

TERMINATION:
Any breach of the terms of this license automatically terminates the
permissions granted hereunder, without notice.

GOVERNING LAW:
This license is governed by the laws of Japan. The Tokyo District Court shall
have exclusive jurisdiction as the court of first instance for any dispute
arising out of or in connection with this license.
```

`INDIVIDUAL GRANT:` の節は**そのまま維持**する。

末尾の「In case of any discrepancy...」の一文は維持する。

- [ ] **Step 3: `README.md` のライセンス節を追随**

`## ライセンス` 節に、規約への導線と要約を追記する。既存の記述は残す:

```markdown
本ソフトウェアはオープンソースではありません。ソースコードは、収集するデータの内容や送信先をユーザー自身が検証できるようにする透明性の確保を目的として公開しています。

閲覧・検証・自身の環境でのビルドと実行は許可されますが、複製・再配布・商用利用、および大学システムへの過度な負荷やスクレイピング乱用への転用は禁止です。詳細は [LICENSE](LICENSE) を参照してください。

本拡張の利用条件は [利用規約](docs/legal/terms-ja.md)（公開版: https://lms.waiteu.dev/terms ）に定めます。
```

- [ ] **Step 4: コミット**

```bash
git add LICENSE README.md
git commit -m "docs(license): 不正利用の禁止・免責強化・違反時の自動終了・準拠法を追記"
```

---

## Task 7: 案内文とプライバシーポリシーの相互リンク

**Files:**
- Modify: `public/changelog.html`
- Modify: `public/welcome.html`
- Modify: `privacy-policy.md`
- Modify: `docs/privacy-policy.md`

**Interfaces:**
- Consumes: なし
- Produces: なし

`public/welcome.js` の変更は不要（案内文は静的テキストのみ）。inline script を足さないこと。

- [ ] **Step 1: `changelog.html` に規約の節を最上部で追加**

`<h1>v1.2.1 にアップデートしました</h1>` と `<p class="subtitle">` の後、既存の `<h2>🔧 今回の修正</h2>` の**前**に挿入:

```html
    <h2>⚖ 利用規約を新設しました</h2>
    <ul>
      <li><strong>ご同意いただくまで、課題の収集と通知を停止します。</strong>拡張機能のアイコンをクリックし、内容をご確認のうえ「同意して始める」を押してください。同意後、これまでどおり動作します。</li>
      <li>本拡張は東京理科大学の公式拡張ではありません。取得するのはLETUSの課題情報とCLASSの時間割・シラバスのみで、成績等は取得せず、すべて端末内に保存され外部へ送信されません。</li>
      <li>全文は<a href="https://lms.waiteu.dev/terms" target="_blank">こちら</a>でご覧いただけます。</li>
    </ul>
```

既存の「🔧 今回の修正」「📱 モバイルアプリ「リタス」開発中」「🗺 ロードマップ」の各節は**順序も内容もそのまま**下に残す。

- [ ] **Step 2: `welcome.html` に同意への案内を追加**

`public/welcome.html` を開き、最初の手順・説明が並ぶ箇所の冒頭に一節を追加する。既存のマークアップ構造（クラス名）に合わせること。文面:

```html
    <h2>はじめに：利用規約への同意</h2>
    <p>
      ブラウザのツールバーにある拡張機能のアイコンをクリックし、利用規約に同意してください。
      <strong>同意いただくまで、課題の収集と通知は行いません。</strong>
      全文は<a href="https://lms.waiteu.dev/terms" target="_blank">利用規約</a>でご覧いただけます。
    </p>
```

- [ ] **Step 3: プライバシーポリシーから規約へリンク**

`privacy-policy.md` と `docs/privacy-policy.md` の両方の冒頭 `## Overview` 節の末尾に追記:

```markdown
Use of this extension is subject to the [Terms of Use](https://lms.waiteu.dev/terms). The extension does not collect any data until you accept the terms.
```

2つのファイルが同一内容かを先に `diff privacy-policy.md docs/privacy-policy.md` で確認する。差分があるなら、それぞれの Overview 節に合わせて追記する。

- [ ] **Step 4: 手動確認**

Run: `pnpm build`

`dist/changelog.html` をブラウザで開き、規約の節が最上部に出て、リタスの節が残っていることを確認。

- [ ] **Step 5: コミット**

```bash
git add public/changelog.html public/welcome.html privacy-policy.md docs/privacy-policy.md
git commit -m "docs: changelog・welcome・プライバシーポリシーに規約同意の案内を追加"
```

---

## Task 8: ストア提出文書と最終検証

**Files:**
- Create: `store-submission-v1.2.1.md`
- Modify: `WORKLOG.md`

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: 既存のストア提出文書を読む**

`store-submission-v1.2.0.md` を読み、節構成と粒度を把握する。同じ構成で v1.2.1 版を書く。

- [ ] **Step 2: `store-submission-v1.2.1.md` を書く**

必ず含める内容:

- **挙動変更の明示**: 利用規約への同意までは、LETUS / CLASS へのアクセスと通知を一切行わない。既存ユーザーはアップデート後、拡張アイコンのバッジから同意画面に進む
- **権限の変更なし**: `permissions` / `host_permissions` は v1.2.0 から変更していない
- **v1.2.1 の機能修正**（`ea131ed`）: 英字入り科目ID（例 9975A06）のコース自動選択、LETUS ページ上バッジの提出状態更新、課題ページ右下表示を提出状態へ
- **規約 URL**: https://lms.waiteu.dev/terms

`docs/permission-justification.md` に変更が要らないことも確認して明記する（権限は増えていない）。

- [ ] **Step 3: `landing/terms.html` の公開手順を確認**

`docs/app-landing-publish-runbook.md` を読み、`landing/` の配信方法（Cloudflare Pages 等）を確認する。`lms.waiteu.dev/terms` として配信されるかを検証し、パスが合わないなら `landing/terms.html` の配置か runbook の記述を修正する。

**この Step で URL が確定できない場合、Task 6・7 で埋め込んだ `https://lms.waiteu.dev/terms` を実際の URL に一括置換すること。** 規約 URL が 404 のまま公開してはならない。

- [ ] **Step 4: 全テストと型検査**

Run: `pnpm vitest run src`
Expected: 全 PASS

Run: `pnpm lint`
Expected: エラーなし

Run: `pnpm build`
Expected: エラーなし

- [ ] **Step 5: 未同意状態の通し確認**

`dist` を読み込み直し、`chrome.storage.local` をクリアしたうえで:

1. 拡張アイコンに `!` が出る
2. LETUS のコースページを開いても、コース検出も DOM 注入も起きない（コンソールに inactive のログ）
3. CLASS の時間割ページを開いても、取り込みトーストが出ない
4. popup を開くと同意画面。閉じる導線が無い
5. DevTools の Network で、LETUS / CLASS への fetch が発生していないこと
6. 「同意して始める」→ バッジが消え、通常どおりコース検出とスキャンが動く
7. `chrome.storage.local` の `termsConsent` を `{version: 0, acceptedAt: "..."}` に書き換える → バッジが復活し、popup が同意画面に戻る（再同意の検証）

- [ ] **Step 6: `WORKLOG.md` に記録**

既存の書式に合わせて v1.2.1 のリスク抑制パッケージの節を追加する。実装済みだが**実機での通し確認の結果**（Step 5 の各項目）を明記すること。

- [ ] **Step 7: コミット**

```bash
git add store-submission-v1.2.1.md WORKLOG.md
git commit -m "docs: v1.2.1 ストア提出文書と作業記録"
```

---

## Self-Review 結果

**スペック網羅性:** spec の各節に対応するタスクを確認した。

| spec の要求 | 対応タスク |
|---|---|
| データモデル `termsConsent` | Task 2 |
| `termsVersion.ts` / `termsConsent.ts` / `termsBody.ts` / `TermsConsentScreen.tsx` | Task 1, 2, 5 |
| 収集停止フック1（`runAutoScan`） | Task 3 |
| 収集停止フック2（`onMessage` 収集系3種、`OPEN_DASHBOARD` は通す） | Task 3 |
| 収集停止フック3（content script 2本、`initManualTaskWidget` 含む） | Task 4 |
| `App.tsx` 自動 refresh のガード | Task 5 |
| `isDashboard` 分岐より前にゲート | Task 5 |
| バッジ（`setBadgeText`、通知は使わない） | Task 3 |
| 画面順序 規約→オンボ→通常 | Task 5（`showOnboarding` は既存のまま、ゲートがその手前に立つ） |
| 規約の条項6項目 | Task 1 |
| 単一正典と生成スクリプト、再生成差分テスト | Task 1 |
| `landing/terms.html` 公開と相互リンク | Task 7, 8 |
| LICENSE 4項目追記、cabetus 許諾維持 | Task 6 |
| README 追随 | Task 6 |
| changelog 最上部、welcome、`manifest` bump なし | Task 7（Global Constraints で bump 禁止を明示） |
| ストア提出文書 | Task 8 |
| 既存データを消さない | Task 2（`saveConsent` は `termsConsent` のみ書く。削除処理を持たない） |
| テスト方針3系統 | Task 1（生成物一致）、2（純ロジック）、3（フック） |

**未カバーだったもの:** spec の「Chrome 通知は使わない」は Global Constraints に明記した。spec に無かったが実装上必要な `initManualTaskWidget` の停止は Task 4 に含めた（spec も更新済み）。

**型の一貫性:** `isConsented()` は Task 2 で定義し、Task 3・4・5 で同名・同シグネチャ（`() => Promise<boolean>`）で使用。`saveConsent()` は Task 2 で `(version?: number) => Promise<void>`、Task 5 で引数なし呼び出し。`TERMS_CONSENT_KEY` は Task 2 で定義し Task 3 のリスナで使用。`TERMS_BODY` は Task 1 で生成し Task 5 で使用。`updateConsentBadge()` は Task 3 内で完結。

**リスクの残る箇所:** Task 4 Step 3 のビルド出力検証。content script が classic script であるため、共有モジュールの import が出力されると壊れる。対処法を Step 3 に明記した。
