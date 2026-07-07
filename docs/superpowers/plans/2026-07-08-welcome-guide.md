# インストール時ウェルカムガイド Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新規インストール時(＋既存ユーザーは次回アップデート時に一度だけ)に、拡張機能の固定方法と使い始め方を案内する welcome.html をタブで開く。

**Architecture:** `public/welcome.html` + `public/welcome.js` を静的ページとして追加(ビルドで `dist/` にそのままコピーされる)。`src/background/index.ts` の `onInstalled` リスナーを、テスト可能な `handleInstalled()` 関数に抽出し、`chrome.storage.local` の `welcomeGuideShown` フラグで welcome / changelog の出し分けを行う。

**Tech Stack:** TypeScript (background), Vitest, バニラJS+静的HTML (welcome ページ), chrome.storage.local / chrome.tabs / chrome.alarms

**Spec:** `docs/superpowers/specs/2026-07-08-welcome-guide-design.md`

## Global Constraints

- 作業ブランチ: `feature/welcome-guide`(作成済み・チェックアウト済み)
- welcome ページは日本語のみ。MV3 の CSP によりインラインスクリプト禁止 → JS は必ず `welcome.js` に分離
- ストレージフラグのキー名は `welcomeGuideShown`(定数名 `WELCOME_GUIDE_SHOWN_KEY`)
- Edge 判定は `navigator.userAgent.includes('Edg/')`
- リタス事前登録リンクは `https://lms.waiteu.dev/app`(`target="_blank"`)
- テスト実行: `pnpm vitest run src/background/index.test.ts`(package.json に test スクリプトはない)
- ビルド: `pnpm build`
- コミットフッターに `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: onInstalled の出し分けロジック(`handleInstalled`)

**Files:**
- Modify: `src/background/storageKeys.ts`(末尾に1行追加)
- Modify: `src/background/index.ts:900-909`(onInstalled リスナーを関数抽出+ロジック変更)
- Test: `src/background/index.test.ts`(describe ブロック追加)

**Interfaces:**
- Consumes: 既存の `ALARM_NAME` / `ALARM_PERIOD_MINUTES`(index.ts 内部定数)、既存 chrome モック(index.test.ts の `store` と `vi.stubGlobal`)
- Produces: `export async function handleInstalled(details: chrome.runtime.InstalledDetails): Promise<void>`(index.ts から export)、`export const WELCOME_GUIDE_SHOWN_KEY = 'welcomeGuideShown'`(storageKeys.ts から export)。Task 2 は `welcome.html` というファイル名だけに依存する。

- [ ] **Step 1: ストレージキーを追加**

`src/background/storageKeys.ts` の末尾に追加:

```ts
export const WELCOME_GUIDE_SHOWN_KEY = 'welcomeGuideShown'
```

- [ ] **Step 2: 失敗するテストを書く**

`src/background/index.test.ts` に追加。import を修正:

```ts
// 既存の storageKeys import に WELCOME_GUIDE_SHOWN_KEY を追加
import {
  ASSIGNMENT_CANDIDATES_KEY,
  ASSIGNMENTS_KEY,
  COURSES_KEY,
  DEADLINE_SCAN_STATUS_KEY,
  WELCOME_GUIDE_SHOWN_KEY,
} from './storageKeys'

