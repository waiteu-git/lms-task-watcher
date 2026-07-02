# Webアカウント登録・パスワード再設定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ホームページ（lms.waiteu.dev）から拡張機能未インストールでもアカウント登録・サブスク申し込みができるようにし、パスワード再設定機能をResend経由のメール送信で実装する。

**Architecture:** 既存のExpress API（`api/`、JWT + bcrypt認証）にパスワード再設定用のトークンテーブルとエンドポイントを追加し、Resend SDKでメール送信する。Webサイト（`landing/`、静的HTML）に素のJSで叩く登録・パスワード再設定ページを追加し、拡張機能の`LoginModal`にはパスワード再設定リクエスト用のモードを追加する。

**Tech Stack:** Node.js + Express + better-sqlite3（既存）、Resend（新規メール配信）、Jest + supertest（既存テスト基盤、`cd api && npx jest`で実行）、素のHTML/CSS/JS（Webサイト側、ビルド不要）。

## Global Constraints

- パスワード再設定トークンの有効期限: **1時間**
- パスワードのバリデーション: **8文字以上**（既存の`register`と同じ基準）
- メールアドレス列挙攻撃を防ぐため、`request-password-reset`はユーザーの有無に関わらず**常に同一の成功レスポンス**を返す
- トークンはDBに**生の値を保存しない**。SHA-256ハッシュのみ保存する
- CORS許可オリジンに`https://lms.waiteu.dev`を追加する（既存: `https://api.waiteu.dev`、`chrome-extension://*`）
- テストは`cd api && npx jest`で実行する（リポジトリルートからの`vitest run`はapi/testsを対象にしないこと）
- Webサイトの新規ページは`landing/privacy.html`と同じCSS変数命名（`--accent`, `--text-dark`, `--text-mid`, `--border`, `--bg-pale`, `--border-pale`）・ヘッダー/フッター構造に合わせる

---

### Task 1: メール送信モジュール（`api/lib/email.js`）

**Files:**
- Create: `api/lib/email.js`
- Modify: `api/package.json`（`resend`を`dependencies`に追加）
- Test: `api/tests/email.test.js`

**Interfaces:**
- Produces: `sendPasswordResetEmail(to: string, resetUrl: string): Promise<void>` — Task 2が呼び出す。送信失敗時は例外を投げる

- [ ] **Step 1: `resend`パッケージを追加**

Run:
```bash
cd api && npm install resend
```
Expected: `package.json`の`dependencies`に`"resend": "^<version>"`が追加される

- [ ] **Step 2: 失敗するテストを書く**

`api/tests/email.test.js`:
```js
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'

const mockSend = jest.fn()

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}))

const { sendPasswordResetEmail } = require('../lib/email')

describe('sendPasswordResetEmail', () => {
  afterEach(() => {
    mockSend.mockReset()
  })

  it('Resendのemails.sendを正しい引数で呼ぶ', async () => {
    mockSend.mockResolvedValue({ data: { id: 'email_123' }, error: null })

    await sendPasswordResetEmail('user@example.com', 'https://lms.waiteu.dev/reset-password.html?token=abc123')

    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@waiteu.dev',
      to: 'user@example.com',
      subject: 'パスワード再設定 - LETUS Task Watcher',
      html: expect.stringContaining('https://lms.waiteu.dev/reset-password.html?token=abc123'),
    })
  })

  it('Resendがerrorを返したら例外を投げる', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'invalid domain' } })

    await expect(
      sendPasswordResetEmail('user@example.com', 'https://lms.waiteu.dev/reset-password.html?token=abc123')
    ).rejects.toThrow('invalid domain')
  })
})
```

- [ ] **Step 2b: テストが失敗することを確認**

Run: `cd api && npx jest tests/email.test.js -v`
Expected: FAIL — `Cannot find module '../lib/email'`

- [ ] **Step 3: 実装する**

