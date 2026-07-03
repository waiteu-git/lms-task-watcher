# Discordコミュニティ機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サブスクライバーがマイページからDiscordサーバーへ自動参加でき、受講コースごとに共有ロール・専用チャンネルが自動作成され、解約時には自動的にサーバーから退出させられる仕組みを実装する。

**Architecture:** 常時接続のDiscord Botプロセスは持たず、既存のExpress APIサーバー（`api/`）からDiscordのREST API（v10）をfetchで呼び出すだけで完結させる。新規モジュール`api/lib/discord.js`にDiscord API呼び出しをまとめ、既存の`api/routes/subscription.js`・`api/routes/user.js`・`api/routes/webhook.js`のパターンに合わせてルートを追加する。

**Tech Stack:** 既存のExpress + better-sqlite3 API、Node.jsネイティブ`fetch`（Node 22、追加パッケージ不要）、Jest + supertest（`cd api && npx jest`で実行）、素のHTML/JS（`landing/mypage.html`）、拡張機能側は`src/background/index.ts`。

## Global Constraints

- 常時接続のBotゲートウェイ接続は持たない。全てDiscord REST APIへのfetch呼び出しで完結させる
- コースの同定キーは`Course.id`（LETUSの安定したコースID）。表示名は`course_name`だが、同一性の判定は`course_id`で行う
- コースロール・チャンネルは**コースごとに1組**（ユーザーごとではない）。同じコースを選んだ全員が共有する
- 拡張機能の「スキャン対象コースの有効/無効」とDiscordロール希望（`discord_role_wanted`）は完全に独立している。同期しない
- 新規環境変数（`api/.env.example`に追記が必要）: `DISCORD_CLIENT_ID`・`DISCORD_CLIENT_SECRET`・`DISCORD_BOT_TOKEN`・`DISCORD_GUILD_ID`・`DISCORD_SUBSCRIBER_ROLE_ID`・`DISCORD_REDIRECT_URI`（`https://api.waiteu.dev/api/discord/callback`）
- Discord APIのpermission bit値: `VIEW_CHANNEL` = `1024`、`SEND_MESSAGES` = `2048`（両方許可する場合は文字列`"3072"`として渡す。Discord API v10はpermissionをstringのビットフィールドとして扱う）
- テストは`cd api && npx jest`で実行する（リポジトリルートからの`vitest run`はapi/testsを対象にしないこと）
- Discord APIのモックには`global.fetch = jest.fn()`を使う（既存の`jest.mock('stripe', ...)`パターンとは異なり、fetchはグローバル関数のため`jest.spyOn(global, 'fetch')`または直接代入でモックする）

---

### Task 1: DBスキーマ追加 + Discord OAuth/参加/退出API（`api/lib/discord.js`）

**Files:**
- Modify: `api/db/sqlite.js`（テーブル追加）
- Create: `api/lib/discord.js`
- Test: `api/tests/discord.test.js`

**Interfaces:**
- Produces:
  - `password_reset_tokens`と同様の追加パターンでスキーマに`user_courses`・`discord_course_roles`テーブル、`subscriptions.discord_user_id`カラムを追加
  - `exchangeOAuthCode(code: string): Promise<{ access_token: string }>`
  - `getDiscordUser(accessToken: string): Promise<{ id: string }>`
  - `joinGuild(discordUserId: string, accessToken: string, roleIds: string[]): Promise<void>`
  - `kickMember(discordUserId: string): Promise<void>`
  - これらはTask 3・4・5で使われる

- [ ] **Step 1: スキーマを追加する**

`api/db/sqlite.js`の`db.exec(...)`ブロック内、既存の`password_reset_tokens`テーブル定義の後に追加:
```sql

  ALTER TABLE subscriptions ADD COLUMN discord_user_id TEXT;
```

better-sqlite3の`ALTER TABLE ADD COLUMN`は`IF NOT EXISTS`をサポートしないため、既存カラムがあると毎回エラーになる。代わりに以下のように、カラム存在チェックをJS側で行う:

`api/db/sqlite.js`の`db.exec(...)`ブロックの直後（ファイル末尾の`module.exports = db`より前）に追加:
```js
const subscriptionColumns = db.prepare("PRAGMA table_info(subscriptions)").all()
const hasDiscordUserId = subscriptionColumns.some((col) => col.name === 'discord_user_id')
if (!hasDiscordUserId) {
  db.exec('ALTER TABLE subscriptions ADD COLUMN discord_user_id TEXT')
}
```

そして`db.exec(...)`ブロック内、`password_reset_tokens`テーブル定義の後に以下のテーブルを追加:
```sql

  CREATE TABLE IF NOT EXISTS user_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id TEXT NOT NULL,
    course_name TEXT NOT NULL,
    discord_role_wanted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, course_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS discord_course_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL UNIQUE,
    course_name TEXT NOT NULL,
    discord_role_id TEXT NOT NULL,
    discord_channel_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
```

- [ ] **Step 2: 失敗するテストを書く**

