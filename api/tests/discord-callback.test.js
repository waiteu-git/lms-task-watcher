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

const jwt = require('jsonwebtoken')
const request = require('supertest')
const app = require('../server')
const db = require('../db/sqlite')
const discordLib = require('../lib/discord')

function signOAuthState(userId) {
  return jwt.sign({ userId, purpose: 'discord-oauth' }, process.env.JWT_SECRET, { expiresIn: '5m' })
}

describe('GET /api/discord/callback', () => {
  let token
  let oauthState
  let userId
  let testEmail

  beforeEach(async () => {
    testEmail = `discord-link-${Date.now()}-${Math.random()}@example.com`
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'password123' })
    token = reg.body.token
    userId = db.prepare('SELECT id FROM users WHERE email = ?').get(testEmail).id
    oauthState = signOAuthState(userId)

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
      .query({ code: 'auth-code-abc', state: oauthState })

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
      .query({ code: 'auth-code-def', state: oauthState })

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

  it('purposeがdiscord-oauthでない通常セッションJWTをstateに使うと401', async () => {
    const res = await request(app)
      .get('/api/discord/callback')
      .query({ code: 'auth-code-abc', state: token })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/discord/oauth-state', () => {
  let token
  let testEmail

  beforeEach(async () => {
    testEmail = `discord-oauth-state-${Date.now()}-${Math.random()}@example.com`
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'password123' })
    token = reg.body.token
  })

  it('Authorizationヘッダーがなければ401', async () => {
    const res = await request(app).get('/api/discord/oauth-state')

    expect(res.status).toBe(401)
  })

  it('認証済みならJWT形式のstateを返す', async () => {
    const res = await request(app)
      .get('/api/discord/oauth-state')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(typeof res.body.state).toBe('string')
    expect(res.body.state.split('.')).toHaveLength(3)

    const payload = jwt.verify(res.body.state, process.env.JWT_SECRET)
    expect(payload.purpose).toBe('discord-oauth')
    expect(payload).toHaveProperty('userId')
  })

  it('通常のセッショントークンでも呼び出せる（oauth-state自体は通常トークンで認証する）', async () => {
    const res = await request(app)
      .get('/api/discord/oauth-state')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })
})

describe('purpose付きJWTのrequireAuthルートへの再利用防止', () => {
  let token
  let userId
  let testEmail

  beforeEach(async () => {
    testEmail = `purpose-guard-${Date.now()}-${Math.random()}@example.com`
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: testEmail, password: 'password123' })
    token = reg.body.token
    userId = db.prepare('SELECT id FROM users WHERE email = ?').get(testEmail).id
  })

  it('discord-oauth purposeトークンをBearerとして他のrequireAuthルートに使うと401', async () => {
    const oauthState = signOAuthState(userId)

    const res = await request(app)
      .get('/api/user/courses')
      .set('Authorization', `Bearer ${oauthState}`)

    expect(res.status).toBe(401)
  })

  it('通常のセッショントークンは引き続き/api/user/coursesで使える', async () => {
    const res = await request(app)
      .get('/api/user/courses')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })
})