// 既存の `await import('./index')` の分割代入に handleInstalled を追加
const {
  upsertAssignments,
  checkIsLoggedIn,
  scanAssignmentCandidatesInBackground,
  scanDeadlinesInBackground,
  handleInstalled,
  ALARM_PERIOD_MINUTES,
} = await import('./index')
```

ファイル末尾に describe を追加:

```ts
describe('handleInstalled', () => {
  it('新規インストール時はwelcome.htmlを開きフラグを保存する', async () => {
    await handleInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails)

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'welcome.html' })
    expect(store[WELCOME_GUIDE_SHOWN_KEY]).toBe(true)
  })

  it('アップデート時にフラグ未保存ならwelcome.htmlを開きフラグを保存する', async () => {
    await handleInstalled({ reason: 'update' } as chrome.runtime.InstalledDetails)

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'welcome.html' })
    expect(chrome.tabs.create).not.toHaveBeenCalledWith({ url: 'changelog.html' })
    expect(store[WELCOME_GUIDE_SHOWN_KEY]).toBe(true)
  })

  it('アップデート時にフラグ保存済みならchangelog.htmlを開く', async () => {
    store[WELCOME_GUIDE_SHOWN_KEY] = true

    await handleInstalled({ reason: 'update' } as chrome.runtime.InstalledDetails)

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'changelog.html' })
    expect(chrome.tabs.create).not.toHaveBeenCalledWith({ url: 'welcome.html' })
  })

  it('理由によらず定期スキャンのアラームを作成する', async () => {
    await handleInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails)

    expect(chrome.alarms.create).toHaveBeenCalledWith(
      expect.any(String),
      { delayInMinutes: ALARM_PERIOD_MINUTES, periodInMinutes: ALARM_PERIOD_MINUTES },
    )
  })
})
```

補足: `chrome.tabs.create` / `chrome.alarms.create` は `beforeEach` の `vi.stubGlobal` で毎回新しい `vi.fn()` に差し替わるため、`expect(chrome.tabs.create)` でそのまま検証できる。`chrome.runtime.getURL` のモックはパスをそのまま返すので URL は `'welcome.html'` になる。

- [ ] **Step 3: テストが失敗することを確認**

Run: `pnpm vitest run src/background/index.test.ts`
Expected: FAIL — `handleInstalled` が export されていないため `handleInstalled is not a function` などで4件失敗

- [ ] **Step 4: 実装**

`src/background/index.ts` の現在の onInstalled リスナー(900-909行):

```ts
chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: ALARM_PERIOD_MINUTES,
    periodInMinutes: ALARM_PERIOD_MINUTES,
  })

  if (details.reason === 'update') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('changelog.html') })
  }
})
```

を以下に置き換える:

```ts
export async function handleInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: ALARM_PERIOD_MINUTES,
    periodInMinutes: ALARM_PERIOD_MINUTES,
  })

  if (details.reason === 'install') {
    await chrome.storage.local.set({ [WELCOME_GUIDE_SHOWN_KEY]: true })
    await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') })
    return
  }

  if (details.reason === 'update') {
    const result = await chrome.storage.local.get(WELCOME_GUIDE_SHOWN_KEY) as {
      welcomeGuideShown?: boolean
    }
    if (result.welcomeGuideShown === true) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('changelog.html') })
    } else {
      await chrome.storage.local.set({ [WELCOME_GUIDE_SHOWN_KEY]: true })
      await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') })
    }
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  handleInstalled(details).catch((error) => {
    console.error('[LETUS Task Watcher] onInstalled handling failed', error)
  })
})
```

storageKeys の import(index.ts 冒頭付近の既存 `from './storageKeys'` 行)に `WELCOME_GUIDE_SHOWN_KEY` を追加する。

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm vitest run src/background/index.test.ts`
Expected: PASS(既存テスト含め全件)

- [ ] **Step 6: 全テスト実行**

Run: `pnpm vitest run`
Expected: PASS(全ファイル)

- [ ] **Step 7: コミット**

```bash
git add src/background/storageKeys.ts src/background/index.ts src/background/index.test.ts
git commit -m "feat(ext): open welcome guide on install and first update after release

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: welcome.html + welcome.js の作成

**Files:**
- Create: `public/welcome.html`
- Create: `public/welcome.js`

**Interfaces:**
- Consumes: Task 1 が開く URL `welcome.html`(runtime.getURL 基準なので dist ルート直下に配置される必要がある = `public/` 直下で正しい)。`changelog.html`・`index.html#dashboard`・`favicon.svg`・`icons/icon-32.png` は既存ファイルへの相対参照。
- Produces: `dist/welcome.html`(ビルドで `public/` からコピー)。`data-browser="chrome"` / `data-browser="edge"` 属性の要素を `welcome.js` が UA で出し分ける。

