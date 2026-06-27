# サブスクリプション フェーズ2 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LETUS Task Watcher に月額サブスクリプション基盤を追加し、課題メモ・優先度・テーマ変更・バッジの4つのプレミアム機能を提供する。

**Architecture:** ラズパイ4上のNode.js APIサーバー（Express + SQLite + Stripe）をCloudflare Tunnel経由で公開し、Chrome拡張機能からJWT認証で接続する。プレミアムデータはchrome.storage.localにローカルファーストで保存し、サーバーにバックグラウンド同期する。サブスク状態は最大10日間のグレース期間付きでキャッシュし、サーバー障害時もサブスクライバーの機能を維持する。

**Tech Stack:**
- Backend: Node.js LTS, Express 4, better-sqlite3, jsonwebtoken, bcrypt, stripe, jest, supertest
- Extension: React 19 + TypeScript, Vite, chrome.storage.local, vitest（既存）

## Global Constraints

- background.js はバニラJSのまま維持する（TypeScript化しない）
- 無料機能はログイン不要のまま維持する（既存の動作を一切壊さない）
- chrome.storage.local への書き込みはすべて既存の storage.ts パターンに倣う
- JWTの有効期限は30日
- サブスク状態キャッシュの有効期限は7日、グレース期間は追加3日（合計10日）
- APIサーバーのポートはデフォルト3000
- Stripeのwebhookはraw bodyで受け取る（JSONパース前）
- フェーズ3用のエンドポイントは口だけ用意し、実装はしない

---

## ファイルマップ

### 新規作成（バックエンド）

```
api/
├── package.json
├── .env.example
├── server.js               # Expressアプリ + ルート登録
├── db/
│   └── sqlite.js           # DB接続・スキーマ初期化
├── middleware/
│   └── auth.js             # JWT検証ミドルウェア
└── routes/
    ├── auth.js             # POST /api/auth/register, /login, /refresh
    ├── subscription.js     # GET /api/subscription/status
    ├── user.js             # GET/POST /api/user/data, GET/POST /api/user/settings
    ├── webhook.js          # POST /api/webhook/stripe
    └── device.js           # POST /api/device/register（スタブのみ）
```

### 新規作成（拡張機能）

```
src/
├── core/
│   ├── auth.ts             # JWTトークン・サブスク状態の読み書き・グレース判定
│   └── premium.ts          # メモ・優先度・テーマのローカル保存・サーバー同期
└── components/
    ├── LoginModal.tsx       # メール+パスワードのログインフォーム
    ├── PremiumGate.tsx      # 未ログイン/未サブスク/有効の3状態を出し分け
    ├── AssignmentMemo.tsx   # 優先度・メモの入力UI
    └── SubscriberBadge.tsx  # サブスクライバーバッジ
```

### 変更（拡張機能）

```
src/
├── App.tsx                 # テーマ適用・バッジ表示・メモUI組み込み
└── App.css                 # テーマCSSカスタムプロパティ追加
public/
└── manifest.json           # host_permissions にAPIドメインを追加
```

---

## Part A: バックエンド

---

### Task 1: バックエンドプロジェクトセットアップ + DBスキーマ

**Files:**
- Create: `api/package.json`
- Create: `api/.env.example`
- Create: `api/db/sqlite.js`
- Create: `api/server.js`
- Test: （手動: `node api/server.js` でサーバー起動確認）

**Interfaces:**
- Produces: `db` オブジェクト（`api/db/sqlite.js` からエクスポート）— `db.prepare(sql).run(params)` / `.get(params)` / `.all(params)` で使う better-sqlite3 インスタンス

- [ ] **Step 1: api/ディレクトリに移動してnpmプロジェクトを初期化する**

```bash
mkdir api && cd api
npm init -y
npm install express better-sqlite3 jsonwebtoken bcrypt stripe cors helmet dotenv
npm install --save-dev jest supertest
```

- [ ] **Step 2: `.env.example` を作成する**

`api/.env.example`:
```
PORT=3000
JWT_SECRET=your-random-secret-here-min-32-chars
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
API_BASE_URL=https://your-domain.com
```

- [ ] **Step 3: `.env` を作成し、`.gitignore` に追加する**

```bash
cp .env.example .env
echo ".env" >> .gitignore
echo "node_modules/" >> .gitignore
echo "data/" >> .gitignore
```

`.env` に実際の値を設定する（JWT_SECRET は `openssl rand -hex 32` で生成）。

- [ ] **Step 4: `api/db/sqlite.js` を作成する**

```js
const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db')

const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    status TEXT NOT NULL DEFAULT 'inactive',
    current_period_end TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    assignment_id TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    memo TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, assignment_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    theme TEXT NOT NULL DEFAULT 'default',
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    push_token TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`)

module.exports = db
```

- [ ] **Step 5: `api/server.js` を作成する**

```js
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')

const authRoutes = require('./routes/auth')
const subscriptionRoutes = require('./routes/subscription')
const userRoutes = require('./routes/user')
const webhookRoutes = require('./routes/webhook')
const deviceRoutes = require('./routes/device')

const app = express()

// Stripe webhookはraw bodyが必要なので先に登録
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRoutes)

app.use(helmet())
app.use(cors())
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/subscription', subscriptionRoutes)
app.use('/api/user', userRoutes)
app.use('/api/device', deviceRoutes)

