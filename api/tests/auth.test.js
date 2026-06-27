process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'

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
