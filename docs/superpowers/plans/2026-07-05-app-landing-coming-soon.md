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
- Xでの公開告知が前提。煽り強めのコピー、Xフォロー導線、専用OGP/Twitterカード画像を含める。
- Xハンドルは `@yning_y2`（`twitter:site` とフォローCTAに使用）。
- v2.0.x内で実装予定の全機能に言及する（「公開時に使える」＝v2.0.0初版 と「順次追加予定」＝v2.0.x を分けて掲載）。後送り機能は必ず「予定」と明記し過度な約束を避ける。
- 有料予定の機能（見張り番）は機能名のみ掲載し、価格は載せない（[feedback_pricing_display]）。
- アプリ名（ブランド）は **リタス**（カタカナが主表記）。ローマ字サブ表記は **Litas**（L始まりで旧LETUSの名残）。※2026-07-06: 下記の衝突回避のためローマ字を **Litus** へ変更。副題は「東京理科大 非公式・LETUS/CLASS対応」。拡張機能名「LETUS Task Watcher」は据え置き、コード/内部識別子はコード名を継続。
- リタスのアイコンは既存マーク（`public/favicon.svg` のジグザグ形）を**翠（ティール #0f9e75）に色替え**して使う。拡張機能は現行紫のまま。レタス（LETUS≒lettuce）のオマージュとして翠を採用。
- 英字 "Litas" は国際的に既存アプリ/暗号資産と衝突する（→この理由で 2026-07-06 にローマ字を "Litus" へ変更）。新規ドメイン(litas.io等)やハンドルは取りに行かない。ランディングは `lms.waiteu.dev/app`、Xは `@yning_y2` を使う。ローマ字はロゴのサブ表記に留める。

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
- `<footer> ... </footer>` ブロック（`landing/index.html:711-719`）

`<header>`（`landing/index.html:384-392`）は構造・CSSクラスは流用しつつ、以下だけ差し替える（app.html用のブランドに合わせる）:
- ロゴ画像 `img src="icon-128.png"`（紫）→ 翠のインラインSVGマーク（下記）。ブランド名テキスト `LETUS Task Watcher` → `リタス`
- 右上の「インストール（無料）」CWSボタン → 「PC版はこちら」（`href="index.html"`）に変更（app.htmlはまだインストール先が無いため）

app.html用ヘッダー:

```html
<header>
  <div class="inner">
    <div class="logo">
      <span class="logo-mark" aria-hidden="true">
        <svg width="26" height="25" viewBox="0 0 48 46" fill="none"><path fill="#0f9e75" d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"/></svg>
      </span>
      <span>リタス</span>
    </div>
    <a href="index.html" class="btn-cws">PC版はこちら</a>
  </div>
</header>
```

