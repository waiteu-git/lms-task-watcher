const express = require('express')
const db = require('../db/sqlite')
const { requireAuth } = require('../middleware/auth')

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
router.post('/checkout', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// POST /api/subscription/cancel
router.post('/cancel', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

module.exports = router
