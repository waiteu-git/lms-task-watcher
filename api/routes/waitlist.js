const express = require('express')
const db = require('../db/sqlite')

const router = express.Router()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// 単一プロセス想定の軽量インメモリレート制限（60秒に5件超で拒否）
const WINDOW_MS = 60 * 1000
const MAX_PER_WINDOW = 5
const hits = new Map()

function rateLimited(ip) {
  const now = Date.now()
  const rec = hits.get(ip)
  if (!rec || now - rec.start > WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 })
    return false
  }
  rec.count += 1
  return rec.count > MAX_PER_WINDOW
}

router.post('/', (req, res) => {
  const { email, source, website } = req.body || {}

  // honeypot: 隠しフィールドに値があればbot。黙って成功を返す。
  if (website) {
    return res.status(200).json({ ok: true })
  }

  if (process.env.NODE_ENV !== 'test' && rateLimited(req.ip)) {
    return res.status(429).json({ error: 'リクエストが多すぎます。時間をおいて再度お試しください。' })
  }

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: '有効なメールアドレスを入力してください' })
  }

  try {
    db.prepare(
      'INSERT OR IGNORE INTO waitlist (email, source) VALUES (?, ?)'
    ).run(
      email.trim().toLowerCase(),
      typeof source === 'string' && source ? source : 'app-landing'
    )
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'サーバーエラーが発生しました' })
  }
})

module.exports = router
