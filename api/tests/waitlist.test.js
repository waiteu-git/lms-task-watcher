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
