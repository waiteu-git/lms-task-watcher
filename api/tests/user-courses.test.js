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