`<head>` のmeta類は以下に差し替える（app.html専用のcanonical/OGP/構造化データ）:

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>リタス（Litas）| 東京理科大の課題通知アプリ・LETUS/CLASS対応（近日公開・事前登録受付中）</title>
  <meta name="description" content="リタス（Litas）は、東京理科大学LETUSの課題締切をスマホ単体で通知する非公式モバイルアプリ（iOS / Android）。CLASS時間割の閲覧にも対応。2026年後期の公開に向けて開発中。メール事前登録で公開時にお知らせします。">
  <link rel="canonical" href="https://lms.waiteu.dev/app">
  <meta property="og:type"        content="website">
  <meta property="og:url"         content="https://lms.waiteu.dev/app">
  <meta property="og:title"       content="リタス（Litas）— 東京理科大の課題通知アプリ、近日公開">
  <meta property="og:description" content="LETUSの課題通知をスマホだけで。CLASS時間割にも対応した理科大生向けアプリ「リタス」を開発中。メール事前登録受付中。">
  <meta property="og:image"       content="https://lms.waiteu.dev/app-og.png">
  <meta property="og:locale"      content="ja_JP">
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:site"        content="@yning_y2">
  <meta name="twitter:title"       content="リタス（Litas）— 東京理科大の課題通知アプリ、近日公開">
  <meta name="twitter:description" content="LETUSの課題通知をスマホだけで。CLASS時間割にも対応した理科大生向けアプリ「リタス」を開発中。メール事前登録受付中。">
  <meta name="twitter:image"       content="https://lms.waiteu.dev/app-og.png">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    "name": "リタス（Litas）",
    "alternateName": "Litas",
    "url": "https://lms.waiteu.dev/app",
    "image": "https://lms.waiteu.dev/app-og.png",
    "description": "東京理科大学LETUSの課題締切をスマホ単体で通知する非公式モバイルアプリ。CLASS時間割閲覧にも対応。開発中。",
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
  <h1>LETUSの課題通知が、<br><em>スマホだけで完結する。</em></h1>
  <p>PCも拡張機能もいらない。課題の収集も、締切のプッシュ通知も、時間割の確認も、スマホ1つで。理科大生のためのアプリを開発中です。</p>

  <!-- ヒーロー・スマホモックアップ（ロック画面通知）。Tablerフォントは読み込まないためアイコンはインラインSVG -->
  <div class="phone-mock" aria-hidden="true">
    <div class="phone-screen">
      <div class="lock-time">9:41</div>
      <div class="lock-date">月曜日 4月14日</div>
      <div class="notif notif-main">
        <div class="notif-head">
          <span class="notif-ico"><svg width="11" height="11" viewBox="0 0 24 24" fill="#fff"><path d="M12 2a6 6 0 0 0-6 6c0 3-1 5-2 6h16c-1-1-2-3-2-6a6 6 0 0 0-6-6zm0 20a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22z"/></svg></span>
          LETUS Task Watcher · 今
        </div>
        <div class="notif-title">まもなく締切です</div>
        <div class="notif-body">情報数学Ⅱ「レポート第3回」— 締切まで残り2時間</div>
      </div>
      <div class="notif notif-sub">
        <div class="notif-head-sub">LETUS Task Watcher · 8:00</div>
        <div class="notif-body">今日の締切が2件あります</div>
      </div>
    </div>
  </div>

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

  <!-- Xフォロー導線 -->
  <div class="x-follow">
    <span>最新情報とリリース速報はXで</span>
    <a href="https://x.com/yning_y2" target="_blank" rel="noopener" class="btn-x">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-7.3 8.3L23 22h-6.6l-5.2-6.8L5.3 22H2l7.8-8.9L1.6 2h6.8l4.7 6.2L18.9 2zm-1.2 18h1.8L7.4 3.9H5.5L17.7 20z"/></svg>
      @yning_y2 をフォロー
    </a>
  </div>
</div>

