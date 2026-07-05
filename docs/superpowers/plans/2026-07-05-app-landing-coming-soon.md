# v2.0.0 アプリ用ランディング（Coming Soon＋事前登録）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v2.0.0モバイルアプリの公開前ランディング（`/app`）を既存サイトの見た目で1枚追加し、メール事前登録（waitlist）を受け付ける。

**Architecture:** フロントは `landing/app.html`（既存 `index.html` のCSS/ヘッダー/フッターを流用、Cloudflare Pagesで自動デプロイ）。バックはletus-apiに `waitlist` テーブルと `POST /api/waitlist` を追加（better-sqlite3、honeypot＋レート制限、Resend送信はフェーズ2で別途）。

**Tech Stack:** 静的HTML（インラインCSS/JS）、Express 5、better-sqlite3、Jest＋supertest。

## Global Constraints

- APIルートは `/api/` プレフィックス配下にマウント（例 `/api/waitlist`）。
- フロントのAPI呼び出しは `const API_BASE_URL = 'https://api.waiteu.dev'` を使い `${API_BASE_URL}/api/...` を叩く（既存landingページと統一）。
- CORS許可originは既に `https://lms.waiteu.dev` を含む（`api/server.js:19-27`）。追加設定不要。
- `landing/*` はpushで Cloudflare Pages 自動デプロイ（developブランチ、watch path `landing/*`）。
- `api/` 変更は本番反映時に必ず `pm2 restart` までセットで行う（ラズパイ、[feedback_raspi_deploy_restart]）。
- 収集PIIはメールのみ。用途は公開通知に限定する旨をフォーム近傍と `privacy.html` に明記。
- 既存デザインは流用し、新規デザインは起こさない（配色変数 `--accent`/`--violet`/`--grad-btn` 等をそのまま使う）。

---

### Task 1: バックエンド — waitlistテーブル＋`POST /api/waitlist`

**Files:**
- Modify: `api/db/sqlite.js`（`db.exec` のテーブル定義ブロックに追記）
- Create: `api/routes/waitlist.js`
- Modify: `api/server.js:11`（require追加）, `api/server.js:34`（mount追加）
- Test: `api/tests/waitlist.test.js`

**Interfaces:**
- Produces: `POST /api/waitlist`。リクエストbody `{ email: string, source?: string, website?: string }`。
  - `website` はhoneypot（空であるべき隠しフィールド）。値があればbotとして黙って `200 {ok:true}`。
  - 有効メールなら `200 {ok:true}`（新規/重複いずれも同じ応答＝冪等）。
  - 無効メールは `400 {error}`。
  - テスト以外の環境でIPレート制限（60秒に5件超で `429 {error}`）。
- Consumes: `api/db/sqlite.js` がexportする better-sqlite3 の `db` インスタンス。

- [ ] **Step 1: waitlistテーブル定義を追加**

`api/db/sqlite.js` の `db.exec(\`...\`)` テンプレート内、`discord_course_roles` テーブル定義の直後（`api/db/sqlite.js:88` の閉じ `);` の後、テンプレート閉じ `` \` `` の前）に以下を追加:

```sql

  CREATE TABLE IF NOT EXISTS waitlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'app-landing',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    notified_at TEXT
  );
```

- [ ] **Step 2: 失敗するテストを書く**

`api/tests/waitlist.test.js` を新規作成:

```js
process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'

const request = require('supertest')
const app = require('../server')
const db = require('../db/sqlite')