`api/tests/discord.test.js`:
```js
process.env.DB_PATH = ':memory:'
process.env.DISCORD_CLIENT_ID = 'test-client-id'
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret'
process.env.DISCORD_BOT_TOKEN = 'test-bot-token'
process.env.DISCORD_GUILD_ID = 'test-guild-id'
process.env.DISCORD_REDIRECT_URI = 'https://api.waiteu.dev/api/discord/callback'

const {
  exchangeOAuthCode,
  getDiscordUser,
  joinGuild,
  kickMember,
} = require('../lib/discord')

describe('exchangeOAuthCode', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('正しいbodyでトークンエンドポイントを呼び、access_tokenを返す', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'discord-access-token' }),
    })

    const result = await exchangeOAuthCode('auth-code-123')

    expect(result.access_token).toBe('discord-access-token')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/oauth2/token',
      expect.objectContaining({ method: 'POST' })
    )
    const callBody = global.fetch.mock.calls[0][1].body
    expect(callBody.toString()).toContain('code=auth-code-123')
  })

  it('失敗レスポンスなら例外を投げる', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 })

    await expect(exchangeOAuthCode('bad-code')).rejects.toThrow()
  })
})

describe('getDiscordUser', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('Bearerトークンでユーザー情報を取得する', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'discord-user-1' }),
    })

    const result = await getDiscordUser('user-access-token')

    expect(result.id).toBe('discord-user-1')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/users/@me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer user-access-token' },
      })
    )
  })
})

describe('joinGuild', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('Bot認証でギルド参加APIを呼ぶ', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201 })

    await joinGuild('discord-user-1', 'user-access-token', ['role-1'])

    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/test-guild-id/members/discord-user-1',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bot test-bot-token' }),
      })
    )
    const callBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(callBody).toEqual({ access_token: 'user-access-token', roles: ['role-1'] })
  })
})

describe('kickMember', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('Bot認証でメンバーを削除する', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 })

    await kickMember('discord-user-1')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/test-guild-id/members/discord-user-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bot test-bot-token' }),
      })
    )
  })

  it('404（既に居ない）はエラーにしない', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 })

    await expect(kickMember('gone-user')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `cd api && npx jest tests/discord.test.js -v`
Expected: FAIL — `Cannot find module '../lib/discord'`

- [ ] **Step 4: `api/lib/discord.js`を実装する**

```js
const DISCORD_API_BASE = 'https://discord.com/api/v10'

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

async function exchangeOAuthCode(code) {
  const res = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
    }),
  })

  if (!res.ok) {
    throw new Error(`Discord token exchange failed: ${res.status}`)
  }

  return res.json()
}

async function getDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    throw new Error(`Discord user fetch failed: ${res.status}`)
  }

  return res.json()
}

async function joinGuild(discordUserId, accessToken, roleIds) {
  const res = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}`,
    {
      method: 'PUT',
      headers: botHeaders(),
      body: JSON.stringify({ access_token: accessToken, roles: roleIds }),
    }
  )

  if (!res.ok && res.status !== 204) {
    throw new Error(`Discord guild join failed: ${res.status}`)
  }
}

async function kickMember(discordUserId) {
  const res = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}`,
    {
      method: 'DELETE',
      headers: botHeaders(),
    }
  )

  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`Discord kick failed: ${res.status}`)
  }
}

module.exports = {
  exchangeOAuthCode,
  getDiscordUser,
  joinGuild,
  kickMember,
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd api && npx jest tests/discord.test.js -v`
Expected: PASS（6 tests）

- [ ] **Step 6: 全テストスイートを実行**

Run: `cd api && npx jest -v`
Expected: PASS（全スイート、既存分含む）

- [ ] **Step 7: `.env.example`を更新**

`api/.env.example`の末尾に追加:
```
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_SUBSCRIBER_ROLE_ID=...
DISCORD_REDIRECT_URI=https://api.waiteu.dev/api/discord/callback
```

- [ ] **Step 8: コミット**

```bash
git add api/db/sqlite.js api/lib/discord.js api/tests/discord.test.js api/.env.example
git commit -m "feat(api): add Discord OAuth/join/kick API client and schema"
```

---

### Task 2: コースロール・チャンネル作成/付与/剥奪（`api/lib/discord.js`拡張）

**Files:**
- Modify: `api/lib/discord.js`
- Modify: `api/tests/discord.test.js`

**Interfaces:**
- Consumes: Task 1の`botHeaders()`（同一ファイル内）、`discord_course_roles`テーブル（Task 1）
- Produces:
  - `createCourseRoleAndChannel(courseName: string): Promise<{ roleId: string, channelId: string }>`
  - `assignRoleToMember(discordUserId: string, roleId: string): Promise<void>`
  - `removeRoleFromMember(discordUserId: string, roleId: string): Promise<void>`
  - `ensureCourseRole(db, courseId: string, courseName: string): Promise<{ roleId: string, channelId: string }>` — Task 4・5が使う

- [ ] **Step 1: 失敗するテストを追加**

`api/tests/discord.test.js`の末尾に追加:
```js
describe('createCourseRoleAndChannel', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('ロールとチャンネルを作成し、両方のidを返す', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'role-abc' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'channel-xyz' }) })

    const { createCourseRoleAndChannel } = require('../lib/discord')
    const result = await createCourseRoleAndChannel('物理学A1')

    expect(result).toEqual({ roleId: 'role-abc', channelId: 'channel-xyz' })

    const roleCall = global.fetch.mock.calls[0]
    expect(roleCall[0]).toBe('https://discord.com/api/v10/guilds/test-guild-id/roles')
    expect(JSON.parse(roleCall[1].body)).toEqual({ name: '物理学A1' })

    const channelCall = global.fetch.mock.calls[1]
    expect(channelCall[0]).toBe('https://discord.com/api/v10/guilds/test-guild-id/channels')
    const channelBody = JSON.parse(channelCall[1].body)
    expect(channelBody.name).toBe('物理学A1')
    expect(channelBody.type).toBe(0)
    expect(channelBody.permission_overwrites).toEqual([
      { id: 'test-guild-id', type: 0, deny: '1024' },
      { id: 'role-abc', type: 0, allow: '3072' },
    ])
  })
})

