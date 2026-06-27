const express = require('express')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const db = require('../db/sqlite')

const router = express.Router()

router.post('/stripe', (req, res) => {
  const sig = req.headers['stripe-signature']
  let event

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message)
    return res.status(400).json({ error: `Webhook Error: ${err.message}` })
  }

  const obj = event.data.object

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const periodEnd = new Date(obj.current_period_end * 1000).toISOString()
      db.prepare(`
        UPDATE subscriptions
        SET status = ?, stripe_subscription_id = ?, current_period_end = ?, updated_at = datetime('now')
        WHERE stripe_customer_id = ?
      `).run(obj.status === 'active' ? 'active' : 'inactive', obj.id, periodEnd, obj.customer)
      break
    }

    case 'customer.subscription.deleted': {
      db.prepare(`
        UPDATE subscriptions
        SET status = 'inactive', current_period_end = NULL, updated_at = datetime('now')
        WHERE stripe_customer_id = ?
      `).run(obj.customer)
      break
    }

    case 'checkout.session.completed': {
      if (obj.mode === 'subscription') {
        db.prepare(`
          UPDATE subscriptions
          SET stripe_customer_id = ?, updated_at = datetime('now')
          WHERE user_id = (
            SELECT id FROM users WHERE email = ?
          )
        `).run(obj.customer, obj.customer_email)
      }
      break
    }

    default:
      break
  }

  return res.json({ received: true })
})

module.exports = router
