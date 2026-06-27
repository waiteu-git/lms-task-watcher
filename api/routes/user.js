const express = require('express')
const router = express.Router()

// GET /api/user/data
router.get('/data', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// PUT /api/user/data
router.put('/data', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// GET /api/user/settings
router.get('/settings', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// PUT /api/user/settings
router.put('/settings', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

module.exports = router
