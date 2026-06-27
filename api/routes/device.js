const express = require('express')
const router = express.Router()

// POST /api/device/register
// Phase 3: push notification device registration (not yet implemented)
router.post('/register', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

// DELETE /api/device/:id
// Phase 3: unregister a device
router.delete('/:id', (_req, res) => {
  res.status(501).json({ error: 'Not implemented' })
})

module.exports = router