app.get('/health', (_req, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 3000

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

module.exports = app
```

- [ ] **Step 6: `data/` ディレクトリを作成してサーバーを起動確認する**

```bash
mkdir -p data
node server.js
```

期待される出力: `Server running on port 3000`

別ターミナルで確認:
```bash
curl http://localhost:3000/health
```
期待される出力: `{"ok":true}`

- [ ] **Step 7: コミットする**

```bash
cd ..
git add api/
git commit -m "feat(api): setup Node.js backend with SQLite schema"
```

---

### Task 2: 認証ルート（登録・ログイン・トークンリフレッシュ）

**Files:**
- Create: `api/routes/auth.js`
- Create: `api/middleware/auth.js`
- Test: `api/tests/auth.test.js`

**Interfaces:**
- Consumes: `db` from `api/db/sqlite.js`
- Produces:
  - `POST /api/auth/register` → `{ token: string, expiresAt: string }`
  - `POST /api/auth/login` → `{ token: string, expiresAt: string }`
  - `POST /api/auth/refresh` → `{ token: string, expiresAt: string }`
  - middleware `requireAuth(req, res, next)` → `req.userId: number` をセット

- [ ] **Step 1: テストファイルを作成する**

`api/tests/auth.test.js`:
```js
const request = require('supertest')
const app = require('../server')

process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'

describe('POST /api/auth/register', () => {
  it('メールとパスワードで登録できる', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'password123' })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('token')
    expect(res.body).toHaveProperty('expiresAt')
  })

  it('同じメールで2回登録するとエラーになる', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'password123' })
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'dup@example.com', password: 'password123' })
    expect(res.status).toBe(409)
  })
})

describe('POST /api/auth/login', () => {
  beforeAll(async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'login@example.com', password: 'correct' })
  })

  it('正しいパスワードでログインできる', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'correct' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
  })

  it('間違ったパスワードでは401になる', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'wrong' })
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd api
npx jest tests/auth.test.js
```

期待される出力: `FAIL` — `routes/auth` が存在しない

- [ ] **Step 3: `api/routes/auth.js` を実装する**

```js
const express = require('express')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('../db/sqlite')

const router = express.Router()
const SALT_ROUNDS = 10
const TOKEN_EXPIRY_DAYS = 30

function generateToken(userId, email) {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS)

  const token = jwt.sign(
    { userId, email },
    process.env.JWT_SECRET,
    { expiresIn: `${TOKEN_EXPIRY_DAYS}d` }
  )

  return { token, expiresAt: expiresAt.toISOString() }
}

router.post('/register', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'メールアドレスとパスワード（8文字以上）が必要です' })
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)
    const result = db.prepare(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)'
    ).run(email, passwordHash)

    db.prepare(
      'INSERT INTO subscriptions (user_id) VALUES (?)'
    ).run(result.lastInsertRowid)

    const { token, expiresAt } = generateToken(result.lastInsertRowid, email)
    return res.status(201).json({ token, expiresAt })
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'このメールアドレスはすでに登録されています' })
    }
    console.error(err)
    return res.status(500).json({ error: 'サーバーエラーが発生しました' })
  }
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'メールアドレスとパスワードが必要です' })
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)

  if (!user) {
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' })
  }

  const match = await bcrypt.compare(password, user.password_hash)

  if (!match) {
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' })
  }

  const { token, expiresAt } = generateToken(user.id, user.email)
  return res.json({ token, expiresAt })
})

router.post('/refresh', (req, res) => {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'トークンが必要です' })
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true })
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(payload.userId)

    if (!user) {
      return res.status(401).json({ error: 'ユーザーが見つかりません' })
    }

    const { token: newToken, expiresAt } = generateToken(user.id, user.email)
    return res.json({ token: newToken, expiresAt })
  } catch {
    return res.status(401).json({ error: 'トークンが無効です' })
  }
})

module.exports = router
```

- [ ] **Step 4: `api/middleware/auth.js` を実装する**

```js
const jwt = require('jsonwebtoken')

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: '認証が必要です' })
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    req.userId = payload.userId
    next()
  } catch {
    return res.status(401).json({ error: 'トークンが無効または期限切れです' })
  }
}

module.exports = { requireAuth }
```

- [ ] **Step 5: テストを実行して通過を確認する**

```bash
npx jest tests/auth.test.js
```

期待される出力: `PASS` — 全テスト通過

- [ ] **Step 6: コミットする**

```bash
cd ..
git add api/routes/auth.js api/middleware/auth.js api/tests/auth.test.js
git commit -m "feat(api): add auth routes and JWT middleware"
```

---

### Task 3: サブスクリプション状態確認ルート

**Files:**
- Create: `api/routes/subscription.js`
- Modify: `api/tests/auth.test.js` → サブスクテストを追加

**Interfaces:**
- Consumes: `requireAuth` from `api/middleware/auth.js`, `db` from `api/db/sqlite.js`
- Produces:
  - `GET /api/subscription/status` → `{ status: 'active'|'inactive', currentPeriodEnd: string|null }`

- [ ] **Step 1: テストを追加する**

`api/tests/auth.test.js` の末尾に追加:
```js
describe('GET /api/subscription/status', () => {
  let token

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'sub@example.com', password: 'password123' })
    token = res.body.token
  })

  it('新規ユーザーのサブスク状態はinactiveになる', async () => {
    const res = await request(app)
      .get('/api/subscription/status')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('inactive')
    expect(res.body.currentPeriodEnd).toBeNull()
  })

  it('トークンなしでは401になる', async () => {
    const res = await request(app).get('/api/subscription/status')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd api && npx jest tests/auth.test.js -t "subscription/status"
```

期待される出力: `FAIL`

- [ ] **Step 3: `api/routes/subscription.js` を実装する**

```js
const express = require('express')
const db = require('../db/sqlite')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

router.get('/status', requireAuth, (req, res) => {
  const sub = db.prepare(
    'SELECT status, current_period_end FROM subscriptions WHERE user_id = ?'
  ).get(req.userId)

  if (!sub) {
    return res.status(404).json({ error: 'サブスクリプション情報が見つかりません' })
  }

  return res.json({
    status: sub.status,
    currentPeriodEnd: sub.current_period_end ?? null,
  })
})

module.exports = router
```

- [ ] **Step 4: `server.js` に登録されていることを確認する（Task 1で登録済み）**

`server.js` に `app.use('/api/subscription', subscriptionRoutes)` が存在することを確認する。

- [ ] **Step 5: テストを実行して通過を確認する**

```bash
npx jest tests/auth.test.js
```

期待される出力: `PASS`

- [ ] **Step 6: コミットする**

```bash
cd ..
git add api/routes/subscription.js api/tests/auth.test.js
git commit -m "feat(api): add subscription status route"
```

---

### Task 4: Stripe Webhook ルート

**Files:**
- Create: `api/routes/webhook.js`
- Create: `api/tests/webhook.test.js`

**Interfaces:**
- Consumes: `db` from `api/db/sqlite.js`, Stripe SDK
- Produces: `POST /api/webhook/stripe` — Stripeからのイベントを受信しDB更新

- [ ] **Step 1: テストファイルを作成する**

`api/tests/webhook.test.js`:
```js
const request = require('supertest')
const stripe = require('stripe')
const app = require('../server')
const db = require('../db/sqlite')

process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

// Stripeのwebhook署名検証をモックする
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: jest.fn()
    }
  }))
})

