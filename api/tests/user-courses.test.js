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

describe('PATCH /api/user/courses/:courseId', () => {
  const discordLib = require('../lib/discord')
  const db = require('../db/sqlite')

  beforeEach(() => {
    jest.spyOn(discordLib, 'ensureCourseRole').mockImplementation(async (database, courseId, courseName) => {
      database.prepare(
        'INSERT INTO discord_course_roles (course_id, course_name, discord_role_id, discord_channel_id) VALUES (?, ?, ?, ?)'
      ).run(courseId, courseName, 'role-1', 'channel-1')
      return { roleId: 'role-1', channelId: 'channel-1' }
    })
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
