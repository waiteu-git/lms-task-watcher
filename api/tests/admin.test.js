process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'
process.env.ADMIN_PASSWORD = 'test-admin-pass'

const request = require('supertest')
const app = require('../server')
const db = require('../db/sqlite')

function basic(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
}

describe('GET /api/admin/waitlist', () => {
  beforeAll(() => {
    db.prepare('INSERT OR IGNORE INTO waitlist (email, source) VALUES (?, ?)').run(
      'admin-test@example.com',
      'app-landing'
    )
  })

  it('認証なしは401でBasic認証を要求する', async () => {
    const res = await request(app).get('/api/admin/waitlist')
    expect(res.status).toBe(401)
    expect(res.headers['www-authenticate']).toMatch(/Basic/)
  })

  it('誤ったパスワードは401', async () => {
    const res = await request(app)
      .get('/api/admin/waitlist')
      .set('Authorization', basic('admin', 'wrong-pass'))
    expect(res.status).toBe(401)
  })

  it('正しいパスワードで一覧HTMLが返る（登録メールを含む）', async () => {
    const res = await request(app)
      .get('/api/admin/waitlist')
      .set('Authorization', basic('admin', 'test-admin-pass'))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toContain('admin-test@example.com')
  })
})
