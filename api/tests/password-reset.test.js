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