describe('POST /api/webhook/stripe', () => {
  let userId

  beforeAll(() => {
    const result = db.prepare(
      "INSERT INTO users (email, password_hash) VALUES ('hook@example.com', 'hash')"
    ).run()
    userId = result.lastInsertRowid
    db.prepare('INSERT INTO subscriptions (user_id, stripe_customer_id) VALUES (?, ?)').run(userId, 'cus_test')
  })

  it('customer.subscription.updated で status が active に更新される', async () => {
    const stripeInstance = new stripe()
    stripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          customer: 'cus_test',
          id: 'sub_test',
          status: 'active',
          current_period_end: 1800000000
        }
      }
    })

    const res = await request(app)
      .post('/api/webhook/stripe')
      .set('stripe-signature', 'test-sig')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)

    const sub = db.prepare('SELECT status FROM subscriptions WHERE user_id = ?').get(userId)
    expect(sub.status).toBe('active')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd api && npx jest tests/webhook.test.js
```

期待される出力: `FAIL`

- [ ] **Step 3: `api/routes/webhook.js` を実装する**

```js
const express = require('express')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const db = require('../db/sqlite')

const router = express.Router()

router.post('/stripe', (req, res) => {
  const sig = req.headers['stripe-signature']
  let event

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return res.status(400).json({ error: `Webhook Error: ${err.message}` })
  }

  const obj = event.data.object

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const periodEnd = new Date(obj.current_period_end * 1000).toISOString()
      db.prepare(`
        UPDATE subscriptions
        SET status = ?, stripe_subscription_id = ?, current_period_end = ?, updated_at = datetime('now')
        WHERE stripe_customer_id = ?
      `).run(obj.status === 'active' ? 'active' : 'inactive', obj.id, periodEnd, obj.customer)
      break
    }

    case 'customer.subscription.deleted': {
      db.prepare(`
        UPDATE subscriptions
        SET status = 'inactive', current_period_end = NULL, updated_at = datetime('now')
        WHERE stripe_customer_id = ?
      `).run(obj.customer)
      break
    }

    case 'checkout.session.completed': {
      if (obj.mode === 'subscription') {
        db.prepare(`
          UPDATE subscriptions
          SET stripe_customer_id = ?, updated_at = datetime('now')
          WHERE user_id = (
            SELECT id FROM users WHERE email = ?
          )
        `).run(obj.customer, obj.customer_email)
      }
      break
    }

    default:
      break
  }

  return res.json({ received: true })
})

module.exports = router
```

- [ ] **Step 4: テストを実行して通過を確認する**

```bash
npx jest tests/webhook.test.js
```

期待される出力: `PASS`

- [ ] **Step 5: コミットする**

```bash
cd ..
git add api/routes/webhook.js api/tests/webhook.test.js
git commit -m "feat(api): add Stripe webhook handler"
```

---

### Task 5: ユーザーデータルート（メモ・優先度・テーマ）

**Files:**
- Create: `api/routes/user.js`
- Create: `api/tests/user.test.js`

**Interfaces:**
- Consumes: `requireAuth`, `db`
- Produces:
  - `GET /api/user/data` → `{ data: Array<{ assignmentId, priority, memo, updatedAt }> }`
  - `POST /api/user/data` → `{ ok: true }` — body: `{ items: Array<{ assignmentId, priority, memo }> }`
  - `GET /api/user/settings` → `{ theme: string }`
  - `POST /api/user/settings` → `{ ok: true }` — body: `{ theme: string }`

- [ ] **Step 1: テストファイルを作成する**

`api/tests/user.test.js`:
```js
const request = require('supertest')
const app = require('../server')

process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'

let token

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: 'user@example.com', password: 'password123' })
  token = res.body.token
})

describe('POST /api/user/data', () => {
  it('メモと優先度を保存できる', async () => {
    const res = await request(app)
      .post('/api/user/data')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ assignmentId: 'assign-1', priority: 2, memo: 'テストメモ' }] })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('GET /api/user/data', () => {
  it('保存したメモを取得できる', async () => {
    await request(app)
      .post('/api/user/data')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ assignmentId: 'assign-2', priority: 1, memo: '確認済み' }] })

    const res = await request(app)
      .get('/api/user/data')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.some(d => d.assignmentId === 'assign-2')).toBe(true)
  })
})

