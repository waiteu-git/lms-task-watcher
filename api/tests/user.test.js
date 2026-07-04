process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'

const request = require('supertest')
const app = require('../server')

let token

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ email: 'user@example.com', password: 'password123' })
  token = res.body.token
})

describe('POST /api/user/data', () => {
  it('メモと優先度を保存できる', async () => {
    const res = await request(app)
      .post('/api/user/data')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ assignmentId: 'assign-1', priority: 2, memo: 'テストメモ' }] })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('GET /api/user/data', () => {
  it('保存したメモを取得できる', async () => {
    await request(app)
      .post('/api/user/data')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ assignmentId: 'assign-2', priority: 1, memo: '確認済み' }] })

    const res = await request(app)
      .get('/api/user/data')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data.some(d => d.assignmentId === 'assign-2')).toBe(true)
  })
})

describe('POST /api/user/settings', () => {
  it('テーマを保存できる', async () => {
    const res = await request(app)
      .post('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'dark' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('GET /api/user/settings', () => {
  it('保存したテーマを取得できる', async () => {
    await request(app)
      .post('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'dark' })

    const res = await request(app)
      .get('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.theme).toBe('dark')
  })
})

describe('POST/GET /api/user/settings 通知ルール', () => {
  it('notificationRules と updatedAt をラウンドトリップする', async () => {
    const rules = { version: 1, defaultThresholds: [1, 3, 24, 48], courseOverrides: {} }
    const postRes = await request(app)
      .post('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ notificationRules: rules, notificationRulesUpdatedAt: '2026-07-04T10:00:00.000Z' })
    expect(postRes.status).toBe(200)

    const getRes = await request(app)
      .get('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.status).toBe(200)
    expect(getRes.body.notificationRules).toEqual(rules)
    expect(getRes.body.notificationRulesUpdatedAt).toBe('2026-07-04T10:00:00.000Z')
  })

  it('theme のみの POST では notification_rules_updated_at が変わらない', async () => {
    await request(app)
      .post('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ notificationRules: { version: 1, defaultThresholds: [1], courseOverrides: {} }, notificationRulesUpdatedAt: '2026-07-04T09:00:00.000Z' })

    await request(app)
      .post('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ theme: 'dark' })

    const getRes = await request(app)
      .get('/api/user/settings')
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.body.notificationRulesUpdatedAt).toBe('2026-07-04T09:00:00.000Z')
    expect(getRes.body.theme).toBe('dark')
  })
})
