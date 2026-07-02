process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'

const request = require('supertest')
const app = require('../server')

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
      .send({ email: 'login@example.com', password: 'correct1' })
  })

  it('正しいパスワードでログインできる', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'correct1' })
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