describe('POST /api/waitlist', () => {
  it('有効なメールで事前登録できる', async () => {
    const res = await request(app)
      .post('/api/waitlist')
      .send({ email: 'wait@example.com', source: 'app-landing' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    const row = db.prepare('SELECT email, source FROM waitlist WHERE email = ?').get('wait@example.com')
    expect(row).toEqual({ email: 'wait@example.com', source: 'app-landing' })
  })

  it('不正なメールは400になる', async () => {
    const res = await request(app)
      .post('/api/waitlist')
      .send({ email: 'not-an-email' })
    expect(res.status).toBe(400)
  })

  it('同じメールを2回登録しても200（冪等）', async () => {
    await request(app).post('/api/waitlist').send({ email: 'dup2@example.com' })
    const res = await request(app).post('/api/waitlist').send({ email: 'dup2@example.com' })
    expect(res.status).toBe(200)
    const count = db.prepare('SELECT COUNT(*) c FROM waitlist WHERE email = ?').get('dup2@example.com').c
    expect(count).toBe(1)
  })

  it('honeypot(website)が埋まっていたら200だがDBには入らない', async () => {
    const res = await request(app)
      .post('/api/waitlist')
      .send({ email: 'bot@example.com', website: 'http://spam.example' })
    expect(res.status).toBe(200)
    const row = db.prepare('SELECT * FROM waitlist WHERE email = ?').get('bot@example.com')
    expect(row).toBeUndefined()
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd api && npx jest tests/waitlist.test.js`
Expected: FAIL（`Cannot POST /api/waitlist` により全ケース失敗、または404）

- [ ] **Step 4: ルートを実装**

`api/routes/waitlist.js` を新規作成:

```js
const express = require('express')
const db = require('../db/sqlite')

const router = express.Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// 単一プロセス想定の軽量インメモリレート制限（60秒に5件超で拒否）
const WINDOW_MS = 60 * 1000
const MAX_PER_WINDOW = 5
const hits = new Map()

function rateLimited(ip) {
  const now = Date.now()
  const rec = hits.get(ip)
  if (!rec || now - rec.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 })
    return false
  }
  rec.count += 1
  return rec.count > MAX_PER_WINDOW
}

router.post('/', (req, res) => {
  const { email, source, website } = req.body || {}

  // honeypot: 隠しフィールドに値があればbot。黙って成功を返す。
  if (website) {
    return res.status(200).json({ ok: true })
  }

  if (process.env.NODE_ENV !== 'test' && rateLimited(req.ip)) {
    return res.status(429).json({ error: 'リクエストが多すぎます。時間をおいて再度お試しください。' })
  }

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: '有効なメールアドレスを入力してください' })
  }

  try {
    db.prepare(
      'INSERT OR IGNORE INTO waitlist (email, source) VALUES (?, ?)'
    ).run(
      email.trim().toLowerCase(),
      typeof source === 'string' && source ? source : 'app-landing'
    )
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'サーバーエラーが発生しました' })
  }
})

module.exports = router
```

`api/server.js` の他ルートrequire群（`api/server.js:11` の `discordRoutes` の次行）に追加:

```js
const waitlistRoutes = require('./routes/waitlist')
```

`api/server.js` のmount群（`api/server.js:34` の `app.use('/api/discord', discordRoutes)` の次行）に追加:

```js
app.use('/api/waitlist', waitlistRoutes)
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd api && npx jest tests/waitlist.test.js`
Expected: PASS（4ケース）

- [ ] **Step 6: 既存テストが壊れていないことを確認**

Run: `cd api && npx jest`
Expected: 全スイートPASS

- [ ] **Step 7: コミット**

```bash
git add api/db/sqlite.js api/routes/waitlist.js api/server.js api/tests/waitlist.test.js
git commit -m "feat(api): waitlist table + POST /api/waitlist for app pre-registration"
```

---

### Task 2: フロント — `landing/app.html`（Coming Soon＋事前登録フォーム）

**Files:**
- Create: `landing/app.html`
- 参照（コピー元・変更しない）: `landing/index.html`

**Interfaces:**
- Consumes: `POST /api/waitlist`（Task 1）を `body {email, source:'app-landing', website}` で叩く。
- フォームフィールドid: `waitlist-email`, `consent`(チェックボックス), `website`(honeypot), 送信ボタン内包の `waitlist-form`, ステータス表示 `waitlist-status`。

- [ ] **Step 1: index.htmlの共通部分を流用してapp.htmlの骨格を作る**

`landing/app.html` を新規作成する。次の3ブロックは `landing/index.html` から**バイト単位でそのままコピー**して使う（新規デザインを起こさない）:

- `<style> ... </style>` ブロック全体（`landing/index.html:69-379`）
- `<header> ... </header>` ブロック（`landing/index.html:384-392`）
- `<footer> ... </footer>` ブロック（`landing/index.html:711-719`）

`<head>` のmeta類は以下に差し替える（app.html専用のcanonical/OGP/構造化データ）:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LETUS Task Watcher モバイルアプリ | スマホだけでLETUSの課題通知（近日公開・事前登録受付中）</title>
  <meta name="description" content="東京理科大学LETUSの課題締切をスマホ単体で通知するモバイルアプリ（iOS / Android）。CLASS時間割の閲覧にも対応。2026年後期の公開に向けて開発中。メール事前登録で公開時にお知らせします。">
  <link rel="canonical" href="https://lms.waiteu.dev/app">
  <meta property="og:type"        content="website">
  <meta property="og:url"         content="https://lms.waiteu.dev/app">
  <meta property="og:title"       content="LETUS Task Watcher モバイルアプリ — 近日公開">
  <meta property="og:description" content="LETUSの課題通知をスマホだけで。iOS / Android 向けアプリを開発中。メール事前登録受付中。">
  <meta property="og:image"       content="https://lms.waiteu.dev/og-image.png">
  <meta property="og:locale"      content="ja_JP">
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="LETUS Task Watcher モバイルアプリ — 近日公開">
  <meta name="twitter:description" content="LETUSの課題通知をスマホだけで。iOS / Android 向けアプリを開発中。メール事前登録受付中。">
  <meta name="twitter:image"       content="https://lms.waiteu.dev/og-image.png">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    "name": "LETUS Task Watcher モバイルアプリ",
    "url": "https://lms.waiteu.dev/app",
    "image": "https://lms.waiteu.dev/og-image.png",
    "description": "東京理科大学LETUSの課題締切をスマホ単体で通知するモバイルアプリ。CLASS時間割閲覧にも対応。開発中。",
    "applicationCategory": "EducationApplication",
    "operatingSystem": "iOS, Android",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "JPY" },
    "inLanguage": "ja"
  }
  </script>
  <style>
  /* ここに landing/index.html:69-379 の <style> 内容をそのままコピー */
  </style>
</head>
<body>

<!-- ここに landing/index.html:384-392 の <header> をそのままコピー -->

<!-- 本文セクション（Step 2で挿入） -->

<!-- ここに landing/index.html:711-719 の <footer> をそのままコピー -->

<!-- スクリプト（Step 3で挿入） -->
</body>
</html>
```