`api/lib/email.js`:
```js
const { Resend } = require('resend')

const resend = new Resend(process.env.RESEND_API_KEY)

async function sendPasswordResetEmail(to, resetUrl) {
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: 'パスワード再設定 - LETUS Task Watcher',
    html: `<p>以下のリンクから新しいパスワードを設定してください（1時間有効）。</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>心当たりがない場合はこのメールを無視してください。</p>`,
  })

  if (error) {
    throw new Error(error.message)
  }
}

module.exports = { sendPasswordResetEmail }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd api && npx jest tests/email.test.js -v`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add api/lib/email.js api/tests/email.test.js api/package.json api/package-lock.json
git commit -m "feat(api): add Resend email module for password reset"
```

---

### Task 2: パスワード再設定リクエスト（スキーマ + `POST /api/auth/request-password-reset`）

**Files:**
- Modify: `api/db/sqlite.js`（テーブル追加）
- Modify: `api/routes/auth.js`（エンドポイント追加）
- Test: `api/tests/password-reset.test.js`

**Interfaces:**
- Consumes: `sendPasswordResetEmail(to, resetUrl)`（Task 1）
- Produces: `password_reset_tokens`テーブル（列: `id`, `user_id`, `token_hash`, `expires_at`, `used_at`, `created_at`）。Task 3が同テーブルを検索する

- [ ] **Step 1: スキーマを追加**

`api/db/sqlite.js`の`db.exec(...)`ブロック内、`devices`テーブルの後に追加:
```sql

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
```

- [ ] **Step 2: 失敗するテストを書く**

`api/tests/password-reset.test.js`:
```js
process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'

const mockSendPasswordResetEmail = jest.fn().mockResolvedValue(undefined)
jest.mock('../lib/email', () => ({
  sendPasswordResetEmail: mockSendPasswordResetEmail,
}))

const request = require('supertest')
const app = require('../server')
const db = require('../db/sqlite')

