const express = require('express')
const router = express.Router()

// POST /api/webhook
// Stripe webhook — receives raw body (configured in server.js before JSON middleware)
router.post('/', (req, res) => {
  // Raw body is available as req.body (Buffer) here
  // Signature verification and event handling will be implemented in a later task
  res.status(200).json({ received: true })
})

module.exports = router
