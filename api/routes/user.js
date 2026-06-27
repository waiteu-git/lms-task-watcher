const express = require('express')
const db = require('../db/sqlite')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

router.get('/data', requireAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT assignment_id as assignmentId, priority, memo, updated_at as updatedAt FROM user_data WHERE user_id = ?'
  ).all(req.userId)

  return res.json({ data: rows })
})

router.post('/data', requireAuth, (req, res) => {
  const { items } = req.body

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items は配列である必要があります' })
  }

  const upsert = db.prepare(`
    INSERT INTO user_data (user_id, assignment_id, priority, memo, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, assignment_id) DO UPDATE SET
      priority = excluded.priority,
      memo = excluded.memo,
      updated_at = excluded.updated_at
  `)

  const insertMany = db.transaction((rows) => {
    for (const item of rows) {
      upsert.run(req.userId, item.assignmentId, item.priority ?? 0, item.memo ?? '')
    }
  })

  insertMany(items)

  return res.json({ ok: true })
})

router.get('/settings', requireAuth, (req, res) => {
  const settings = db.prepare(
    'SELECT theme FROM user_settings WHERE user_id = ?'
  ).get(req.userId)

  return res.json({ theme: settings?.theme ?? 'default' })
})

router.post('/settings', requireAuth, (req, res) => {
  const { theme } = req.body

  if (!theme || typeof theme !== 'string') {
    return res.status(400).json({ error: 'theme が必要です' })
  }

  db.prepare(`
    INSERT INTO user_settings (user_id, theme, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      theme = excluded.theme,
      updated_at = excluded.updated_at
  `).run(req.userId, theme)

  return res.json({ ok: true })
})

module.exports = router
