process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'

const mockCreatePortalSession = jest.fn()

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    billingPortal: {
      sessions: { create: mockCreatePortalSession },
    },
  }))
})

const request = require('supertest')
const app = require('../server')
const db = require('../db/sqlite')

describe('POST /api/subscription/billing-portal', () => {
  afterEach(() => {
    mockCreatePortalSession.mockReset()
  })

  it('stripe_customer_idがあればポータルURLを返す', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'portal-user@example.com', password: 'password123' })
    const token = reg.body.token

    db.prepare(
      "UPDATE subscriptions SET stripe_customer_id = 'cus_test123' WHERE user_id = (SELECT id FROM users WHERE email = 'portal-user@example.com')"
    ).run()

    mockCreatePortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/test123' })

    const res = await request(app)
      .post('/api/subscription/billing-portal')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://billing.stripe.com/session/test123')
    expect(mockCreatePortalSession).toHaveBeenCalledWith({
      customer: 'cus_test123',
      return_url: 'https://lms.waiteu.dev/mypage.html',
    })
  })

  it('stripe_customer_idが無ければ404', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'no-customer@example.com', password: 'password123' })
    const token = reg.body.token

    const res = await request(app)
      .post('/api/subscription/billing-portal')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('トークンなしでは401', async () => {
    const res = await request(app).post('/api/subscription/billing-portal')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/subscription/status hasStripeCustomer', () => {
  it('stripe_customer_idがあればhasStripeCustomer: trueを返す（statusに関わらず）', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'past-payer@example.com', password: 'password123' })
    const token = reg.body.token

    db.prepare(
      "UPDATE subscriptions SET stripe_customer_id = 'cus_cancelled', status = 'inactive' WHERE user_id = (SELECT id FROM users WHERE email = 'past-payer@example.com')"
    ).run()

    const res = await request(app)
      .get('/api/subscription/status')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('inactive')
    expect(res.body.hasStripeCustomer).toBe(true)
  })

  it('stripe_customer_idが無ければhasStripeCustomer: falseを返す', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'never-paid@example.com', password: 'password123' })
    const token = reg.body.token

    const res = await request(app)
      .get('/api/subscription/status')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.hasStripeCustomer).toBe(false)
  })
})
