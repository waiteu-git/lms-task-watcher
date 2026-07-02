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


app.get("/checkout-success", (_req, res) => { res.send('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>決済完了</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0fdf4}div{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{color:#16a34a;margin-bottom:8px}p{color:#6b7280;font-size:14px}</style></head><body><div><h1>✓ 決済が完了しました</h1><p>このタブは閉じて構いません。<br>拡張機能を再度開くとプレミアム機能が使えるようになります。</p></div></body></html>') })

app.get("/checkout-cancel", (_req, res) => { res.send('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>キャンセル</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa}div{text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.08)}h1{color:#6b7280;margin-bottom:8px}p{color:#9ca3af;font-size:14px}</style></head><body><div><h1>決済をキャンセルしました</h1><p>このタブは閉じて構いません。</p></div></body></html>') })

module.exports = app
