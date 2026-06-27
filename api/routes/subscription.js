const express = require('express')
const db = require('../db/sqlite')
const { requireAuth } = require('../middleware/auth')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const router = express.Router()

// GET /api/subscription/status
router.get('/status', requireAuth, (req, res) => {
  const sub = db.prepare(
    'SELECT status, current_period_end FROM subscriptions WHERE user_id = ?'
  ).get(req.userId)

  if (!sub) {
    return res.status(404).json({ error: 'サブスクリプション情報が見つかりません' })
  }

  return res.json({
    status: sub.status,
    currentPeriodEnd: sub.current_period_end ?? null,
  })
})

// POST /api/subscription/checkout
router.post('/checkout', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(req.userId)

  if (!user) {
    return res.status(404).json({ error: 'ユーザーが見つかりません' })
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${process.env.API_BASE_URL}/checkout-success`,
      cancel_url: `${process.env.API_BASE_URL}/checkout-cancel`,
    })

    return res.json({ url: session.url })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'チェックアウトセッションの作成に失敗しました' })
  }
})

// POST /api/subscription/cancel
router.post('/cancel', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

module.exports = router