- [ ] **Step 2: 本文セクション（ヒーロー＋フォーム＋訴求＋相互リンク）を挿入**

`<header>` と `<footer>` の間に以下を挿入。既存クラス（`hero`, `hero-badge`, `btn-primary` 等）を再利用しつつ、フォーム用の最小スタイルはこのページ内 `<style>` の末尾に追記する。

本文マークアップ:

```html
<!-- HERO -->
<div class="hero">
  <div class="hero-badge">iOS / Android &nbsp;·&nbsp; 近日公開 &nbsp;·&nbsp; 2026年後期 予定</div>
  <h1>LETUSの課題通知を、<br><em>スマホだけで。</em></h1>
  <p>PC拡張機能なしで、スマホ単体でLETUSの課題を収集し締切をプッシュ通知。CLASS時間割の閲覧にも対応した、iOS / Android 向けアプリを開発中です。</p>

  <form id="waitlist-form" class="waitlist-form" novalidate>
    <input id="waitlist-email" type="email" inputmode="email" autocomplete="email"
           placeholder="メールアドレス" required>
    <!-- honeypot: 人間には見えない。botが埋めたら送信を無効化 -->
    <input id="website" name="website" type="text" tabindex="-1" autocomplete="off"
           aria-hidden="true" class="hp-field">
    <label class="consent">
      <input id="consent" type="checkbox" required>
      <span><a href="privacy.html" target="_blank" rel="noopener">プライバシーポリシー</a>に同意し、公開時のお知らせメール受信に同意します</span>
    </label>
    <button type="submit" class="btn-primary">事前登録して公開を待つ</button>
    <p id="waitlist-status" class="waitlist-status" role="status" aria-live="polite"></p>
    <p class="waitlist-note">お預かりするのはメールアドレスのみ。公開のお知らせ以外には使用しません。</p>
  </form>
</div>

<!-- 価値訴求 -->
<section class="features">
  <h2>アプリでできること</h2>
  <div class="feature-grid">
    <div class="feature-card">
      <h3>スマホにプッシュ通知</h3>
      <p>PCを開いていなくても、締切前にスマホへ直接通知。課題の見逃しを防ぎます。</p>
    </div>
    <div class="feature-card">
      <h3>CLASS時間割の閲覧</h3>
      <p>履修中の時間割をアプリ内で確認。課題と授業を1つのアプリでまとめて把握。</p>
    </div>
    <div class="feature-card">
      <h3>アプリ単体で完結</h3>
      <p>PCブラウザの拡張機能は不要。スマホにインストールするだけで使い始められます。</p>
    </div>
  </div>
</section>

<!-- 登録すると何が届く -->
<section class="whatnext">
  <h2>事前登録すると？</h2>
  <p>公開したときに、登録メール宛でお知らせします。届くのはそれだけ。宣伝メールを何通も送ることはありません。</p>
</section>

<!-- 相互リンク -->
<section class="crosslink">
  <p>今すぐPCで課題通知を使うなら、Chrome / Edge 拡張機能が公開中です。</p>
  <a href="index.html" class="btn-secondary">PC版（拡張機能）を見る</a>
</section>
```

