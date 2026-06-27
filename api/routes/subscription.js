const express = require('express')
const router = express.Router()

// GET /api/subscription/status
router.get('/status', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
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