- [ ] **Step 1: `public/welcome.js` を作成**

```js
var isEdge = navigator.userAgent.includes('Edg/');
document.querySelectorAll('[data-browser]').forEach(function (el) {
  var forEdge = el.getAttribute('data-browser') === 'edge';
  if (forEdge !== isEdge) el.hidden = true;
});
```

- [ ] **Step 2: `public/welcome.html` を作成**

changelog.html と同系統のスタイル。全文:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LETUS Task Watcher — ようこそ</title>
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="icons/icon-32.png" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      color: #1a1a1a;
      padding: 40px 16px;
    }
    .container {
      max-width: 640px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }
    .eyebrow {
      font-size: 12px;
      font-weight: 600;
      color: #7c3aed;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
    .subtitle { font-size: 14px; color: #6b7280; margin-bottom: 32px; }
    h2 {
      font-size: 15px;
      font-weight: 700;
      color: #374151;
      margin: 32px 0 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e5e7eb;
    }
    p { font-size: 14px; line-height: 1.7; margin-bottom: 10px; }

    /* ── 固定手順のイラスト ── */
    .toolbar-demo {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 10px 14px;
      margin: 12px 0;
      font-size: 13px;
      color: #6b7280;
    }
    .toolbar-demo .addr {
      flex: 1;
      background: #ffffff;
      border-radius: 99px;
      padding: 6px 14px;
      border: 1px solid #e5e7eb;
      font-size: 12px;
    }
    .toolbar-demo .puzzle {
      font-size: 18px;
      animation: pulse 1.6s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.25); }
    }
    ol.steps { margin: 0 0 8px 0; padding-left: 0; list-style: none; counter-reset: step; }
    ol.steps li {
      font-size: 14px;
      line-height: 1.7;
      padding: 8px 0 8px 40px;
      position: relative;
      counter-increment: step;
      border-bottom: 1px solid #f3f4f6;
    }
    ol.steps li::before {
      content: counter(step);
      position: absolute;
      left: 0;
      top: 8px;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #ede9fe;
      color: #7c3aed;
      font-weight: 700;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .note {
      font-size: 12px;
      color: #6b7280;
      background: #fafafa;
      border: 1px solid #f3f4f6;
      border-radius: 8px;
      padding: 10px 12px;
      margin-top: 8px;
    }
    .btn {
      display: inline-block;
      background: #7c3aed;
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 20px;
      border-radius: 8px;
      text-decoration: none;
      margin: 8px 8px 8px 0;
    }
    .btn.secondary {
      background: #ffffff;
      color: #7c3aed;
      border: 1px solid #ddd6fe;
    }
    .litus {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-radius: 10px;
      padding: 16px;
      margin-top: 32px;
    }
    .litus h2 { border: none; margin: 0 0 8px; padding: 0; color: #065f46; }
    .litus p { font-size: 13px; color: #065f46; margin-bottom: 0; }
    .litus a { color: #0f9e75; font-weight: 600; }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      font-size: 13px;
      color: #6b7280;
    }
    .footer a { color: #7c3aed; }
  </style>
</head>
<body>
  <div class="container">
    <p class="eyebrow">Welcome</p>
    <h1>LETUS Task Watcher へようこそ</h1>
    <p class="subtitle">LETUSの課題期限を自動で集めて、締切前に通知します。まずは2分でセットアップしましょう。</p>

    <h2>① ツールバーに固定しよう</h2>
    <p>固定しておくと、ワンクリックで課題一覧を開けます。</p>
    <div class="toolbar-demo">
      <span class="addr">letus.ed.tus.ac.jp</span>
      <span class="puzzle">🧩</span>
      <span>⋯</span>
    </div>
    <div data-browser="chrome">
      <ol class="steps">
        <li>アドレスバー右の <strong>🧩 パズルピースアイコン</strong>をクリック</li>
        <li>一覧から「LETUS Task Watcher」を探す</li>
        <li>右側の <strong>📌 ピンアイコン</strong>をクリックして固定</li>
      </ol>
    </div>
    <div data-browser="edge">
      <ol class="steps">
        <li>アドレスバー右の <strong>🧩 拡張機能アイコン</strong>をクリック</li>
        <li>一覧から「LETUS Task Watcher」を探す</li>
        <li>右側の <strong>👁 目のアイコン</strong>をクリックして「ツールバーに表示」</li>
      </ol>
    </div>
    <p class="note">固定すると、ツールバーの拡張機能アイコンから残り課題数がひと目でわかります。</p>

    <h2>② 使い始めの3ステップ</h2>
    <ol class="steps">
      <li><strong>LETUS を開く</strong> — コースページを開くと、コースが自動で登録されます</li>
      <li><strong>コースを選ぶ</strong> — ダッシュボードで追跡したいコースにチェック</li>
      <li><strong>今すぐ更新</strong> — ポップアップの「今すぐ更新」で課題を取得</li>
    </ol>
    <a class="btn" href="https://letus.ed.tus.ac.jp" target="_blank">LETUS を開く →</a>
    <a class="btn secondary" href="index.html#dashboard" target="_blank">ダッシュボードを開く</a>

    <h2>③ あとは通知を待つだけ</h2>
    <p>1日1回自動で課題をチェックし、期限が近づくとデスクトップ通知でお知らせします。通知のタイミングはダッシュボードから変更できます。</p>

    <div class="litus">
      <h2>📱 モバイルアプリ「リタス（Litus）」開発中</h2>
      <p>LETUSの課題も、CLASSの時間割も出席も、スマホひとつに。ブラウザを開かなくてもプッシュ通知を受け取れます。<a href="https://lms.waiteu.dev/app" target="_blank">事前登録はこちら →</a></p>
    </div>

    <div class="footer">
      アップデートで開かれた方へ: <a href="changelog.html">今回の更新内容はこちら</a>
    </div>
  </div>
  <script src="welcome.js"></script>
</body>
</html>
```

- [ ] **Step 3: ビルドして dist に入ることを確認**

Run: `pnpm build`
Expected: 成功。続けて確認:

Run: `ls dist/welcome.html dist/welcome.js`
Expected: 両ファイルが存在

- [ ] **Step 4: 表示確認(ブラウザ)**

`dist/` を拡張機能として読み込むか、`dist/welcome.html` を直接ブラウザで開き:
- Chrome の UA では Chrome 手順のみ表示される(Edge 手順が `hidden`)
- レイアウト崩れがない

拡張として読み込まない場合、`index.html#dashboard` リンクは動かなくてよい(拡張内でのみ有効)。

- [ ] **Step 5: コミット**

```bash
git add public/welcome.html public/welcome.js
git commit -m "feat(ext): add welcome guide page (pin instructions + getting started)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 記録類の更新

**Files:**
- Modify: `WORKLOG.md`(先頭に追記)
- Modify: `TASKS.md`(該当タスクがあれば完了マーク、なければ追記不要)

**Interfaces:**
- Consumes: Task 1・2 の完了
- Produces: なし(記録のみ)

- [ ] **Step 1: WORKLOG.md に追記**

WORKLOG.md の既存フォーマットに合わせ、先頭に本日分としてウェルカムガイド実装(welcome.html 新設、onInstalled 出し分け、フラグ `welcomeGuideShown`)を記録する。

- [ ] **Step 2: コミット**

```bash
git add WORKLOG.md TASKS.md
git commit -m "docs: log welcome guide implementation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
