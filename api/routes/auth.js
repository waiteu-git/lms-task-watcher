const express = require('express')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('../db/sqlite')

const router = express.Router()
const SALT_ROUNDS = 10
const TOKEN_EXPIRY_DAYS = 30

function generateToken(userId, email) {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + TOKEN_EXPIRY_DAYS)

  const token = jwt.sign(
    { userId, email },
    process.env.JWT_SECRET,
    { expiresIn: `${TOKEN_EXPIRY_DAYS}d` }
  )

  return { token, expiresAt: expiresAt.toISOString() }
}

router.post('/register', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'メールアドレスとパスワードが必要です' })
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)
    const insertUserWithSub = db.transaction((em, hash) => {
      const r = db.prepare(
        'INSERT INTO users (email, password_hash) VALUES (?, ?)'
      ).run(em, hash)
      db.prepare(
        'INSERT INTO subscriptions (user_id) VALUES (?)'
      ).run(r.lastInsertRowid)
      return r
    })
    const result = insertUserWithSub(email, passwordHash)

    const { token, expiresAt } = generateToken(result.lastInsertRowid, email)
    return res.status(201).json({ token, expiresAt })
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'このメールアドレスはすでに登録されています' })
    }
    console.error(err)
    return res.status(500).json({ error: 'サーバーエラーが発生しました' })
  }
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'メールアドレスとパスワードが必要です' })
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)

  if (!user) {
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' })
  }

  const match = await bcrypt.compare(password, user.password_hash)

  if (!match) {
    return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' })
  }

  const { token, expiresAt } = generateToken(user.id, user.email)
  return res.json({ token, expiresAt })
})

router.post('/refresh', (req, res) => {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({ error: 'トークンが必要です' })
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true })
    const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(payload.userId)

    if (!user) {
      return res.status(401).json({ error: 'ユーザーが見つかりません' })
    }

    const { token: newToken, expiresAt } = generateToken(user.id, user.email)
    return res.json({ token: newToken, expiresAt })
  } catch {
    return res.status(401).json({ error: 'トークンが無効です' })
  }
})

module.exports = router