describe('assignRoleToMember / removeRoleFromMember', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('ロール付与はPUT /members/{id}/roles/{roleId}', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 })
    const { assignRoleToMember } = require('../lib/discord')

    await assignRoleToMember('discord-user-1', 'role-abc')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/test-guild-id/members/discord-user-1/roles/role-abc',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('ロール剥奪はDELETE /members/{id}/roles/{roleId}', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 })
    const { removeRoleFromMember } = require('../lib/discord')

    await removeRoleFromMember('discord-user-1', 'role-abc')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/test-guild-id/members/discord-user-1/roles/role-abc',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})

describe('ensureCourseRole', () => {
  const Database = require('better-sqlite3')
  let db

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE discord_course_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id TEXT NOT NULL UNIQUE,
        course_name TEXT NOT NULL,
        discord_role_id TEXT NOT NULL,
        discord_channel_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  })

  afterEach(() => {
    global.fetch.mockRestore?.()
    db.close()
  })

  it('既存のマッピングがあればDiscord APIを呼ばずそれを返す', async () => {
    db.prepare(
      'INSERT INTO discord_course_roles (course_id, course_name, discord_role_id, discord_channel_id) VALUES (?, ?, ?, ?)'
    ).run('course-1', '物理学A1', 'existing-role', 'existing-channel')

    global.fetch = jest.fn()
    const { ensureCourseRole } = require('../lib/discord')

    const result = await ensureCourseRole(db, 'course-1', '物理学A1')

    expect(result).toEqual({ roleId: 'existing-role', channelId: 'existing-channel' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('マッピングが無ければ作成してDBに保存する', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'new-role' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'new-channel' }) })

    const { ensureCourseRole } = require('../lib/discord')
    const result = await ensureCourseRole(db, 'course-2', '化学実験')

    expect(result).toEqual({ roleId: 'new-role', channelId: 'new-channel' })

    const row = db.prepare('SELECT * FROM discord_course_roles WHERE course_id = ?').get('course-2')
    expect(row.discord_role_id).toBe('new-role')
    expect(row.discord_channel_id).toBe('new-channel')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd api && npx jest tests/discord.test.js -v`
Expected: FAIL — `createCourseRoleAndChannel is not a function`

- [ ] **Step 3: `api/lib/discord.js`に追加実装する**

`module.exports`の直前に追加:
```js
async function createCourseRoleAndChannel(courseName) {
  const roleRes = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/roles`,
    {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({ name: courseName }),
    }
  )

  if (!roleRes.ok) {
    throw new Error(`Discord role create failed: ${roleRes.status}`)
  }

  const role = await roleRes.json()

  const channelRes = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/channels`,
    {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({
        name: courseName,
        type: 0,
        permission_overwrites: [
          { id: process.env.DISCORD_GUILD_ID, type: 0, deny: '1024' },
          { id: role.id, type: 0, allow: '3072' },
        ],
      }),
    }
  )

  if (!channelRes.ok) {
    throw new Error(`Discord channel create failed: ${channelRes.status}`)
  }

  const channel = await channelRes.json()

  return { roleId: role.id, channelId: channel.id }
}

async function assignRoleToMember(discordUserId, roleId) {
  const res = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
    { method: 'PUT', headers: botHeaders() }
  )

  if (!res.ok && res.status !== 204) {
    throw new Error(`Discord role assign failed: ${res.status}`)
  }
}

async function removeRoleFromMember(discordUserId, roleId) {
  const res = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
    { method: 'DELETE', headers: botHeaders() }
  )

  if (!res.ok && res.status !== 204) {
    throw new Error(`Discord role remove failed: ${res.status}`)
  }
}