このページ内 `<style>` の末尾（`</style>` の直前）にフォーム用スタイルを追記:

```css
    .waitlist-form { max-width: 420px; margin: 28px auto 0; display: flex; flex-direction: column; gap: 12px; text-align: left; }
    .waitlist-form input[type="email"] { padding: 14px 16px; border-radius: 12px; border: 1px solid var(--text-light); font-size: 15px; }
    .hp-field { position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0; }
    .consent { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; color: var(--text-mid); line-height: 1.5; }
    .consent input { margin-top: 2px; }
    .waitlist-status { font-size: 13px; color: var(--accent); min-height: 18px; margin: 0; }
    .waitlist-note { font-size: 11px; color: var(--text-light); margin: 0; }
    .features, .whatnext, .crosslink { max-width: 900px; margin: 56px auto; padding: 0 20px; text-align: center; }
    .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-top: 28px; }
    .feature-card { background: var(--bg-card); border-radius: 16px; padding: 24px; text-align: left; }
    .feature-card h3 { margin-bottom: 8px; color: var(--text-dark); }
    .feature-card p { color: var(--text-mid); font-size: 14px; line-height: 1.6; }
    .btn-secondary { display: inline-block; margin-top: 12px; padding: 12px 28px; border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); text-decoration: none; font-weight: 700; font-size: 14px; }
```

（`--accent` などの変数が `<style>` に存在することを前提とする。存在しない場合は `landing/index.html:72-80` の `:root` 定義がコピーできているか確認する。）

- [ ] **Step 3: 送信スクリプトを挿入**

`</body>` の直前に追加:

```html
<script>
  const API_BASE_URL = 'https://api.waiteu.dev'
  const form = document.getElementById('waitlist-form')
  const statusEl = document.getElementById('waitlist-status')

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const email = document.getElementById('waitlist-email').value.trim()
    const website = document.getElementById('website').value
    const consent = document.getElementById('consent').checked

    if (!consent) {
      statusEl.textContent = 'プライバシーポリシーへの同意が必要です。'
      return
    }
    statusEl.textContent = '送信中...'

    try {
      const res = await fetch(`${API_BASE_URL}/api/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'app-landing', website }),
      })
      if (res.ok) {
        form.reset()
        statusEl.textContent = '事前登録が完了しました。公開時にメールでお知らせします。'
      } else {
        const data = await res.json().catch(() => ({}))
        statusEl.textContent = data.error || '送信に失敗しました。時間をおいて再度お試しください。'
      }
    } catch (_) {
      statusEl.textContent = 'ネットワークエラーです。時間をおいて再度お試しください。'
    }
  })
</script>
```

- [ ] **Step 4: ローカルで表示とフォーム挙動を確認**

`landing/` を静的サーバーで開く。`.claude/launch.json` が無ければ作成し、以下の設定を追加:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "landing", "runtimeExecutable": "npx", "runtimeArgs": ["--yes", "serve", "landing", "-l", "4173"], "port": 4173 }
  ]
}
```

preview_start で `landing` を起動 → `/app.html` を開く。preview_snapshot でヒーロー見出し「LETUSの課題通知を、スマホだけで。」とフォームの存在を確認。preview_console_logs でエラーが無いことを確認。
（フォーム送信の実POSTは本番API相手なので、ここではUIレンダリングとバリデーション表示＝同意なし送信で「同意が必要」表示までを確認。実登録はTask 1のAPIをローカル起動して繋ぐか、本番反映後にsmokeする。）

- [ ] **Step 5: コミット**

```bash
git add landing/app.html .claude/launch.json
git commit -m "feat(landing): app.html coming-soon page with email waitlist form"
```

---

### Task 3: 相互リンク・SEO・プライバシー追記

**Files:**
- Modify: `landing/sitemap.xml`
- Modify: `landing/index.html:468-469`（ロードマップ項目）, `landing/index.html:586`（FAQ回答）
- Modify: `landing/privacy.html`

**Interfaces:**
- Consumes: Task 2で作成した `/app`（`landing/app.html`）。

- [ ] **Step 1: sitemapに/appを追加**