describe('POST /api/user/settings', () => {
  it('テーマを保存できる', async () => {
    const res = await request(app)
      .post('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'dark' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('GET /api/user/settings', () => {
  it('保存したテーマを取得できる', async () => {
    await request(app)
      .post('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'dark' })

    const res = await request(app)
      .get('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.theme).toBe('dark')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
cd api && npx jest tests/user.test.js
```

期待される出力: `FAIL`

- [ ] **Step 3: `api/routes/user.js` を実装する**

```js
const express = require('express')
const db = require('../db/sqlite')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

router.get('/data', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT assignment_id as assignmentId, priority, memo, updated_at as updatedAt FROM user_data WHERE user_id = ?'
  ).all(req.userId)

  return res.json({ data: rows })
})

router.post('/data', requireAuth, (req, res) => {
  const { items } = req.body

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items は配列である必要があります' })
  }

  const upsert = db.prepare(`
    INSERT INTO user_data (user_id, assignment_id, priority, memo, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, assignment_id) DO UPDATE SET
      priority = excluded.priority,
      memo = excluded.memo,
      updated_at = excluded.updated_at
  `)

  const insertMany = db.transaction((rows) => {
    for (const item of rows) {
      upsert.run(req.userId, item.assignmentId, item.priority ?? 0, item.memo ?? '')
    }
  })

  insertMany(items)

  return res.json({ ok: true })
})

router.get('/settings', requireAuth, (req, res) => {
  const settings = db.prepare(
    'SELECT theme FROM user_settings WHERE user_id = ?'
  ).get(req.userId)

  return res.json({ theme: settings?.theme ?? 'default' })
})

router.post('/settings', requireAuth, (req, res) => {
  const { theme } = req.body

  if (!theme || typeof theme !== 'string') {
    return res.status(400).json({ error: 'theme が必要です' })
  }

  db.prepare(`
    INSERT INTO user_settings (user_id, theme, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      theme = excluded.theme,
      updated_at = excluded.updated_at
  `).run(req.userId, theme)

  return res.json({ ok: true })
})

module.exports = router
```

- [ ] **Step 4: テストを実行して通過を確認する**

```bash
npx jest tests/user.test.js
```

期待される出力: `PASS`

- [ ] **Step 5: コミットする**

```bash
cd ..
git add api/routes/user.js api/tests/user.test.js
git commit -m "feat(api): add user data and settings routes"
```

---

### Task 6: Stripe チェックアウト + デバイス stub + PM2 設定

**Files:**
- Modify: `api/routes/subscription.js` — チェックアウトセッション作成エンドポイントを追加
- Create: `api/routes/device.js`
- Create: `api/ecosystem.config.js`

**Interfaces:**
- Produces:
  - `POST /api/subscription/checkout` → `{ url: string }` — Stripeチェックアウト画面URL
  - `POST /api/device/register` → `{ ok: true }` — スタブ（Phase 3まで実装しない）

- [ ] **Step 1: `api/routes/subscription.js` にチェックアウトルートを追加する**

`api/routes/subscription.js` の `module.exports = router` の直前に追加:

```js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

router.post('/checkout', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.userId)

  if (!user) {
    return res.status(404).json({ error: 'ユーザーが見つかりません' })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${process.env.API_BASE_URL}/checkout-success`,
      cancel_url: `${process.env.API_BASE_URL}/checkout-cancel`,
    })

    return res.json({ url: session.url })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'チェックアウトセッションの作成に失敗しました' })
  }
})
```

また `.env.example` に追加:
```
STRIPE_PRICE_ID=price_...
```

- [ ] **Step 2: `api/routes/device.js` を作成する（Phase 3 スタブ）**

```js
const express = require('express')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// Phase 3: モバイルアプリのプッシュトークン登録（未実装）
router.post('/register', requireAuth, (_req, res) => {
  return res.status(501).json({ error: 'Phase 3 で実装予定です' })
})

module.exports = router
```

- [ ] **Step 3: PM2 設定ファイルを作成する**

`api/ecosystem.config.js`:
```js
module.exports = {
  apps: [
    {
      name: 'letus-api',
      script: 'server.js',
      cwd: '/home/pi/letus-api',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      watch: false,
      restart_delay: 5000,
      max_restarts: 10,
    },
  ],
}
```

- [ ] **Step 4: コミットする**

```bash
git add api/routes/subscription.js api/routes/device.js api/ecosystem.config.js api/.env.example
git commit -m "feat(api): add checkout route, device stub, PM2 config"
```

---

## Part B: Chrome拡張機能

---

### Task 7: 認証・サブスク状態ストレージ層

**Files:**
- Create: `src/core/auth.ts`
- Test: `src/core/auth.test.ts`

**Interfaces:**
- Produces:
  - `getAuthToken(): Promise<string | null>`
  - `saveAuthSession(token: string, expiresAt: string): Promise<void>`
  - `clearAuthSession(): Promise<void>`
  - `getSubscriptionState(): Promise<SubscriptionState>` — `'active' | 'grace' | 'inactive' | 'unknown'`
  - `saveSubscriptionCache(status: string, currentPeriodEnd: string | null): Promise<void>`
  - `isSubscriptionActive(): Promise<boolean>` — グレース期間を含めて判定

- [ ] **Step 1: テストファイルを作成する**

`src/core/auth.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// chrome.storage.local のモック
const store: Record<string, unknown> = {}
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string[]) => {
        const result: Record<string, unknown> = {}
        for (const k of keys) result[k] = store[k]
        return result
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(store, obj)
      }),
      remove: vi.fn(async (keys: string[]) => {
        for (const k of keys) delete store[k]
      }),
    },
  },
})

import {
  getAuthToken,
  saveAuthSession,
  clearAuthSession,
  isSubscriptionActive,
  saveSubscriptionCache,
} from './auth'

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
})

describe('getAuthToken', () => {
  it('トークンが未保存のときはnullを返す', async () => {
    expect(await getAuthToken()).toBeNull()
  })

  it('保存したトークンを返す', async () => {
    await saveAuthSession('my-token', new Date(Date.now() + 86400000).toISOString())
    expect(await getAuthToken()).toBe('my-token')
  })

  it('期限切れトークンはnullを返す', async () => {
    await saveAuthSession('expired', new Date(Date.now() - 1000).toISOString())
    expect(await getAuthToken()).toBeNull()
  })
})

describe('isSubscriptionActive', () => {
  it('キャッシュがない場合はfalseを返す', async () => {
    expect(await isSubscriptionActive()).toBe(false)
  })

  it('activeかつキャッシュ有効期間内はtrueを返す', async () => {
    const checkedAt = new Date(Date.now() - 1000).toISOString()
    await saveSubscriptionCache('active', null)
    store['subscriptionCheckedAt'] = checkedAt
    expect(await isSubscriptionActive()).toBe(true)
  })

  it('activeだがキャッシュが7日超過+グレース期間内はtrueを返す', async () => {
    const checkedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    store['subscriptionStatus'] = 'active'
    store['subscriptionCheckedAt'] = checkedAt
    store['subscriptionGraceUntil'] = new Date(Date.now() + 86400000).toISOString()
    expect(await isSubscriptionActive()).toBe(true)
  })

  it('グレース期間も超過した場合はfalseを返す', async () => {
    store['subscriptionStatus'] = 'active'
    store['subscriptionCheckedAt'] = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
    store['subscriptionGraceUntil'] = new Date(Date.now() - 1000).toISOString()
    expect(await isSubscriptionActive()).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
pnpm vitest run src/core/auth.test.ts
```

期待される出力: `FAIL`

- [ ] **Step 3: `src/core/auth.ts` を実装する**

```ts
const AUTH_TOKEN_KEY = 'authToken'
const AUTH_TOKEN_EXPIRES_AT_KEY = 'authTokenExpiresAt'
const SUBSCRIPTION_STATUS_KEY = 'subscriptionStatus'
const SUBSCRIPTION_CHECKED_AT_KEY = 'subscriptionCheckedAt'
const SUBSCRIPTION_GRACE_UNTIL_KEY = 'subscriptionGraceUntil'

const CACHE_VALID_MS = 7 * 24 * 60 * 60 * 1000   // 7日
const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000  // 追加3日

export async function getAuthToken(): Promise<string | null> {
  const result = await chrome.storage.local.get([AUTH_TOKEN_KEY, AUTH_TOKEN_EXPIRES_AT_KEY]) as {
    authToken?: string
    authTokenExpiresAt?: string
  }

  if (!result.authToken || !result.authTokenExpiresAt) {
    return null
  }

  if (new Date(result.authTokenExpiresAt).getTime() <= Date.now()) {
    return null
  }

  return result.authToken
}

export async function saveAuthSession(token: string, expiresAt: string): Promise<void> {
  await chrome.storage.local.set({
    [AUTH_TOKEN_KEY]: token,
    [AUTH_TOKEN_EXPIRES_AT_KEY]: expiresAt,
  })
}

export async function clearAuthSession(): Promise<void> {
  await chrome.storage.local.remove([
    AUTH_TOKEN_KEY,
    AUTH_TOKEN_EXPIRES_AT_KEY,
    SUBSCRIPTION_STATUS_KEY,
    SUBSCRIPTION_CHECKED_AT_KEY,
    SUBSCRIPTION_GRACE_UNTIL_KEY,
  ])
}

export async function saveSubscriptionCache(
  status: string,
  currentPeriodEnd: string | null,
): Promise<void> {
  const now = new Date()
  const graceUntil = new Date(now.getTime() + CACHE_VALID_MS + GRACE_PERIOD_MS)

  await chrome.storage.local.set({
    [SUBSCRIPTION_STATUS_KEY]: status,
    [SUBSCRIPTION_CHECKED_AT_KEY]: now.toISOString(),
    [SUBSCRIPTION_GRACE_UNTIL_KEY]: graceUntil.toISOString(),
    ...(currentPeriodEnd ? { subscriptionCurrentPeriodEnd: currentPeriodEnd } : {}),
  })
}

export type SubscriptionState = 'active' | 'grace' | 'inactive' | 'unknown'

export async function getSubscriptionState(): Promise<SubscriptionState> {
  const result = await chrome.storage.local.get([
    SUBSCRIPTION_STATUS_KEY,
    SUBSCRIPTION_CHECKED_AT_KEY,
    SUBSCRIPTION_GRACE_UNTIL_KEY,
  ]) as {
    subscriptionStatus?: string
    subscriptionCheckedAt?: string
    subscriptionGraceUntil?: string
  }

  if (!result.subscriptionStatus || !result.subscriptionCheckedAt) {
    return 'unknown'
  }

  if (result.subscriptionStatus !== 'active') {
    return 'inactive'
  }

  const checkedAt = new Date(result.subscriptionCheckedAt).getTime()
  const cacheAge = Date.now() - checkedAt

  if (cacheAge <= CACHE_VALID_MS) {
    return 'active'
  }

  if (
    result.subscriptionGraceUntil &&
    new Date(result.subscriptionGraceUntil).getTime() > Date.now()
  ) {
    return 'grace'
  }

  return 'inactive'
}

export async function isSubscriptionActive(): Promise<boolean> {
  const state = await getSubscriptionState()
  return state === 'active' || state === 'grace'
}
```

- [ ] **Step 4: テストを実行して通過を確認する**

```bash
pnpm vitest run src/core/auth.test.ts
```

期待される出力: `PASS`

- [ ] **Step 5: コミットする**

```bash
git add src/core/auth.ts src/core/auth.test.ts
git commit -m "feat(ext): add auth and subscription state storage layer"
```

---

### Task 8: プレミアムデータのローカルファースト保存と同期

**Files:**
- Create: `src/core/premium.ts`
- Test: `src/core/premium.test.ts`

**Interfaces:**
- Consumes: `getAuthToken` from `src/core/auth.ts`
- Produces:
  - `AssignmentMemo = { priority: 0|1|2|3, memo: string }`
  - `getMemo(assignmentId: string): Promise<AssignmentMemo>`
  - `saveMemo(assignmentId: string, memo: AssignmentMemo): Promise<void>`
  - `getTheme(): Promise<string>`
  - `saveTheme(theme: string): Promise<void>`
  - `syncToServer(apiBaseUrl: string): Promise<void>` — バックグラウンド同期（失敗時はサイレント）

- [ ] **Step 1: テストファイルを作成する**

`src/core/premium.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, unknown> = {}
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string[]) => {
        const result: Record<string, unknown> = {}
        for (const k of keys) result[k] = store[k]
        return result
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj) }),
    },
  },
})

import { getMemo, saveMemo, getTheme, saveTheme } from './premium'

beforeEach(() => { Object.keys(store).forEach((k) => delete store[k]) })

describe('getMemo', () => {
  it('未保存のassignmentIdはデフォルト値を返す', async () => {
    const memo = await getMemo('assign-999')
    expect(memo).toEqual({ priority: 0, memo: '' })
  })

  it('保存したメモを返す', async () => {
    await saveMemo('assign-1', { priority: 2, memo: '重要' })
    const memo = await getMemo('assign-1')
    expect(memo).toEqual({ priority: 2, memo: '重要' })
  })
})

describe('getTheme / saveTheme', () => {
  it('未保存はdefaultを返す', async () => {
    expect(await getTheme()).toBe('default')
  })

  it('保存したテーマを返す', async () => {
    await saveTheme('dark')
    expect(await getTheme()).toBe('dark')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
pnpm vitest run src/core/premium.test.ts
```

期待される出力: `FAIL`

- [ ] **Step 3: `src/core/premium.ts` を実装する**

```ts
import { getAuthToken } from './auth'

const ASSIGNMENT_MEMOS_KEY = 'assignmentMemos'
const ASSIGNMENT_MEMOS_SYNCED_AT_KEY = 'assignmentMemosSyncedAt'
const THEME_KEY = 'theme'

export type AssignmentMemo = {
  priority: 0 | 1 | 2 | 3
  memo: string
}

type MemosStorage = {
  assignmentMemos?: Record<string, AssignmentMemo>
}

export async function getMemo(assignmentId: string): Promise<AssignmentMemo> {
  const result = (await chrome.storage.local.get(ASSIGNMENT_MEMOS_KEY)) as MemosStorage
  return result.assignmentMemos?.[assignmentId] ?? { priority: 0, memo: '' }
}

export async function getAllMemos(): Promise<Record<string, AssignmentMemo>> {
  const result = (await chrome.storage.local.get(ASSIGNMENT_MEMOS_KEY)) as MemosStorage
  return result.assignmentMemos ?? {}
}

export async function saveMemo(assignmentId: string, memo: AssignmentMemo): Promise<void> {
  const current = await getAllMemos()
  await chrome.storage.local.set({
    [ASSIGNMENT_MEMOS_KEY]: { ...current, [assignmentId]: memo },
  })
}

export async function getTheme(): Promise<string> {
  const result = (await chrome.storage.local.get(THEME_KEY)) as { theme?: string }
  return result.theme ?? 'default'
}

export async function saveTheme(theme: string): Promise<void> {
  await chrome.storage.local.set({ [THEME_KEY]: theme })
  void syncToServer(import.meta.env.VITE_API_BASE_URL ?? '')
}

export async function syncToServer(apiBaseUrl: string): Promise<void> {
  if (!apiBaseUrl) return

  const token = await getAuthToken()
  if (!token) return

  try {
    const memos = await getAllMemos()
    const theme = await getTheme()

    const items = Object.entries(memos).map(([assignmentId, { priority, memo }]) => ({
      assignmentId,
      priority,
      memo,
    }))

    await Promise.all([
      fetch(`${apiBaseUrl}/api/user/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items }),
      }),
      fetch(`${apiBaseUrl}/api/user/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ theme }),
      }),
    ])

    await chrome.storage.local.set({ [ASSIGNMENT_MEMOS_SYNCED_AT_KEY]: new Date().toISOString() })
  } catch {
    // サーバー同期失敗はサイレントに扱う（ローカルデータは保持される）
  }
}
```

- [ ] **Step 4: `vite.config.ts` に環境変数を追加する**

`vite.config.ts` の `defineConfig` 内に確認: `define` または `.env` ファイルで `VITE_API_BASE_URL` を設定できるようにする。

`.env.example` を拡張機能ルートに作成:
```
VITE_API_BASE_URL=https://your-domain.com
```

- [ ] **Step 5: テストを実行して通過を確認する**

```bash
pnpm vitest run src/core/premium.test.ts
```

期待される出力: `PASS`

- [ ] **Step 6: コミットする**

```bash
git add src/core/premium.ts src/core/premium.test.ts .env.example
git commit -m "feat(ext): add premium data local-first storage and server sync"
```

---

### Task 9: PremiumGate コンポーネント

**Files:**
- Create: `src/components/PremiumGate.tsx`
- Create: `src/components/LoginModal.tsx`

**Interfaces:**
- Consumes: `getAuthToken`, `isSubscriptionActive`, `saveAuthSession`, `saveSubscriptionCache` from `src/core/auth.ts`
- Produces:
  - `<PremiumGate apiBaseUrl={string}>{children}</PremiumGate>` — 認証・サブスク状態に応じて children または案内UIを表示
  - `<LoginModal apiBaseUrl={string} onSuccess={() => void} onClose={() => void} />`

- [ ] **Step 1: `src/components/LoginModal.tsx` を作成する**

```tsx
import { useState } from 'react'
import { saveAuthSession } from '../core/auth'

type Props = {
  apiBaseUrl: string
  onSuccess: () => void
  onClose: () => void
}

type Mode = 'login' | 'register'

export function LoginModal({ apiBaseUrl, onSuccess, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const res = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json() as { token?: string; expiresAt?: string; error?: string }

      if (!res.ok) {
        setError(data.error ?? 'エラーが発生しました')
        return
      }

      if (data.token && data.expiresAt) {
        await saveAuthSession(data.token, data.expiresAt)
        onSuccess()
      }
    } catch {
      setError('サーバーに接続できませんでした')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modalOverlay">
      <div className="modalCard">
        <button type="button" className="modalClose" onClick={onClose}>×</button>
        <h2>{mode === 'login' ? 'ログイン' : '新規登録'}</h2>

        <form onSubmit={handleSubmit}>
          <label>
            メールアドレス
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            パスワード
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>

          {error && <p className="modalError">{error}</p>}

          <button type="submit" disabled={loading}>
            {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録する'}
          </button>
        </form>

        <button
          type="button"
          className="modeSwitchBtn"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? '新規登録はこちら' : 'ログインはこちら'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `src/components/PremiumGate.tsx` を作成する**

```tsx
import { useEffect, useState, type ReactNode } from 'react'
import {
  getAuthToken,
  isSubscriptionActive,
  getSubscriptionState,
  saveSubscriptionCache,
} from '../core/auth'
import { LoginModal } from './LoginModal'

type Props = {
  apiBaseUrl: string
  children: ReactNode
}

type GateState = 'loading' | 'no-login' | 'no-subscription' | 'grace' | 'active' | 'server-error'

export function PremiumGate({ apiBaseUrl, children }: Props) {
  const [state, setState] = useState<GateState>('loading')
  const [showLogin, setShowLogin] = useState(false)

  async function checkAccess() {
    setState('loading')

    const token = await getAuthToken()
    if (!token) {
      setState('no-login')
      return
    }

    // キャッシュが有効なら即時判定
    const subState = await getSubscriptionState()
    if (subState === 'active') {
      setState('active')
      return
    }
    if (subState === 'grace') {
      setState('grace')
      return
    }

    // サーバーに問い合わせ
    try {
      const res = await fetch(`${apiBaseUrl}/api/subscription/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        setState('no-subscription')
        return
      }

      const data = await res.json() as { status: string; currentPeriodEnd: string | null }
      await saveSubscriptionCache(data.status, data.currentPeriodEnd)

      setState(data.status === 'active' ? 'active' : 'no-subscription')
    } catch {
      // ネットワークエラー: キャッシュベースで判断
      const active = await isSubscriptionActive()
      setState(active ? 'grace' : 'server-error')
    }
  }

  useEffect(() => {
    void checkAccess()
  }, [])

  async function handleCheckout() {
    const token = await getAuthToken()
    if (!token) {
      setShowLogin(true)
      return
    }

    try {
      const res = await fetch(`${apiBaseUrl}/api/subscription/checkout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json() as { url?: string }
      if (data.url) {
        chrome.tabs.create({ url: data.url })
      }
    } catch {
      // サーバーエラー時は案内のみ
    }
  }

  if (state === 'loading') {
    return <div className="premiumLoading">確認中...</div>
  }

  if (state === 'no-login') {
    return (
      <div className="premiumGate">
        <p>この機能はサブスクライバー限定です。</p>
        <button type="button" onClick={() => setShowLogin(true)}>ログイン</button>
        {showLogin && (
          <LoginModal
            apiBaseUrl={apiBaseUrl}
            onSuccess={() => { setShowLogin(false); void checkAccess() }}
            onClose={() => setShowLogin(false)}
          />
        )}
      </div>
    )
  }

  if (state === 'no-subscription') {
    return (
      <div className="premiumGate">
        <p>この機能はサブスクライバー限定です。</p>
        <button type="button" onClick={handleCheckout}>サブスクを始める</button>
      </div>
    )
  }

  if (state === 'server-error') {
    return (
      <div className="premiumGate premiumGraceError">
        <p className="premiumGraceNote">サーバーに接続できません（キャッシュで動作中）</p>
      </div>
    )
  }

  return (
    <>
      {state === 'grace' && (
        <p className="premiumGraceNote">サーバーに接続できませんでした。データはキャッシュから表示しています。</p>
      )}
      {children}
    </>
  )
}
```

- [ ] **Step 3: コミットする**

```bash
git add src/components/LoginModal.tsx src/components/PremiumGate.tsx
git commit -m "feat(ext): add LoginModal and PremiumGate components"
```

---

### Task 10: 課題メモ・優先度UI

**Files:**
- Create: `src/components/AssignmentMemo.tsx`

**Interfaces:**
- Consumes: `getMemo`, `saveMemo`, `AssignmentMemo` from `src/core/premium.ts`
- Produces: `<AssignmentMemo assignmentId={string} apiBaseUrl={string} />`

- [ ] **Step 1: `src/components/AssignmentMemo.tsx` を作成する**

```tsx
import { useEffect, useState } from 'react'
import { getMemo, saveMemo, type AssignmentMemo as MemoData } from '../core/premium'
import { syncToServer } from '../core/premium'

type Props = {
  assignmentId: string
  apiBaseUrl: string
}

const PRIORITY_LABELS: Record<number, string> = {
  0: '優先度なし',
  1: '低',
  2: '中',
  3: '高',
}

export function AssignmentMemo({ assignmentId, apiBaseUrl }: Props) {
  const [memo, setMemo] = useState<MemoData>({ priority: 0, memo: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getMemo(assignmentId).then(setMemo)
  }, [assignmentId])

  async function handlePriorityChange(priority: 0 | 1 | 2 | 3) {
    const updated = { ...memo, priority }
    setMemo(updated)
    setSaving(true)
    await saveMemo(assignmentId, updated)
    void syncToServer(apiBaseUrl)
    setSaving(false)
  }

  async function handleMemoChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const updated = { ...memo, memo: e.target.value }
    setMemo(updated)
    await saveMemo(assignmentId, updated)
    void syncToServer(apiBaseUrl)
  }

  return (
    <div className="assignmentMemo">
      <div className="prioritySelector">
        {([0, 1, 2, 3] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`priorityBtn priority${p} ${memo.priority === p ? 'active' : ''}`}
            onClick={() => void handlePriorityChange(p)}
            title={PRIORITY_LABELS[p]}
          >
            {PRIORITY_LABELS[p]}
          </button>
        ))}
        {saving && <span className="savingIndicator">保存中…</span>}
      </div>

      <textarea
        className="memoInput"
        placeholder="メモを入力..."
        value={memo.memo}
        onChange={handleMemoChange}
        rows={3}
      />
    </div>
  )
}
```

- [ ] **Step 2: コミットする**

```bash
git add src/components/AssignmentMemo.tsx
git commit -m "feat(ext): add AssignmentMemo component with priority selector"
```

---

### Task 11: テーマシステム・サブスクライバーバッジ・App.tsx統合

**Files:**
- Create: `src/components/SubscriberBadge.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `public/manifest.json`

**Interfaces:**
- Consumes: `PremiumGate`, `AssignmentMemo`, `SubscriberBadge`
- Consumes: `getTheme`, `saveTheme` from `src/core/premium.ts`
- Consumes: `isSubscriptionActive` from `src/core/auth.ts`

- [ ] **Step 1: `src/components/SubscriberBadge.tsx` を作成する**

```tsx
export function SubscriberBadge() {
  return (
    <span className="subscriberBadge" title="プレミアムサブスクライバー">
      PRO
    </span>
  )
}
```

- [ ] **Step 2: `src/App.css` にテーマCSSカスタムプロパティとスタイルを追加する**

`src/App.css` の先頭に追加:
```css
/* テーマ: デフォルト */
:root {
  --color-bg: #ffffff;
  --color-surface: #f5f5f5;
  --color-text: #1a1a1a;
  --color-accent: #2563eb;
  --color-urgent: #dc2626;
  --color-border: #e5e7eb;
}

/* テーマ: ダーク */
[data-theme="dark"] {
  --color-bg: #0f172a;
  --color-surface: #1e293b;
  --color-text: #f1f5f9;
  --color-accent: #60a5fa;
  --color-urgent: #f87171;
  --color-border: #334155;
}

.subscriberBadge {
  display: inline-block;
  background: var(--color-accent);
  color: #fff;
  font-size: 10px;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 6px;
  vertical-align: middle;
}

.premiumGate {
  padding: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  text-align: center;
  margin: 8px 0;
}

.premiumGraceNote {
  font-size: 11px;
  color: #f59e0b;
  padding: 4px 8px;
  background: #fef3c7;
  border-radius: 4px;
  margin-bottom: 8px;
}

.modalOverlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modalCard {
  background: var(--color-bg);
  border-radius: 12px;
  padding: 24px;
  width: 320px;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.modalClose {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
}

.modalError {
  color: var(--color-urgent);
  font-size: 13px;
  margin: 0;
}

.modeSwitchBtn {
  background: none;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  font-size: 13px;
  text-decoration: underline;
}

.prioritySelector {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.priorityBtn {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  cursor: pointer;
  background: var(--color-surface);
}

.priorityBtn.active.priority1 { background: #d1fae5; border-color: #10b981; }
.priorityBtn.active.priority2 { background: #fef3c7; border-color: #f59e0b; }
.priorityBtn.active.priority3 { background: #fee2e2; border-color: #ef4444; }

.memoInput {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  resize: vertical;
  background: var(--color-surface);
  color: var(--color-text);
  box-sizing: border-box;
}

.themeSelector {
  display: flex;
  gap: 8px;
  align-items: center;
}
```

- [ ] **Step 3: `src/App.tsx` にテーマ・バッジ・メモUIを統合する**

`App.tsx` の `import` 群の直後に追加:
```tsx
import { getTheme, saveTheme } from './core/premium'
import { isSubscriptionActive } from './core/auth'
import { PremiumGate } from './components/PremiumGate'
import { AssignmentMemo } from './components/AssignmentMemo'
import { SubscriberBadge } from './components/SubscriberBadge'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string ?? ''
```

`App()` 関数内の state 宣言群に追加:
```tsx
const [theme, setTheme] = useState('default')
const [isSubscriber, setIsSubscriber] = useState(false)
```

`App()` の `useEffect(() => { void refreshAll() }, [])` の直後に追加:
```tsx
useEffect(() => {
  void (async () => {
    const [savedTheme, subscriberStatus] = await Promise.all([
      getTheme(),
      isSubscriptionActive(),
    ])
    setTheme(savedTheme)
    setIsSubscriber(subscriberStatus)
    document.documentElement.setAttribute('data-theme', savedTheme)
  })()
}, [])
```

ダッシュボードの `<section className="settings">` — 対象コースの選択 の **直前** に追加:
```tsx
<details className="settings" open>
  <summary>
    プレミアム設定
    {isSubscriber && <SubscriberBadge />}
  </summary>

  <PremiumGate apiBaseUrl={API_BASE_URL}>
    <div className="themeSelector">
      <span>テーマ:</span>
      {['default', 'dark'].map((t) => (
        <button
          key={t}
          type="button"
          className={`priorityBtn ${theme === t ? 'active priority2' : ''}`}
          onClick={() => {
            setTheme(t)
            document.documentElement.setAttribute('data-theme', t)
            void saveTheme(t)
          }}
        >
          {t === 'default' ? '標準' : 'ダーク'}
        </button>
      ))}
    </div>
  </PremiumGate>
</details>
```

ダッシュボードの各 `<AssignmentCard>` — `canHide` ありのもの — の直後に `<AssignmentMemo>` を追加する。例として `urgentAssignments.map` 内を以下のように変更:
```tsx
{urgentAssignments.map((assignment) => (
  <div key={assignment.id}>
    <AssignmentCard
      assignment={assignment}
      canHide
      onHide={hideAssignment}
    />
    <PremiumGate apiBaseUrl={API_BASE_URL}>
      <AssignmentMemo assignmentId={assignment.id} apiBaseUrl={API_BASE_URL} />
    </PremiumGate>
  </div>
))}
```

同様のパターンを `tomorrowAssignments`・`thisWeekAssignments`・`laterAssignments` にも適用する。

- [ ] **Step 4: `public/manifest.json` に host_permissions を追加する**

`public/manifest.json` の `"host_permissions"` を更新:
```json
"host_permissions": [
  "https://letus.ed.tus.ac.jp/*",
  "https://your-domain.com/*"
]
```

※ `your-domain.com` は実際のAPIドメインに置き換える。

- [ ] **Step 5: ビルドが通ることを確認する**

```bash
pnpm build
```

期待される出力: `dist/` が生成される、TypeScriptエラーなし

- [ ] **Step 6: コミットする**

```bash
git add src/components/SubscriberBadge.tsx src/App.tsx src/App.css public/manifest.json
git commit -m "feat(ext): integrate theme, badge, and memo UI into dashboard"
```

---

## 参考: ラズパイ4 セットアップ手順（本番デプロイ時）

実装完了後、本番環境を構築する際の手順:

```bash
# 1. Node.js LTS をインストール
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. PM2 をグローバルインストール
sudo npm install -g pm2

# 3. APIをラズパイに配置
scp -r api/ pi@raspberrypi.local:~/letus-api/

# 4. 依存関係インストール
ssh pi@raspberrypi.local "cd ~/letus-api && npm install --production"

# 5. .env を設定（JWT_SECRET, STRIPE_SECRET_KEY 等）
ssh pi@raspberrypi.local "nano ~/letus-api/.env"

# 6. PM2 で起動・自動起動設定
ssh pi@raspberrypi.local "cd ~/letus-api && pm2 start ecosystem.config.js && pm2 save && pm2 startup"

# 7. Cloudflare Tunnel のインストール（Cloudflare Dashboardでトンネル作成後）
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/
```