async function ensureCourseRole(db, courseId, courseName) {
  const existing = db.prepare(
    'SELECT discord_role_id, discord_channel_id FROM discord_course_roles WHERE course_id = ?'
  ).get(courseId)

  if (existing) {
    return { roleId: existing.discord_role_id, channelId: existing.discord_channel_id }
  }

  const { roleId, channelId } = await createCourseRoleAndChannel(courseName)

  db.prepare(
    'INSERT INTO discord_course_roles (course_id, course_name, discord_role_id, discord_channel_id) VALUES (?, ?, ?, ?)'
  ).run(courseId, courseName, roleId, channelId)

  return { roleId, channelId }
}
```

そして`module.exports`を以下に置き換える:
```js
module.exports = {
  exchangeOAuthCode,
  getDiscordUser,
  joinGuild,
  kickMember,
  createCourseRoleAndChannel,
  assignRoleToMember,
  removeRoleFromMember,
  ensureCourseRole,
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd api && npx jest tests/discord.test.js -v`
Expected: PASS（12 tests）

- [ ] **Step 5: コミット**

```bash
git add api/lib/discord.js api/tests/discord.test.js
git commit -m "feat(api): add Discord course role/channel creation and assignment"
```

---

### Task 3: コース同期エンドポイント（`GET/POST /api/user/courses`）

**Files:**
- Modify: `api/routes/user.js`
- Test: `api/tests/user-courses.test.js`

**Interfaces:**
- Consumes: `requireAuth`（既存importをそのまま使う）
- Produces: `GET /api/user/courses` → `{ courses: [{ courseId, courseName, discordRoleWanted }] }`、`POST /api/user/courses` → `{ ok: true }`。Task 4が`user_courses`テーブルを引き続き使う

- [ ] **Step 1: 失敗するテストを書く**

`api/tests/user-courses.test.js`:
```js
process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'

const request = require('supertest')
const app = require('../server')

describe('POST /api/user/courses', () => {
  it('コース一覧を新規保存する', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'course-user@example.com', password: 'password123' })
    const token = reg.body.token

    const res = await request(app)
      .post('/api/user/courses')
      .set('Authorization', `Bearer ${token}`)
      .send({ courses: [{ id: 'course-1', name: '物理学A1' }, { id: 'course-2', name: '化学実験' }] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('トークンなしでは401', async () => {
    const res = await request(app)
      .post('/api/user/courses')
      .send({ courses: [] })
    expect(res.status).toBe(401)
  })

  it('coursesが配列でなければ400', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'bad-body@example.com', password: 'password123' })
    const token = reg.body.token

    const res = await request(app)
      .post('/api/user/courses')
      .set('Authorization', `Bearer ${token}`)
      .send({ courses: 'not-an-array' })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/user/courses', () => {
  it('保存済みのコース一覧をdiscordRoleWanted付きで返す', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'get-courses@example.com', password: 'password123' })
    const token = reg.body.token

    await request(app)
      .post('/api/user/courses')
      .set('Authorization', `Bearer ${token}`)
      .send({ courses: [{ id: 'course-9', name: '線形代数' }] })

    const res = await request(app)
      .get('/api/user/courses')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.courses).toEqual([
      { courseId: 'course-9', courseName: '線形代数', discordRoleWanted: false },
    ])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd api && npx jest tests/user-courses.test.js -v`
Expected: FAIL — `404`（ルート未定義）

- [ ] **Step 3: エンドポイントを実装する**

`api/routes/user.js`の`module.exports = router`の直前に追加:
```js
router.post('/courses', requireAuth, (req, res) => {
  const { courses } = req.body

  if (!Array.isArray(courses)) {
    return res.status(400).json({ error: 'courses は配列である必要があります' })
  }

  const upsert = db.prepare(`
    INSERT INTO user_courses (user_id, course_id, course_name, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, course_id) DO UPDATE SET
      course_name = excluded.course_name,
      updated_at = excluded.updated_at
  `)

  const insertMany = db.transaction((rows) => {
    for (const course of rows) {
      upsert.run(req.userId, course.id, course.name)
    }
  })

  insertMany(courses)

  return res.json({ ok: true })
})

router.get('/courses', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT course_id as courseId, course_name as courseName, discord_role_wanted as discordRoleWanted
     FROM user_courses WHERE user_id = ?`
  ).all(req.userId)

  const courses = rows.map((row) => ({
    ...row,
    discordRoleWanted: Boolean(row.discordRoleWanted),
  }))

  return res.json({ courses })
})
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd api && npx jest tests/user-courses.test.js -v`
Expected: PASS（4 tests）

- [ ] **Step 5: 全テストスイートを実行**

Run: `cd api && npx jest -v`
Expected: PASS（全スイート）

- [ ] **Step 6: コミット**

```bash
git add api/routes/user.js api/tests/user-courses.test.js
git commit -m "feat(api): add course sync endpoints"
```

---

### Task 4: コース別Discordロール希望の切り替え（`PATCH /api/user/courses/:courseId`）

**Files:**
- Modify: `api/routes/user.js`
- Modify: `api/tests/user-courses.test.js`

**Interfaces:**
- Consumes: `ensureCourseRole`・`assignRoleToMember`・`removeRoleFromMember`（Task 1・2の`api/lib/discord.js`）
- Produces: `PATCH /api/user/courses/:courseId` → `{ ok: true }`（`discord_user_id`が未設定でもエラーにはしない。DB更新のみ行い、Discord側の反映は連携済みの場合のみ）

- [ ] **Step 1: 失敗するテストを追加**

`api/tests/user-courses.test.js`の末尾に追加:
```js
describe('PATCH /api/user/courses/:courseId', () => {
  const discordLib = require('../lib/discord')
  const db = require('../db/sqlite')

  beforeEach(() => {
    jest.spyOn(discordLib, 'ensureCourseRole').mockResolvedValue({ roleId: 'role-1', channelId: 'channel-1' })
    jest.spyOn(discordLib, 'assignRoleToMember').mockResolvedValue(undefined)
    jest.spyOn(discordLib, 'removeRoleFromMember').mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('discord_user_id未設定ならDB更新のみでDiscord APIは呼ばない', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'no-discord@example.com', password: 'password123' })
    const token = reg.body.token

    await request(app)
      .post('/api/user/courses')
      .set('Authorization', `Bearer ${token}`)
      .send({ courses: [{ id: 'course-a', name: '統計学' }] })

    const res = await request(app)
      .patch('/api/user/courses/course-a')
      .set('Authorization', `Bearer ${token}`)
      .send({ discordRoleWanted: true })

    expect(res.status).toBe(200)
    expect(discordLib.ensureCourseRole).not.toHaveBeenCalled()
  })

  it('discord_user_id設定済みでtrueにするとロール作成・付与が呼ばれる', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'with-discord@example.com', password: 'password123' })
    const token = reg.body.token
    const userRow = db.prepare('SELECT id FROM users WHERE email = ?').get('with-discord@example.com')
    db.prepare('UPDATE subscriptions SET discord_user_id = ? WHERE user_id = ?').run('discord-123', userRow.id)

    await request(app)
      .post('/api/user/courses')
      .set('Authorization', `Bearer ${token}`)
      .send({ courses: [{ id: 'course-b', name: '有機化学' }] })

    const res = await request(app)
      .patch('/api/user/courses/course-b')
      .set('Authorization', `Bearer ${token}`)
      .send({ discordRoleWanted: true })

    expect(res.status).toBe(200)
    expect(discordLib.ensureCourseRole).toHaveBeenCalledWith(expect.anything(), 'course-b', '有機化学')
    expect(discordLib.assignRoleToMember).toHaveBeenCalledWith('discord-123', 'role-1')
  })

  it('falseに戻すとロール剥奪が呼ばれる', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'toggle-off@example.com', password: 'password123' })
    const token = reg.body.token
    const userRow = db.prepare('SELECT id FROM users WHERE email = ?').get('toggle-off@example.com')
    db.prepare('UPDATE subscriptions SET discord_user_id = ? WHERE user_id = ?').run('discord-456', userRow.id)

    await request(app)
      .post('/api/user/courses')
      .set('Authorization', `Bearer ${token}`)
      .send({ courses: [{ id: 'course-c', name: '英語コミュニケーション' }] })

    await request(app)
      .patch('/api/user/courses/course-c')
      .set('Authorization', `Bearer ${token}`)
      .send({ discordRoleWanted: true })

    const res = await request(app)
      .patch('/api/user/courses/course-c')
      .set('Authorization', `Bearer ${token}`)
      .send({ discordRoleWanted: false })

    expect(res.status).toBe(200)
    expect(discordLib.removeRoleFromMember).toHaveBeenCalledWith('discord-456', 'role-1')
  })

  it('存在しないcourseIdは404', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'no-such-course@example.com', password: 'password123' })
    const token = reg.body.token

    const res = await request(app)
      .patch('/api/user/courses/does-not-exist')
      .set('Authorization', `Bearer ${token}`)
      .send({ discordRoleWanted: true })

    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd api && npx jest tests/user-courses.test.js -v`
Expected: FAIL — `404`（ルート未定義、既存の"存在しないcourseId"テストと区別つかず全て失敗）

- [ ] **Step 3: `api/routes/user.js`の先頭に`discord`モジュールをimport**

ファイル先頭のrequire群に追加:
```js
const discord = require('../lib/discord')
```

- [ ] **Step 4: エンドポイントを実装する**

`GET /courses`ハンドラの後、`module.exports = router`の前に追加:
```js
router.patch('/courses/:courseId', requireAuth, async (req, res) => {
  const { courseId } = req.params
  const { discordRoleWanted } = req.body

  const courseRow = db.prepare(
    'SELECT course_name FROM user_courses WHERE user_id = ? AND course_id = ?'
  ).get(req.userId, courseId)

  if (!courseRow) {
    return res.status(404).json({ error: 'コースが見つかりません' })
  }

  db.prepare(
    `UPDATE user_courses SET discord_role_wanted = ?, updated_at = datetime('now')
     WHERE user_id = ? AND course_id = ?`
  ).run(discordRoleWanted ? 1 : 0, req.userId, courseId)

  const sub = db.prepare(
    'SELECT discord_user_id FROM subscriptions WHERE user_id = ?'
  ).get(req.userId)

  if (sub?.discord_user_id) {
    try {
      if (discordRoleWanted) {
        const { roleId } = await discord.ensureCourseRole(db, courseId, courseRow.course_name)
        await discord.assignRoleToMember(sub.discord_user_id, roleId)
      } else {
        const mapping = db.prepare(
          'SELECT discord_role_id FROM discord_course_roles WHERE course_id = ?'
        ).get(courseId)
        if (mapping) {
          await discord.removeRoleFromMember(sub.discord_user_id, mapping.discord_role_id)
        }
      }
    } catch (err) {
      console.error('Discordロール更新に失敗:', err.message)
    }
  }

  return res.json({ ok: true })
})
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd api && npx jest tests/user-courses.test.js -v`
Expected: PASS（8 tests）

- [ ] **Step 6: 全テストスイートを実行**

Run: `cd api && npx jest -v`
Expected: PASS（全スイート）

- [ ] **Step 7: コミット**

```bash
git add api/routes/user.js api/tests/user-courses.test.js
git commit -m "feat(api): sync course discord-role preference to Discord"
```

---

### Task 5: Discord OAuthコールバック（`GET /api/discord/callback`）

**Files:**
- Create: `api/routes/discord.js`
- Modify: `api/server.js`（ルートマウント）
- Test: `api/tests/discord-callback.test.js`

**Interfaces:**
- Consumes: `exchangeOAuthCode`・`getDiscordUser`・`joinGuild`・`ensureCourseRole`・`assignRoleToMember`（`api/lib/discord.js`）
- Produces: なし（最終エンドポイント、成功時は`https://lms.waiteu.dev/mypage.html?discord=connected`へリダイレクト）

- [ ] **Step 1: 失敗するテストを書く**

`api/tests/discord-callback.test.js`:
```js
process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.DISCORD_CLIENT_ID = 'test-client-id'
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret'
process.env.DISCORD_BOT_TOKEN = 'test-bot-token'
process.env.DISCORD_GUILD_ID = 'test-guild-id'
process.env.DISCORD_SUBSCRIBER_ROLE_ID = 'subscriber-role-id'
process.env.DISCORD_REDIRECT_URI = 'https://api.waiteu.dev/api/discord/callback'

const request = require('supertest')
const app = require('../server')
const db = require('../db/sqlite')
const discordLib = require('../lib/discord')

describe('GET /api/discord/callback', () => {
  let token
  let userId

  beforeEach(async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'discord-link@example.com', password: 'password123' })
    token = reg.body.token
    userId = db.prepare('SELECT id FROM users WHERE email = ?').get('discord-link@example.com').id

    jest.spyOn(discordLib, 'exchangeOAuthCode').mockResolvedValue({ access_token: 'discord-oauth-token' })
    jest.spyOn(discordLib, 'getDiscordUser').mockResolvedValue({ id: 'discord-user-999' })
    jest.spyOn(discordLib, 'joinGuild').mockResolvedValue(undefined)
    jest.spyOn(discordLib, 'ensureCourseRole').mockResolvedValue({ roleId: 'course-role-1', channelId: 'chan-1' })
    jest.spyOn(discordLib, 'assignRoleToMember').mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('連携成功でdiscord_user_idを保存しmypageへリダイレクトする', async () => {
    const res = await request(app)
      .get('/api/discord/callback')
      .query({ code: 'auth-code-abc', state: token })

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://lms.waiteu.dev/mypage.html?discord=connected')

    const sub = db.prepare('SELECT discord_user_id FROM subscriptions WHERE user_id = ?').get(userId)
    expect(sub.discord_user_id).toBe('discord-user-999')

    expect(discordLib.joinGuild).toHaveBeenCalledWith(
      'discord-user-999',
      'discord-oauth-token',
      ['subscriber-role-id']
    )
  })

  it('discord_role_wanted済みのコースがあれば同時にロール付与する', async () => {
    await request(app)
      .post('/api/user/courses')
      .set('Authorization', `Bearer ${token}`)
      .send({ courses: [{ id: 'course-z', name: '生物学' }] })
    await request(app)
      .patch('/api/user/courses/course-z')
      .set('Authorization', `Bearer ${token}`)
      .send({ discordRoleWanted: true })

    await request(app)
      .get('/api/discord/callback')
      .query({ code: 'auth-code-def', state: token })

    expect(discordLib.joinGuild).toHaveBeenCalledWith(
      'discord-user-999',
      'discord-oauth-token',
      expect.arrayContaining(['subscriber-role-id', 'course-role-1'])
    )
  })

  it('stateが無効なトークンなら401', async () => {
    const res = await request(app)
      .get('/api/discord/callback')
      .query({ code: 'auth-code-abc', state: 'invalid-token' })

    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd api && npx jest tests/discord-callback.test.js -v`
Expected: FAIL — `404`（ルート未定義）

- [ ] **Step 3: `api/routes/discord.js`を実装する**

```js
const express = require('express')
const jwt = require('jsonwebtoken')
const db = require('../db/sqlite')
const discord = require('../lib/discord')

const router = express.Router()

// GET /api/discord/callback
// Discord OAuth2のstateパラメータにJWTをそのまま渡す方式を採る
// （mypage.htmlがOAuth認可URLへ遷移する際、state=<現在のauthToken>を付与する）
router.get('/callback', async (req, res) => {
  const { code, state } = req.query

  let payload
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'トークンが無効です' })
  }

  const userId = payload.userId

  try {
    const { access_token: discordAccessToken } = await discord.exchangeOAuthCode(code)
    const discordUser = await discord.getDiscordUser(discordAccessToken)

    const wantedCourses = db.prepare(
      'SELECT course_id, course_name FROM user_courses WHERE user_id = ? AND discord_role_wanted = 1'
    ).all(userId)

    const roleIds = [process.env.DISCORD_SUBSCRIBER_ROLE_ID]
    for (const course of wantedCourses) {
      const { roleId } = await discord.ensureCourseRole(db, course.course_id, course.course_name)
      roleIds.push(roleId)
    }

    await discord.joinGuild(discordUser.id, discordAccessToken, roleIds)

    db.prepare('UPDATE subscriptions SET discord_user_id = ? WHERE user_id = ?').run(discordUser.id, userId)

    return res.redirect('https://lms.waiteu.dev/mypage.html?discord=connected')
  } catch (err) {
    console.error('Discord連携に失敗:', err.message)
    return res.redirect('https://lms.waiteu.dev/mypage.html?discord=error')
  }
})

module.exports = router
```

- [ ] **Step 4: `api/server.js`にルートをマウントする**

`api/server.js`の`app.use('/api/user', userRoutes)`の後に追加:
```js
const discordRoutes = require('./routes/discord')
```
（ファイル先頭のrequire群に追加）

そして`app.use('/api/device', deviceRoutes)`の後に追加:
```js
app.use('/api/discord', discordRoutes)
```

- [ ] **Step 5: テストが通ることを確認**

Run: `cd api && npx jest tests/discord-callback.test.js -v`
Expected: PASS（3 tests）

- [ ] **Step 6: 全テストスイートを実行**

Run: `cd api && npx jest -v`
Expected: PASS（全スイート）

- [ ] **Step 7: コミット**

```bash
git add api/routes/discord.js api/server.js api/tests/discord-callback.test.js
git commit -m "feat(api): add Discord OAuth callback endpoint"
```

---

### Task 6: 解約時の自動kick

**Files:**
- Modify: `api/routes/webhook.js`
- Modify: `api/tests/webhook.test.js`

**Interfaces:**
- Consumes: `kickMember`（`api/lib/discord.js`）

- [ ] **Step 1: 失敗するテストを追加**

`api/tests/webhook.test.js`の先頭のrequire群に追加:
```js
const discordLib = require('../lib/discord')
```

`describe('POST /api/webhook/stripe', ...)`ブロック内、既存の`customer.subscription.deleted`テストの後に追加:
```js
  it('customer.subscription.deleted でdiscord_user_idがあればkickする', async () => {
    jest.spyOn(discordLib, 'kickMember').mockResolvedValue(undefined)

    db.prepare('UPDATE subscriptions SET discord_user_id = ? WHERE user_id = ?').run('discord-kick-me', userId)

    mockConstructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          customer: 'cus_test',
        },
      },
    })

    const res = await request(app)
      .post('/api/webhook/stripe')
      .set('stripe-signature', 'test-sig')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    expect(discordLib.kickMember).toHaveBeenCalledWith('discord-kick-me')

    discordLib.kickMember.mockRestore()
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd api && npx jest tests/webhook.test.js -v`
Expected: FAIL — `expect(discordLib.kickMember).toHaveBeenCalledWith(...)` — 呼ばれていない

- [ ] **Step 3: `api/routes/webhook.js`に処理を追加する**

ファイル先頭のrequire群に追加:
```js
const discord = require('../lib/discord')
```

`case 'customer.subscription.deleted':`ブロック全体を以下に置き換える:
```js
    case 'customer.subscription.deleted': {
      const sub = db.prepare(
        'SELECT discord_user_id FROM subscriptions WHERE stripe_customer_id = ?'
      ).get(obj.customer)

      db.prepare(`
        UPDATE subscriptions
        SET status = 'inactive', current_period_end = NULL, updated_at = datetime('now')
        WHERE stripe_customer_id = ?
      `).run(obj.customer)

      if (sub?.discord_user_id) {
        try {
          await discord.kickMember(sub.discord_user_id)
        } catch (err) {
          console.error('Discord自動kickに失敗:', err.message)
        }
      }
      break
    }
```

（この`case`ブロックが`async`関数内にあることを確認する。既存の`checkout.session.completed`ケースが既に`await`を使っているため、webhookハンドラ全体は既に`async`になっているはずである）

- [ ] **Step 4: テストが通ることを確認**

Run: `cd api && npx jest tests/webhook.test.js -v`
Expected: PASS

- [ ] **Step 5: 全テストスイートを実行**

Run: `cd api && npx jest -v`
Expected: PASS（全スイート）

- [ ] **Step 6: コミット**

```bash
git add api/routes/webhook.js api/tests/webhook.test.js
git commit -m "feat(api): auto-kick Discord member on subscription cancellation"
```

---

### Task 7: 拡張機能からのコース同期

**Files:**
- Modify: `src/background/index.ts`

**Interfaces:**
- Consumes: `POST https://api.waiteu.dev/api/user/courses`（Task 3）、`getAuthToken()`・`isSubscriptionActive()`（`src/core/auth.ts`、既存）

- [ ] **Step 1: `UPSERT_COURSES`ハンドラの後にコース同期関数を追加する**

`src/background/index.ts`の`upsertCourses`関数の直後に追加:
```ts
async function syncCoursesToServerIfSubscriber(courses: Course[]): Promise<void> {
  const [token, active] = await Promise.all([getAuthToken(), isSubscriptionActive()])

  if (!token || !active) {
    return
  }

  try {
    await fetch(`${API_BASE_URL}/api/user/courses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        courses: courses.map((c) => ({ id: c.id, name: c.name })),
      }),
    })
  } catch {
    // サーバー同期の失敗は無視する（次回のコース検出時に再試行される）
  }
}
```

ファイル先頭のimportに`getAuthToken`・`isSubscriptionActive`が無ければ追加:
```ts
import { getAuthToken, isSubscriptionActive } from '../core/auth'
```

`API_BASE_URL`が未定義であれば、既存のPremiumUI関連コードと同じ定義を追加（`import.meta.env.VITE_API_BASE_URL`を参照する既存パターンに合わせる）:
```ts
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) ?? ''
```

- [ ] **Step 2: `UPSERT_COURSES`メッセージハンドラから呼び出す**

`if (message?.type === 'UPSERT_COURSES') { ... }`ブロック内、`upsertCourses(courses).catch(...)`の行を以下に置き換える:
```ts
    upsertCourses(courses)
      .then(() => syncCoursesToServerIfSubscriber(courses))
      .catch((error) => {
        console.error('[LETUS Task Watcher] upsertCourses failed', error)
      })
