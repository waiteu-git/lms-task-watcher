process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxxxx'
process.env.DB_PATH = ':memory:'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.RESEND_API_KEY = 'test-api-key'
process.env.RESEND_FROM_EMAIL = 'noreply@waiteu.dev'

// Stripeのwebhook署名検証をモックする
// constructEventを共有モック関数にして、テストから制御できるようにする
const mockConstructEvent = jest.fn()

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: mockConstructEvent
    }
  }))
})

const request = require('supertest')
const app = require('../server')
const db = require('../db/sqlite')

describe('POST /api/webhook/stripe', () => {
  let userId

  beforeAll(() => {
    const result = db.prepare(
      "INSERT INTO users (email, password_hash) VALUES ('hook@example.com', 'hash')"
    ).run()
    userId = result.lastInsertRowid
    db.prepare('INSERT INTO subscriptions (user_id, stripe_customer_id) VALUES (?, ?)').run(userId, 'cus_test')
  })

  afterEach(() => {
    mockConstructEvent.mockReset()
  })

  it('customer.subscription.updated で status が active に更新される', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          customer: 'cus_test',
          id: 'sub_test',
          status: 'active',
          current_period_end: 1800000000
        }
      }
    })

    const res = await request(app)
      .post('/api/webhook/stripe')
      .set('stripe-signature', 'test-sig')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)

    const sub = db.prepare('SELECT status FROM subscriptions WHERE user_id = ?').get(userId)
    expect(sub.status).toBe('active')
  })

  it('customer.subscription.deleted で status が inactive に更新される', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          customer: 'cus_test'
        }
      }
    })

    const res = await request(app)
      .post('/api/webhook/stripe')
      .set('stripe-signature', 'test-sig')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)

    const sub = db.prepare('SELECT status FROM subscriptions WHERE user_id = ?').get(userId)
    expect(sub.status).toBe('inactive')
  })

  it('checkout.session.completed で stripe_customer_id が更新される', async () => {
    // 新規ユーザーを追加しcustomer_idなしのsubscriptionを作成
    const result2 = db.prepare(
      "INSERT INTO users (email, password_hash) VALUES ('checkout@example.com', 'hash')"
    ).run()
    const userId2 = result2.lastInsertRowid
    db.prepare('INSERT INTO subscriptions (user_id) VALUES (?)').run(userId2)

    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          customer: 'cus_new',
          customer_email: 'checkout@example.com'
        }
      }
    })

    const res = await request(app)
      .post('/api/webhook/stripe')
      .set('stripe-signature', 'test-sig')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)

    const sub = db.prepare('SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?').get(userId2)
    expect(sub.stripe_customer_id).toBe('cus_new')
  })

  it('署名検証失敗で 400 を返す', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload')
    })

    const res = await request(app)
      .post('/api/webhook/stripe')
      .set('stripe-signature', 'bad-sig')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(400)
  })
})
