process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.STRIPE_PRICE_ID = 'price_m'
process.env.STRIPE_PRICE_HALFYEAR = 'price_h'
process.env.STRIPE_PRICE_YEAR = 'price_y'
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'

const mockCreatePortalSession = jest.fn()
const mockCreate = jest.fn()

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    billingPortal: {
      sessions: { create: mockCreatePortalSession },
    },
    checkout: {
      sessions: { create: mockCreate },
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

describe('POST /api/subscription/checkout plan分岐', () => {
  let token

  beforeAll(async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ email: 'plan-user@example.com', password: 'password123' })
    token = reg.body.token
  })

  afterEach(() => {
    mockCreate.mockReset()
  })

  it('plan=halfyear で mode:payment と pass_months=6 でセッション作成', async () => {
    mockCreate.mockResolvedValue({ url: 'https://stripe/pay' })
    const res = await request(app)
      .post('/api/subscription/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'halfyear' })
    expect(res.status).toBe(200)
    const arg = mockCreate.mock.calls.at(-1)[0]
    expect(arg.mode).toBe('payment')
    expect(arg.metadata.pass_months).toBe(6)
    // デフォルトはカードのみ（PayPay承認後にenvで追加）
    expect(arg.payment_method_types).toEqual(['card'])
  })

  it('plan=year で pass_months=12', async () => {
    mockCreate.mockResolvedValue({ url: 'u' })
    await request(app).post('/api/subscription/checkout')
      .set('Authorization', `Bearer ${token}`).send({ plan: 'year' })
    expect(mockCreate.mock.calls.at(-1)[0].metadata.pass_months).toBe(12)
  })

  it('plan未指定は mode:subscription（後方互換）', async () => {
    mockCreate.mockResolvedValue({ url: 'u' })
    await request(app).post('/api/subscription/checkout')
      .set('Authorization', `Bearer ${token}`).send({})
    expect(mockCreate.mock.calls.at(-1)[0].mode).toBe('subscription')
  })

  it('不正な plan は 400', async () => {
    const res = await request(app).post('/api/subscription/checkout')
      .set('Authorization', `Bearer ${token}`).send({ plan: 'bogus' })
    expect(res.status).toBe(400)
  })
})