```

- [ ] **Step 3: 型チェック**

Run: `pnpm tsc -b`
Expected: エラーなし

- [ ] **Step 4: ビルド**

Run: `pnpm build`
Expected: `✓ built in` で成功

- [ ] **Step 5: コミット**

```bash
git add src/background/index.ts
git commit -m "feat(ext): sync detected courses to server for subscribers"
```

---

### Task 8: マイページへのコース選択UI・Discord連携ボタン追加

**Files:**
- Modify: `landing/mypage.html`

**Interfaces:**
- Consumes: `GET/PATCH https://api.waiteu.dev/api/user/courses`（Task 3・4）、`GET https://api.waiteu.dev/api/discord/callback`へのOAuth遷移（Task 5）

- [ ] **Step 1: アクティブ会員向けカードにコース選択セクションとDiscord連携ボタンを追加する**

`landing/mypage.html`の`renderStatus`関数内、`if (data.status === 'active') { ... }`ブロックの`contentEl.innerHTML`を以下に置き換える:
```js
    if (data.status === 'active') {
      const periodEndText = data.currentPeriodEnd
        ? new Date(data.currentPeriodEnd).toLocaleDateString('ja-JP')
        : '不明'

      contentEl.innerHTML = `
        <div class="card">
          <p class="card-label">次回請求日</p>
          <p class="card-value">${periodEndText}</p>
          <button id="portal-btn" type="button">支払い方法を管理</button>
        </div>
        <div class="card" id="discord-card">
          <p class="card-label">Discordコミュニティ</p>
          <button id="discord-connect-btn" type="button">Discordと連携する</button>
          <div id="course-list"></div>
        </div>
      `

      document.getElementById('portal-btn').addEventListener('click', openBillingPortal)
      document.getElementById('discord-connect-btn').addEventListener('click', connectDiscord)
      void loadCourses()
    } else {
```

