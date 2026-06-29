require('dotenv').config()
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')

const authRoutes = require('./routes/auth')
const subscriptionRoutes = require('./routes/subscription')
const userRoutes = require('./routes/user')
const webhookRoutes = require('./routes/webhook')
const deviceRoutes = require('./routes/device')

const app = express()

// Stripe webhookはraw bodyが必要なので先に登録
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRoutes)

app.use(helmet())
app.use(cors({
  origin: [
    'https://api.waiteu.dev',
    /^chrome-extension:\/\//,
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/subscription', subscriptionRoutes)
app.use('/api/user', userRoutes)
app.use('/api/device', deviceRoutes)

app.get('/health', (_req, res) => res.json({ ok: true }))

const PORT = process.env.PORT || 3000

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

module.exports = app
