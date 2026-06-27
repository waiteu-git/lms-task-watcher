const express = require('express')
const router = express.Router()

// POST /api/auth/register
router.post('/register', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// POST /api/auth/login
router.post('/login', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// POST /api/auth/logout
router.post('/logout', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

module.exports = router