（`} else {`以降の非アクティブ分岐は既存のまま変更しない）

- [ ] **Step 2: Discord連携・コース一覧のスクリプトを追加する**

`</script>`の直前、`document.getElementById('logout-btn').addEventListener(...)`より前に追加:
```js
  const DISCORD_CLIENT_ID = 'YOUR_DISCORD_CLIENT_ID'

  function connectDiscord() {
    const redirectUri = encodeURIComponent('https://api.waiteu.dev/api/discord/callback')
    const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds.join&state=${encodeURIComponent(token)}`
    window.location.href = url
  }

  async function loadCourses() {
    const courseListEl = document.getElementById('course-list')

    try {
      const res = await fetch(`${API_BASE_URL}/api/user/courses`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()

      if (!res.ok) {
        return
      }

      if (data.courses.length === 0) {
        courseListEl.innerHTML = '<p class="card-label">検出されたコースがまだありません。拡張機能でLETUSのコースページを開くと表示されます。</p>'
        return
      }

      courseListEl.innerHTML = data.courses.map((course) => `
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:0.85rem;">
          <input type="checkbox" data-course-id="${course.courseId}" ${course.discordRoleWanted ? 'checked' : ''}>
          ${course.courseName}
        </label>
      `).join('')

      courseListEl.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.addEventListener('change', async (e) => {
          const target = e.target
          await fetch(`${API_BASE_URL}/api/user/courses/${target.dataset.courseId}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ discordRoleWanted: target.checked }),
          })
        })
      })
    } catch {
      courseListEl.innerHTML = '<p class="card-label">コース一覧の取得に失敗しました。</p>'
    }
  }
```

（`DISCORD_CLIENT_ID`はDiscord Developer Portalで発行される公開の値であり、秘匿情報ではないためクライアント側に埋め込んでよい。実装時に実際のIDに置き換える必要がある）

- [ ] **Step 2: Well-formed確認**

HTMLタグの対応・JSの構文エラーが無いことを確認する（自動テストは無し、静的サイトのため）。

- [ ] **Step 3: コミット**

```bash
git add landing/mypage.html
git commit -m "feat(landing): add course selection and Discord connect to mypage"
```

---

## 完了条件

- Task 1〜8の全チェックボックスが完了
- `cd api && npx jest`が全件成功
- `pnpm tsc -b`・`pnpm build`が成功
- 実際のDiscordサーバー・Bot・OAuthアプリを用意し、以下を実機確認:
  - マイページからDiscord連携→サーバーへ自動参加
  - マイページでコースを選択→対応するロール・専用チャンネルが自動作成・付与される
  - Stripeで解約→自動的にサーバーから退出させられる