`landing/sitemap.xml` の `privacy.html` の `<url>` ブロックの前に追加:

```xml
  <url>
    <loc>https://lms.waiteu.dev/app</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
```

- [ ] **Step 2: index.htmlのロードマップ項目から/appへリンク**

`landing/index.html:469` の行:

```html
        <div class="rm-desc">スマホ単体でLETUSの課題収集とCLASS時間割閲覧に対応。2026年9月の後期開始に合わせた公開を目標に開発中。</div>
```

を次に置き換える:

```html
        <div class="rm-desc">スマホ単体でLETUSの課題収集とCLASS時間割閲覧に対応。2026年9月の後期開始に合わせた公開を目標に開発中。<a href="app.html">事前登録はこちら</a>。</div>
```

- [ ] **Step 3: index.htmlのFAQ回答から/appへリンク**

`landing/index.html:586` の行:

```html
        <p>現在はPC版のChrome / Edgeのみ対応です。スマホ単体でLETUSの課題通知を受け取れるモバイルアプリ（iOS / Android）を開発中です。詳しくは「今後の展望」をご覧ください。</p>
```

を次に置き換える:

```html
        <p>現在はPC版のChrome / Edgeのみ対応です。スマホ単体でLETUSの課題通知を受け取れるモバイルアプリ（iOS / Android）を開発中で、<a href="app.html">事前登録を受付中</a>です。詳しくは「今後の展望」をご覧ください。</p>
```

- [ ] **Step 4: privacy.htmlにwaitlistメール収集の記載を追加**

`landing/privacy.html` を開き、収集する情報を説明しているセクションに、事前登録メールについての一文を既存の文体に合わせて追記する。追記する内容:

> モバイルアプリの公開前事前登録では、入力いただいたメールアドレスのみを取得し、アプリ公開のお知らせを送る目的にのみ使用します。第三者への提供や、その他の宣伝目的での利用は行いません。

（挿入位置は既存の見出し構造に合わせる。新しい見出しを増やさず、既存の「取得する情報」または相当セクションの末尾に段落として加える。）

- [ ] **Step 5: リンク切れとレンダリングを確認**

preview_start（Task 2の `landing` 設定）で `/index.html` を開き、ロードマップとFAQの「事前登録」リンクをpreview_clickして `/app.html` に遷移することを確認。`/app.html` からフッターの「プライバシーポリシー」で `/privacy.html` に遷移し、追記文が表示されることをpreview_snapshotで確認。

- [ ] **Step 6: コミット**

```bash
git add landing/sitemap.xml landing/index.html landing/privacy.html
git commit -m "feat(landing): cross-link /app from roadmap+FAQ, sitemap+privacy updates"
```

---

## フェーズ2メモ（今回スコープ外）

ストア登録完了後に別タスクとして実施:
- `waitlist` からメールをSELECTし、Resend（`api/lib/email.js` に送信関数を追加）でストア事前予約リンクを一斉送信。送信済みは `notified_at` を更新する使い捨てスクリプト。
- `app.html` のヒーローCTAをメールフォームからストアバッジ（App Store / Google Play）に差し替え、`MobileApplication` 構造化データに `installUrl` を追加。

## 本番反映時の注意

- `api/` の変更（Task 1）を本番へ出す際は、ラズパイで `pm2 restart` まで実施（[feedback_raspi_deploy_restart]）。
- `landing/` の変更（Task 2,3）はpushで Cloudflare Pages が自動デプロイ。反映後に `https://lms.waiteu.dev/app` を実ブラウザで開き、フォーム送信→200→`waitlist` テーブルに1行入ることをsmokeする。

## Self-Review

- **Spec coverage:** app.html独立ページ（Task 2）／既存デザイン流用（Task 2 Step1）／Coming Soon＋メールフォーム（Task 2）／waitlistテーブル＋POST（Task 1）／honeypot＋レート制限＋冪等200（Task 1）／SEO・sitemap・構造化データ（Task 2,3）／相互リンク（Task 3）／privacy追記（Task 3）／フェーズ2は明示的にスコープ外。全項目タスクに対応。
- **Placeholders:** コピー指示（style/header/footer）は行番号付きで明示、privacy追記は挿入文言を明記。TODO/TBD無し。
- **Type consistency:** フォームフィールドid（`waitlist-email`/`consent`/`website`/`waitlist-form`/`waitlist-status`）はTask 2内で一貫。APIの `{email, source, website}` はTask 1のルートとTask 2のfetchで一致。