describe('POST /api/auth/request-password-reset', () => {
  beforeAll(async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'reset-target@example.com', password: 'password123' })
  })

  afterEach(() => {
    mockSendPasswordResetEmail.mockClear()
  })

  it('登録済みメールならトークンを発行しメールを送信する', async () => {
    const res = await request(app)
      .post('/api/auth/request-password-reset')
      .send({ email: 'reset-target@example.com' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockSendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(mockSendPasswordResetEmail.mock.calls[0][0]).toBe('reset-target@example.com')

    const row = db.prepare('SELECT * FROM password_reset_tokens ORDER BY id DESC LIMIT 1').get()
    expect(row).toBeTruthy()
    expect(row.used_at).toBeNull()
  })

  it('未登録メールでも同じ成功レスポンスを返し、メールは送らない', async () => {
    const res = await request(app)
      .post('/api/auth/request-password-reset')
      .send({ email: 'no-such-user@example.com' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('メールアドレスが空なら400', async () => {
    const res = await request(app)
      .post('/api/auth/request-password-reset')
      .send({})

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2b: テストが失敗することを確認**

Run: `cd api && npx jest tests/password-reset.test.js -v`
Expected: FAIL — `404`（ルート未定義）またはテーブル無しエラー

- [ ] **Step 3: エンドポイントを実装する**

`api/routes/auth.js`の先頭のrequireに追加:
```js
const crypto = require('crypto')
const { sendPasswordResetEmail } = require('../lib/email')
```

`module.exports = router`の直前に追加:
```js
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000 // 1時間

router.post('/request-password-reset', async (req, res) => {
  const { email } = req.body

  if (!email) {
    return res.status(400).json({ error: 'メールアドレスが必要です' })
  }

  const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email)

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS).toISOString()

    db.prepare(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
    ).run(user.id, tokenHash, expiresAt)

    const resetUrl = `https://lms.waiteu.dev/reset-password.html?token=${rawToken}`

    try {
      await sendPasswordResetEmail(user.email, resetUrl)
    } catch (err) {
      console.error('パスワード再設定メールの送信に失敗:', err.message)
    }
  }

  return res.json({ ok: true })
})
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd api && npx jest tests/password-reset.test.js -v`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add api/db/sqlite.js api/routes/auth.js api/tests/password-reset.test.js
git commit -m "feat(api): add password reset token schema and request endpoint"
```

---

### Task 3: パスワード再設定確定（`POST /api/auth/reset-password`）

**Files:**
- Modify: `api/routes/auth.js`
- Modify: `api/tests/password-reset.test.js`（テスト追加）

**Interfaces:**
- Consumes: `password_reset_tokens`テーブル（Task 2）
- Produces: なし（最終エンドポイント）

- [ ] **Step 1: 失敗するテストを追加**

`api/tests/password-reset.test.js`の末尾（`describe('POST /api/auth/request-password-reset', ...)`ブロックの後）に追加:
```js
describe('POST /api/auth/reset-password', () => {
  let userId
  let rawToken
  let tokenHash

  beforeEach(() => {
    const result = db.prepare(
      "INSERT INTO users (email, password_hash) VALUES ('reset-confirm@example.com', 'old-hash')"
    ).run()
    userId = result.lastInsertRowid

    rawToken = 'a'.repeat(64)
    tokenHash = require('crypto').createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    db.prepare(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
    ).run(userId, tokenHash, expiresAt)
  })

  afterEach(() => {
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  })

  it('有効なトークンで新しいパスワードに更新できる', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'newpassword123' })

    expect(res.status).toBe(200)

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset-confirm@example.com', password: 'newpassword123' })
    expect(loginRes.status).toBe(200)

    const tokenRow = db.prepare('SELECT used_at FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash)
    expect(tokenRow.used_at).not.toBeNull()
  })

  it('同じトークンを2回使うと2回目は400', async () => {
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'newpassword123' })

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'anotherpassword' })

    expect(res.status).toBe(400)
  })

  it('存在しないトークンは400', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'b'.repeat(64), newPassword: 'newpassword123' })

    expect(res.status).toBe(400)
  })

  it('8文字未満のパスワードは400', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword: 'short' })

    expect(res.status).toBe(400)
  })

  it('期限切れトークンは400', async () => {
    const expiredToken = 'c'.repeat(64)
    const expiredHash = require('crypto').createHash('sha256').update(expiredToken).digest('hex')
    const pastDate = new Date(Date.now() - 1000).toISOString()
    db.prepare(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
    ).run(userId, expiredHash, pastDate)

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: expiredToken, newPassword: 'newpassword123' })

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 1b: テストが失敗することを確認**

Run: `cd api && npx jest tests/password-reset.test.js -v`
Expected: FAIL — `404`（ルート未定義）

- [ ] **Step 2: エンドポイントを実装する**

`api/routes/auth.js`の`request-password-reset`エンドポイントの直後に追加:
```js
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body

  if (!token || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'トークンと8文字以上の新しいパスワードが必要です' })
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

  const tokenRow = db.prepare(
    `SELECT * FROM password_reset_tokens
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`
  ).get(tokenHash)

  if (!tokenRow) {
    return res.status(400).json({ error: 'トークンが無効か期限切れです' })
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)

  const updatePassword = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, tokenRow.user_id)
    db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(tokenRow.id)
  })
  updatePassword()

  return res.json({ ok: true })
})
```

- [ ] **Step 3: テストが通ることを確認**

Run: `cd api && npx jest tests/password-reset.test.js -v`
Expected: PASS（8 tests: request-password-reset 3件 + reset-password 5件）

- [ ] **Step 4: 全テストスイートを実行**

Run: `cd api && npx jest -v`
Expected: PASS（全スイート、既存分含む）

- [ ] **Step 5: コミット**

```bash
git add api/routes/auth.js api/tests/password-reset.test.js
git commit -m "feat(api): add reset-password endpoint"
```

---

### Task 4: CORS修正 + checkout-successページの文言修正

**Files:**
- Modify: `api/server.js`

**Interfaces:** なし（他タスクに依存しない独立した修正）

- [ ] **Step 1: CORS許可オリジンに追加**

`api/server.js`の`cors({ origin: [...] })`を変更:
```js
app.use(cors({
  origin: [
    'https://api.waiteu.dev',
    'https://lms.waiteu.dev',
    /^chrome-extension:\/\//,
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
```

- [ ] **Step 2: `/checkout-success`の文言を更新**

`api/server.js`の`/checkout-success`ルートを変更:
```js
app.get("/checkout-success", (_req, res) => { res.send('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>決済完了</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0fdf4}div{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:420px}h1{color:#16a34a;margin-bottom:8px}p{color:#6b7280;font-size:14px;line-height:1.6}a.btn{display:inline-block;margin-top:16px;padding:10px 24px;background:#2563eb;color:#fff;border-radius:999px;text-decoration:none;font-weight:700;font-size:13px}</style></head><body><div><h1>✓ 決済が完了しました</h1><p>Chrome拡張機能「LETUS Task Watcher」をインストールし、登録したメールアドレスでログインしてください。<br>すでにインストール済みの場合は、拡張機能を開き直すとプレミアム機能が使えるようになります。</p><a class="btn" href="https://chromewebstore.google.com/detail/letus-task-watcher/eofgkmpiadoeckkliialkddacidcinml" target="_blank" rel="noopener">拡張機能をインストール</a></div></body></html>') })
```

（URLは`landing/index.html`に既に記載されている実際のChrome Web Store掲載URLと同一のもの）

- [ ] **Step 3: 動作確認（サーバー起動して手動確認）**

Run:
```bash
cd api && JWT_SECRET=test-secret-min-32-chars-xxxxxxxxxx DB_PATH=:memory: node -e "
const app = require('./server')
const server = app.listen(3999, async () => {
  const res = await fetch('http://localhost:3999/checkout-success')
  const html = await res.text()
  console.log('contains install link:', html.includes('chromewebstore.google.com'))
  server.close()
})
"
```
Expected: `contains install link: true`

- [ ] **Step 4: コミット**

```bash
git add api/server.js
git commit -m "fix(api): allow lms.waiteu.dev CORS origin, update checkout-success copy for pre-install signups"
```

---

### Task 5: `landing/register.html`

**Files:**
- Create: `landing/register.html`

**Interfaces:**
- Consumes: `POST https://api.waiteu.dev/api/auth/register`、`POST https://api.waiteu.dev/api/subscription/checkout`（Authorizationヘッダーに`Bearer <token>`）

- [ ] **Step 1: ページを作成する**

`landing/register.html`:
```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>アカウント登録 — LETUS Task Watcher</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --accent: #6366f1; --text-dark: #0f172a; --text-mid: #475569; --border: #e2e8f0; --bg-pale: #eef2ff; --border-pale: #e0e7ff; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text-dark); background: #fff; line-height: 1.6; font-size: 16px; }
    header { background: #fff; border-bottom: 1px solid var(--border); padding: 14px 20px; }
    header .inner { max-width: 480px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; }
    .logo { font-size: 1rem; font-weight: 900; color: var(--text-dark); text-decoration: none; }
    .back-link { font-size: 0.85rem; color: var(--accent); text-decoration: none; }
    main { max-width: 480px; margin: 0 auto; padding: 48px 20px 80px; }
    h1 { font-size: 1.5rem; font-weight: 950; margin-bottom: 8px; }
    .sub { font-size: 0.9rem; color: var(--text-mid); margin-bottom: 28px; }
    label { display: block; font-size: 0.85rem; font-weight: 700; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; font-size: 0.95rem; margin-bottom: 16px; }
    input:focus { outline: none; border-color: var(--accent); }
    button { width: 100%; padding: 12px; background: var(--accent); color: #fff; border: none; border-radius: 999px; font-size: 0.95rem; font-weight: 800; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .error { background: #fef2f2; color: #dc2626; border-radius: 10px; padding: 10px 14px; font-size: 0.85rem; margin-bottom: 16px; }
    .hint { font-size: 0.85rem; color: var(--text-mid); margin-top: 16px; text-align: center; }
    .hint a { color: var(--accent); }
    footer { background: #0f172a; color: rgba(255,255,255,0.55); text-align: center; padding: 20px; font-size: 0.82rem; }
    footer a { color: rgba(255,255,255,0.75); }
  </style>
</head>
<body>
<header>
  <div class="inner">
    <a href="index.html" class="logo">LETUS Task Watcher</a>
    <a href="index.html" class="back-link">← トップページへ</a>
  </div>
</header>
<main>
  <h1>アカウント登録</h1>
  <p class="sub">登録後、Stripeの決済ページへ移動します。決済完了後にChrome拡張機能をインストールしてご利用ください。</p>

  <form id="register-form">
    <label for="email">メールアドレス</label>
    <input id="email" type="email" required autocomplete="email">

    <label for="password">パスワード（8文字以上）</label>
    <input id="password" type="password" required minlength="8" autocomplete="new-password">

    <div id="error" class="error" style="display:none;"></div>

    <button id="submit-btn" type="submit">登録してStripeへ進む →</button>
  </form>

  <p class="hint">
    既にアカウントをお持ちの方で、パスワードをお忘れの場合は
    <a href="forgot-password.html">こちら</a>
  </p>
</main>
<footer>
  <a href="index.html">トップページ</a>
  <p style="margin-top:8px;">© 2026 LETUS Task Watcher</p>
</footer>
<script>
  const API_BASE_URL = 'https://api.waiteu.dev'
  const form = document.getElementById('register-form')
  const errorEl = document.getElementById('error')
  const submitBtn = document.getElementById('submit-btn')

  function showError(message) {
    errorEl.textContent = message
    errorEl.style.display = 'block'
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    errorEl.style.display = 'none'
    submitBtn.disabled = true
    submitBtn.textContent = '処理中...'

    const email = document.getElementById('email').value
    const password = document.getElementById('password').value

    try {
      const regRes = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const regData = await regRes.json()

      if (!regRes.ok) {
        if (regRes.status === 409) {
          showError('このメールアドレスは登録済みです。パスワードをお忘れの場合は下のリンクからどうぞ。')
        } else {
          showError(regData.error || 'エラーが発生しました')
        }
        return
      }

      const checkRes = await fetch(`${API_BASE_URL}/api/subscription/checkout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${regData.token}` },
      })
      const checkData = await checkRes.json()

      if (!checkRes.ok || !checkData.url) {
        showError(checkData.error || 'チェックアウトの開始に失敗しました（登録は完了しています）')
        return
      }

      window.location.href = checkData.url
    } catch {
      showError('サーバーに接続できませんでした')
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = '登録してStripeへ進む →'
    }
  })
</script>
</body>
</html>
```

- [ ] **Step 2: ブラウザで手動確認**

`landing/register.html`をブラウザで開き（`file://`で直接、またはローカルサーバー経由）、以下を確認する:
- メール・パスワード未入力で送信するとブラウザ標準のバリデーションで止まる
- 実際にテストメールで登録するとStripeのチェックアウトページへリダイレクトされる（api.waiteu.devが到達可能な環境で確認）
- 同じメールで再度登録すると「登録済みです」エラーが表示される

- [ ] **Step 3: コミット**

```bash
git add landing/register.html
git commit -m "feat(landing): add pre-install registration + checkout page"
```

---

### Task 6: `landing/forgot-password.html`

**Files:**
- Create: `landing/forgot-password.html`

**Interfaces:**
- Consumes: `POST https://api.waiteu.dev/api/auth/request-password-reset`

- [ ] **Step 1: ページを作成する**

`landing/forgot-password.html`（Task 5の`<head>`スタイルブロックと同一の`<style>`を使う）:
```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>パスワード再設定 — LETUS Task Watcher</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --accent: #6366f1; --text-dark: #0f172a; --text-mid: #475569; --border: #e2e8f0; --bg-pale: #eef2ff; --border-pale: #e0e7ff; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text-dark); background: #fff; line-height: 1.6; font-size: 16px; }
    header { background: #fff; border-bottom: 1px solid var(--border); padding: 14px 20px; }
    header .inner { max-width: 480px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; }
    .logo { font-size: 1rem; font-weight: 900; color: var(--text-dark); text-decoration: none; }
    .back-link { font-size: 0.85rem; color: var(--accent); text-decoration: none; }
    main { max-width: 480px; margin: 0 auto; padding: 48px 20px 80px; }
    h1 { font-size: 1.5rem; font-weight: 950; margin-bottom: 8px; }
    .sub { font-size: 0.9rem; color: var(--text-mid); margin-bottom: 28px; }
    label { display: block; font-size: 0.85rem; font-weight: 700; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; font-size: 0.95rem; margin-bottom: 16px; }
    input:focus { outline: none; border-color: var(--accent); }
    button { width: 100%; padding: 12px; background: var(--accent); color: #fff; border: none; border-radius: 999px; font-size: 0.95rem; font-weight: 800; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .success { background: var(--bg-pale); color: var(--text-dark); border: 1px solid var(--border-pale); border-radius: 10px; padding: 14px; font-size: 0.9rem; }
    footer { background: #0f172a; color: rgba(255,255,255,0.55); text-align: center; padding: 20px; font-size: 0.82rem; }
    footer a { color: rgba(255,255,255,0.75); }
  </style>
</head>
<body>
<header>
  <div class="inner">
    <a href="index.html" class="logo">LETUS Task Watcher</a>
    <a href="register.html" class="back-link">← 登録ページへ</a>
  </div>
</header>
<main>
  <h1>パスワード再設定</h1>
  <p class="sub">登録済みのメールアドレスを入力してください。再設定用のリンクをお送りします。</p>

  <form id="forgot-form">
    <label for="email">メールアドレス</label>
    <input id="email" type="email" required autocomplete="email">
    <button id="submit-btn" type="submit">再設定メールを送る</button>
  </form>

  <div id="success" class="success" style="display:none;">
    メールアドレス宛に再設定用のリンクを送信しました（該当するアカウントが存在する場合）。メールをご確認ください。
  </div>
</main>
<footer>
  <a href="index.html">トップページ</a>
  <p style="margin-top:8px;">© 2026 LETUS Task Watcher</p>
</footer>
<script>
  const API_BASE_URL = 'https://api.waiteu.dev'
  const form = document.getElementById('forgot-form')
  const submitBtn = document.getElementById('submit-btn')
  const successEl = document.getElementById('success')

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    submitBtn.disabled = true
    submitBtn.textContent = '送信中...'

    const email = document.getElementById('email').value

    try {
      await fetch(`${API_BASE_URL}/api/auth/request-password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch {
      // ネットワークエラーでも同じ成功メッセージを表示する（メール列挙対策と同じ理由でエラー内容は出し分けない）
    } finally {
      form.style.display = 'none'
      successEl.style.display = 'block'
    }
  })
</script>
</body>
</html>
```

- [ ] **Step 2: ブラウザで手動確認**

`api.waiteu.dev`が到達可能な環境でメールアドレスを入力・送信し、実際にパスワード再設定メールが届くことを確認する。存在しないメールアドレスでも同じ成功メッセージが表示されることを確認する。

- [ ] **Step 3: コミット**

```bash
git add landing/forgot-password.html
git commit -m "feat(landing): add forgot-password request page"
```

---

### Task 7: `landing/reset-password.html`

**Files:**
- Create: `landing/reset-password.html`

**Interfaces:**
- Consumes: `POST https://api.waiteu.dev/api/auth/reset-password`、URLクエリパラメータ`token`

- [ ] **Step 1: ページを作成する**

`landing/reset-password.html`（Task 6と同じ`<style>`ブロックを使う。タイトルとmain内のみ差し替え）:
```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>新しいパスワードの設定 — LETUS Task Watcher</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --accent: #6366f1; --text-dark: #0f172a; --text-mid: #475569; --border: #e2e8f0; --bg-pale: #eef2ff; --border-pale: #e0e7ff; }
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text-dark); background: #fff; line-height: 1.6; font-size: 16px; }
    header { background: #fff; border-bottom: 1px solid var(--border); padding: 14px 20px; }
    header .inner { max-width: 480px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; }
    .logo { font-size: 1rem; font-weight: 900; color: var(--text-dark); text-decoration: none; }
    main { max-width: 480px; margin: 0 auto; padding: 48px 20px 80px; }
    h1 { font-size: 1.5rem; font-weight: 950; margin-bottom: 8px; }
    .sub { font-size: 0.9rem; color: var(--text-mid); margin-bottom: 28px; }
    label { display: block; font-size: 0.85rem; font-weight: 700; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; border: 1.5px solid var(--border); border-radius: 10px; font-size: 0.95rem; margin-bottom: 16px; }
    input:focus { outline: none; border-color: var(--accent); }
    button { width: 100%; padding: 12px; background: var(--accent); color: #fff; border: none; border-radius: 999px; font-size: 0.95rem; font-weight: 800; cursor: pointer; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .error { background: #fef2f2; color: #dc2626; border-radius: 10px; padding: 10px 14px; font-size: 0.85rem; margin-bottom: 16px; }
    .success { background: var(--bg-pale); color: var(--text-dark); border: 1px solid var(--border-pale); border-radius: 10px; padding: 14px; font-size: 0.9rem; }
    .success a { color: var(--accent); }
    footer { background: #0f172a; color: rgba(255,255,255,0.55); text-align: center; padding: 20px; font-size: 0.82rem; }
    footer a { color: rgba(255,255,255,0.75); }
  </style>
</head>
<body>
<header>
  <div class="inner">
    <a href="index.html" class="logo">LETUS Task Watcher</a>
  </div>
</header>
<main>
  <h1>新しいパスワードの設定</h1>
  <p class="sub" id="sub-text">新しいパスワードを入力してください。</p>

  <form id="reset-form">
    <label for="password">新しいパスワード（8文字以上）</label>
    <input id="password" type="password" required minlength="8" autocomplete="new-password">

    <div id="error" class="error" style="display:none;"></div>

    <button id="submit-btn" type="submit">パスワードを更新</button>
  </form>

  <div id="success" class="success" style="display:none;">
    パスワードを更新しました。Chrome拡張機能から新しいパスワードでログインしてください。
  </div>
</main>
<footer>
  <a href="index.html">トップページ</a>
  <p style="margin-top:8px;">© 2026 LETUS Task Watcher</p>
</footer>
<script>
  const API_BASE_URL = 'https://api.waiteu.dev'
  const form = document.getElementById('reset-form')
  const errorEl = document.getElementById('error')
  const successEl = document.getElementById('success')
  const submitBtn = document.getElementById('submit-btn')

  const token = new URLSearchParams(window.location.search).get('token')

  if (!token) {
    document.getElementById('sub-text').textContent = 'リンクが無効です。もう一度パスワード再設定をリクエストしてください。'
    form.style.display = 'none'
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    errorEl.style.display = 'none'
    submitBtn.disabled = true
    submitBtn.textContent = '処理中...'

    const newPassword = document.getElementById('password').value

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      const data = await res.json()

      if (!res.ok) {
        errorEl.textContent = data.error || 'エラーが発生しました'
        errorEl.style.display = 'block'
        return
      }

      form.style.display = 'none'
      successEl.style.display = 'block'
    } catch {
      errorEl.textContent = 'サーバーに接続できませんでした'
      errorEl.style.display = 'block'
    } finally {
      submitBtn.disabled = false
      submitBtn.textContent = 'パスワードを更新'
    }
  })
</script>
</body>
</html>
```

- [ ] **Step 2: ブラウザで手動確認**

Task 6で受信したメール内のリンク（`reset-password.html?token=...`）を実際に開き、新しいパスワードを設定できることを確認する。`token`パラメータなしで直接開くとフォームが表示されずエラーメッセージが出ることを確認する。同じトークンで2回目の送信をするとエラーが表示されることを確認する。

- [ ] **Step 3: コミット**

```bash
git add landing/reset-password.html
git commit -m "feat(landing): add reset-password confirmation page"
```

---

### Task 8: 拡張機能`LoginModal`にパスワード再設定リンクを追加

**Files:**
- Modify: `src/components/LoginModal.tsx`

**Interfaces:**
- Consumes: `POST ${apiBaseUrl}/api/auth/request-password-reset`（Task 2）

- [ ] **Step 1: `Mode`型に`'forgot'`を追加し、状態を用意する**

`src/components/LoginModal.tsx:11`を変更:
```tsx
type Mode = 'subscribe' | 'login' | 'forgot'
```

`useState`群（14-19行目付近）の後に追加:
```tsx
  const [forgotSent, setForgotSent] = useState(false)
```

- [ ] **Step 2: `handleSubmit`に`forgot`分岐を追加**

`src/components/LoginModal.tsx`の`handleSubmit`関数内、`if (mode === 'subscribe') { ... } else { ... }`を次のように変更（`else`を`else if (mode === 'login')`にし、`forgot`分岐を追加）:
```tsx
      if (mode === 'subscribe') {
        // 既存のsubscribe処理はそのまま
        // ...
      } else if (mode === 'login') {
        // 既存のlogin処理はそのまま
        // ...
      } else {
        const res = await fetch(`${apiBaseUrl}/api/auth/request-password-reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        // request-password-resetは常に200を返す仕様（メール列挙対策）なのでres.okのチェックのみ
        if (res.ok) {
          setForgotSent(true)
        } else {
          setError('サーバーに接続できませんでした')
        }
      }
```

（既存の`if`/`else`本体は変更しない。分岐条件だけ`mode === 'subscribe'`→`mode === 'login'`→`else`の3段に分ける）

- [ ] **Step 3: フォーム表示を`mode === 'forgot'`に対応させる**

`proModalTitle`・`proModalSubtitle`の三項演算子を変更:
```tsx
        <p className="proModalTitle">
          {mode === 'subscribe' ? 'LETUS Premium に登録' : mode === 'login' ? 'ログイン' : 'パスワード再設定'}
        </p>
        <p className="proModalSubtitle">
          {mode === 'subscribe'
            ? '登録後、Stripeの決済ページへ移動します。'
            : mode === 'login'
              ? 'アカウントにログインしてください。'
              : '登録済みのメールアドレスを入力してください。再設定用のリンクをお送りします。'}
        </p>
```

パスワード入力欄（`proModalField`のうち2つ目、138-147行目）を`mode !== 'forgot'`のときだけ表示するよう変更:
```tsx
          {mode !== 'forgot' && (
            <div className="proModalField">
              <label className="proModalLabel">パスワード（8文字以上）</label>
              <input
                className="proModalInput"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
          )}
```

送信ボタンのラベルを変更:
```tsx
          <button type="submit" className="proModalSubmitBtn" disabled={loading}>
            {loading
              ? '処理中...'
              : mode === 'subscribe'
                ? '登録してStripeへ進む →'
                : mode === 'login'
                  ? 'ログイン'
                  : '再設定メールを送る'}
          </button>
```

`proModalSwitch`の下（ログインモードのときのみ）に「パスワードをお忘れですか？」リンクを追加:
```tsx
        <p className="proModalSwitch">
          {mode === 'subscribe' ? (
            <>
              既にアカウントをお持ちの方は{' '}
              <button type="button" onClick={() => switchMode('login')}>ログイン</button>
            </>
          ) : mode === 'login' ? (
            <>
              アカウントをお持ちでない方は{' '}
              <button type="button" onClick={() => switchMode('subscribe')}>新規登録</button>
              <br />
              <button type="button" onClick={() => switchMode('forgot')}>パスワードをお忘れですか？</button>
            </>
          ) : (
            <button type="button" onClick={() => switchMode('login')}>ログイン画面に戻る</button>
          )}
        </p>
```

- [ ] **Step 4: 送信済み画面を追加する**

`if (checkoutOpened) { ... }`ブロックの直後に追加:
```tsx
  if (forgotSent) {
    return (
      <div className="proModal">
        <div className="proModalCard">
          <p className="proModalTitle">メールを送信しました</p>
          <p className="proModalSubtitle">
            該当するアカウントが存在する場合、パスワード再設定用のリンクをお送りしました。メールをご確認ください。
          </p>
          <button type="button" className="proModalSubmitBtn" style={{ marginTop: '16px' }} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    )
  }
```

- [ ] **Step 5: 型チェック**

Run: `pnpm tsc -b`
Expected: エラーなし

- [ ] **Step 6: ビルド**

Run: `pnpm build`
Expected: `✓ built in` で成功

- [ ] **Step 7: ブラウザで手動確認**

拡張機能をビルド・読み込み直し、ログインモーダルで「ログイン」→「パスワードをお忘れですか？」→メールアドレス入力→送信、で「メールを送信しました」画面が表示されることを確認する。

- [ ] **Step 8: コミット**

```bash
git add src/components/LoginModal.tsx
git commit -m "feat(ext): add forgot-password mode to LoginModal"
```

---

## 完了条件

- Task 1〜8の全チェックボックスが完了
- `cd api && npx jest`が全件成功
- `pnpm tsc -b`・`pnpm build`が成功
- Webサイトから新規登録→Stripeチェックアウト→パスワード再設定メール受信→新パスワード設定→ログイン、の一連が実機で確認できる
- 拡張機能のログインモーダルからパスワード再設定をリクエストできる
