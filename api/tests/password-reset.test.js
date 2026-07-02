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