<!-- 機能一覧（v2.0.x 全機能） -->
<section class="features">
  <h2>できること</h2>
  <p class="features-sub">公開時に使える機能と、公開後のアップデートで順次追加していく予定の機能。</p>

  <h3 class="feat-group">公開時に使える</h3>
  <div class="feature-grid">
    <div class="feature-card"><h4>LETUS課題の自動収集</h4><p>履修コースの課題を自動で集め、締切順に一覧表示。</p></div>
    <div class="feature-card"><h4>締切前プッシュ通知</h4><p>24時間前・3時間前・1時間前にスマホへ直接通知。</p></div>
    <div class="feature-card"><h4>朝まとめ通知</h4><p>毎朝、その日以降の締切をまとめて1回お知らせ。</p></div>
    <div class="feature-card"><h4>CLASS時間割の閲覧</h4><p>履修時間割をアプリ内で確認。コマから対応するLETUSへ。</p></div>
    <div class="feature-card"><h4>提出状態の表示</h4><p>未提出・提出済みが一目でわかる。</p></div>
    <div class="feature-card"><h4>見張り番プッシュ</h4><p>締切間近の未提出課題を24h→6h→1hで追いかけ通知。提出を検知したら自動で止まる。</p></div>
  </div>

  <h3 class="feat-group">順次追加予定（アップデートで）</h3>
  <div class="feature-grid">
    <div class="feature-card upcoming"><h4>科目連携</h4><p>CLASSとLETUSを科目コードで自動でひも付け。</p></div>
    <div class="feature-card upcoming"><h4>手動で課題を追加</h4><p>自動収集に載らない課題も自分で追加。優先度・メモも。</p></div>
    <div class="feature-card upcoming"><h4>カスタム通知ルール</h4><p>通知のタイミングを自分好みに設定。</p></div>
    <div class="feature-card upcoming"><h4>スヌーズ</h4><p>通知を後で再通知。</p></div>
    <div class="feature-card upcoming"><h4>統計・振り返り</h4><p>提出状況をあとから振り返り。</p></div>
    <div class="feature-card upcoming"><h4>ホーム画面ウィジェット</h4><p>直近の締切をホーム画面に表示。</p></div>
    <div class="feature-card upcoming"><h4>PC拡張機能とデータ同期</h4><p>Chrome / Edge 拡張機能とアプリのデータを同期。</p></div>
  </div>
  <p class="feat-note">「順次追加予定」の機能は開発予定であり、内容・時期は変更される場合があります。</p>
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
    /* ヒーロー・スマホモックアップ */
    .phone-mock { width: 240px; margin: 32px auto 8px; background: #1e1b2e; border-radius: 32px; padding: 8px; }
    .phone-screen { background: #12101c; border-radius: 26px; min-height: 300px; padding: 26px 16px; display: flex; flex-direction: column; align-items: center; }
    .lock-time { color: #fff; font-size: 46px; font-weight: 700; line-height: 1.1; }
    .lock-date { color: #e5e3f0; font-size: 13px; margin-bottom: 22px; }
    .notif { width: 100%; border-radius: 14px; padding: 10px 12px; text-align: left; }
    .notif-main { background: rgba(255,255,255,0.13); }
    .notif-sub { background: rgba(255,255,255,0.07); margin-top: 8px; }
    .notif-head { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #c7c9f7; margin-bottom: 5px; }
    .notif-head-sub { font-size: 11px; color: #a9a7bd; margin-bottom: 3px; }
    .notif-ico { width: 18px; height: 18px; border-radius: 5px; background: var(--accent); display: inline-flex; align-items: center; justify-content: center; }
    .notif-title { font-size: 12px; color: #fff; font-weight: 700; }
    .notif-body { font-size: 11px; color: #d7d5e6; line-height: 1.4; }
    /* Xフォロー導線 */
    .x-follow { margin-top: 26px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .x-follow span { font-size: 13px; color: var(--text-mid); }
    .btn-x { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 999px; background: #0f1419; color: #fff; text-decoration: none; font-weight: 700; font-size: 14px; }
    /* 機能一覧 */
    .features, .whatnext, .crosslink { max-width: 900px; margin: 56px auto; padding: 0 20px; text-align: center; }
    .features-sub { color: var(--text-mid); font-size: 14px; }
    .feat-group { margin-top: 40px; font-size: 18px; color: var(--text-dark); }
    .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-top: 20px; }
    .feature-card { background: var(--bg-card); border-radius: 16px; padding: 24px; text-align: left; }
    .feature-card.upcoming { background: transparent; border: 1px dashed var(--text-light); }
    .feature-card h4 { margin-bottom: 6px; color: var(--text-dark); font-size: 15px; }
    .feature-card p { color: var(--text-mid); font-size: 14px; line-height: 1.6; }
    .feat-note { margin-top: 18px; font-size: 12px; color: var(--text-light); }
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

preview_start で `landing` を起動 → `/app.html` を開く。preview_snapshot でヒーロー見出し「LETUSの課題通知が、スマホだけで完結する。」、スマホモックアップ、フォーム、Xフォローボタン、機能一覧（公開時に使える／順次追加予定の両グループ）の存在を確認。preview_screenshot でモックアップと全体の見た目を確認。preview_console_logs でエラーが無いことを確認。
（フォーム送信の実POSTは本番API相手なので、ここではUIレンダリングとバリデーション表示＝同意なし送信で「同意が必要」表示までを確認。実登録はTask 1のAPIをローカル起動して繋ぐか、本番反映後にsmokeする。og:imageの `app-og.png` はTask 4で生成するまで404になるが、ページ表示には影響しない。）

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
        <div class="rm-desc">スマホ単体でLETUSの課題収集とCLASS時間割閲覧に対応。2026年9月の後期開始に合わせた公開を目標に開発中。アプリ名は「リタス」。<a href="app.html">事前登録はこちら</a>。</div>
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

### Task 4: 専用OGP/Twitterカード画像（`landing/app-og.png` 1200×630）

**Files:**
- Create: `landing/og-app.html`（OG画像用のHTMLテンプレート。画像生成専用でサイトからはリンクしない）
- Create: `landing/app-og.png`（生成物。`app.html` の `og:image`/`twitter:image` が参照）

**Interfaces:**
- Produces: `https://lms.waiteu.dev/app-og.png`（Task 2の `<meta property="og:image">` と `<meta name="twitter:image">` が指すファイル）。

デザイン方針: 左にブランド「リタス（Litas）」＋キャッチ「LETUSの課題通知が、スマホだけで完結する。／近日公開・事前登録受付中」、右にヒーローと同じスマホ・ロック画面通知モックアップ。背景はリタスの翠（ティール）系。X投稿のタイムラインで一目で内容が伝わることを最優先。

- [ ] **Step 1: OG画像テンプレートを作る**

`landing/og-app.html` を新規作成。viewportちょうど1200×630の1枚絵。`app.html` のモックアップCSS（`.phone-mock` 系）を流用してよい。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; overflow: hidden; }
    .og { width: 1200px; height: 630px; background: linear-gradient(135deg, #0f9e75 0%, #0b7d63 100%);
          display: flex; align-items: center; gap: 48px; padding: 0 72px; font-family: -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif; color: #fff; }
    .og-copy { flex: 1; }
    .og-brand-name { font-size: 40px; font-weight: 800; margin-bottom: 16px; letter-spacing: 1px; }
    .og-badge { display: inline-block; background: rgba(255,255,255,0.2); border-radius: 999px; padding: 8px 20px; font-size: 20px; font-weight: 700; margin-bottom: 28px; }
    .og-title { font-size: 54px; font-weight: 800; line-height: 1.25; }
    .og-title em { font-style: normal; color: #fde68a; }
    .og-sub { margin-top: 28px; font-size: 26px; opacity: 0.95; }
    .og-brand { margin-top: 40px; font-size: 22px; font-weight: 700; opacity: 0.9; }
    .phone { width: 300px; background: #1e1b2e; border-radius: 44px; padding: 12px; flex-shrink: 0; }
    .screen { background: #12101c; border-radius: 34px; height: 540px; padding: 40px 22px; display: flex; flex-direction: column; align-items: center; }
    .t { color: #fff; font-size: 64px; font-weight: 700; }
    .d { color: #e5e3f0; font-size: 18px; margin-bottom: 30px; }
    .n { width: 100%; background: rgba(255,255,255,0.14); border-radius: 18px; padding: 16px 18px; }
    .nh { font-size: 15px; color: #c7c9f7; margin-bottom: 8px; }
    .nt { font-size: 17px; color: #fff; font-weight: 700; }
    .nb { font-size: 15px; color: #d7d5e6; line-height: 1.4; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="og">
    <div class="og-copy">
      <div class="og-brand-name">リタス <span style="font-size:24px; font-weight:700; opacity:0.85;">Litas</span></div>
      <div class="og-badge">iOS / Android ・ 近日公開</div>
      <div class="og-title">LETUSの課題通知が、<br><em>スマホだけで完結する。</em></div>
      <div class="og-sub">課題収集・締切プッシュ・時間割まで、スマホ1つで。</div>
      <div class="og-brand">東京理科大 非公式 ・ 事前登録受付中</div>
    </div>
    <div class="phone">
      <div class="screen">
        <div class="t">9:41</div>
        <div class="d">月曜日 4月14日</div>
        <div class="n">
          <div class="nh">LETUS Task Watcher ・ 今</div>
          <div class="nt">まもなく締切です</div>
          <div class="nb">情報数学Ⅱ「レポート第3回」— 締切まで残り2時間</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 2: 1200×630でスクリーンショットしてPNG化**

preview_start（Task 2の `landing` 設定）で `/og-app.html` を開く。preview_resize で `width: 1200, height: 630` に設定。preview_screenshot を撮る。

- [ ] **Step 3: 撮った画像を `landing/app-og.png` として保存**

preview_screenshot が返す画像をスクラッチパッドに保存後、`landing/app-og.png` に配置する（この工程はスクリーンショットのバイト列をファイル化するもの。実行者はスクショ結果を確認し、1200×630・文字切れなし・モックアップが収まっていることを目視確認する）。文字切れやレイアウト崩れがあれば `og-app.html` を調整してStep 2からやり直す。

- [ ] **Step 4: コミット**

```bash
git add landing/og-app.html landing/app-og.png
git commit -m "feat(landing): dedicated OG/Twitter card image for /app"
```

---

## フェーズ2メモ（今回スコープ外）

ストア登録完了後に別タスクとして実施:
- `waitlist` からメールをSELECTし、Resend（`api/lib/email.js` に送信関数を追加）でストア事前予約リンクを一斉送信。送信済みは `notified_at` を更新する使い捨てスクリプト。
- `app.html` のヒーローCTAをメールフォームからストアバッジ（App Store / Google Play）に差し替え、`MobileApplication` 構造化データに `installUrl` を追加。

## 本番反映時の注意

- `api/` の変更（Task 1）を本番へ出す際は、ラズパイで `pm2 restart` まで実施（[feedback_raspi_deploy_restart]）。
- `landing/` の変更（Task 2,3,4）はpushで Cloudflare Pages が自動デプロイ。反映後に `https://lms.waiteu.dev/app` を実ブラウザで開き、フォーム送信→200→`waitlist` テーブルに1行入ることをsmokeする。
- X告知前に、Xの投稿作成画面またはOGPデバッガでカードプレビュー（`app-og.png`＋タイトル＋説明）が意図通り表示されることを確認する。カードキャッシュは初回取得で固定されるため、Task 4のOG画像デプロイ後にX告知する順序を守る。

## Self-Review

- **Spec coverage:** app.html独立ページ（Task 2）／既存デザイン流用（Task 2 Step1）／Coming Soon＋メールフォーム（Task 2）／スマホモックアップ（Task 2 Step2＋CSS）／Xフォロー導線・`twitter:site`（Task 2）／v2.0.x全機能を公開時・予定の2グループで掲載（Task 2 Step2）／専用OGP画像（Task 4）／waitlistテーブル＋POST（Task 1）／honeypot＋レート制限＋冪等200（Task 1）／SEO・sitemap・構造化データ（Task 2,3）／相互リンク（Task 3）／privacy追記（Task 3）／フェーズ2は明示的にスコープ外。全項目タスクに対応。
- **Placeholders:** コピー指示（style/header/footer）は行番号付きで明示、privacy追記は挿入文言を明記、モックアップ/OGテンプレは完全なコードを記載、アイコンはTablerフォント非依存のインラインSVG。Xハンドルは実値 `@yning_y2`。TODO/TBD無し。
- **Type consistency:** フォームフィールドid（`waitlist-email`/`consent`/`website`/`waitlist-form`/`waitlist-status`）はTask 2内で一貫。APIの `{email, source, website}` はTask 1のルートとTask 2のfetchで一致。`app-og.png` はTask 2のmeta参照とTask 4の生成物でパス一致。
- **注意点:** 「順次追加予定」機能（科目連携以外のウィジェット/スヌーズ/統計/カスタム通知/手動追加/拡張同期）は時期未確定のため各カードは実装約束ではなく「予定」として掲載し、末尾に変更ありうる旨の注記（`.feat-note`）を置く。見張り番は価格非表示（[feedback_pricing_display]）で機能名のみ。
