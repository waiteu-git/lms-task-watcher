const express = require('express')
const db = require('../db/sqlite')
const { requireAuth } = require('../middleware/auth')
const discord = require('../lib/discord')

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
  const row = db.prepare(
    'SELECT theme, notification_rules, notification_rules_updated_at FROM user_settings WHERE user_id = ?'
  ).get(req.userId)

  return res.json({
    theme: row?.theme ?? 'default',
    notificationRules: row?.notification_rules ? JSON.parse(row.notification_rules) : null,
    notificationRulesUpdatedAt: row?.notification_rules_updated_at ?? null,
  })
})

router.post('/settings', requireAuth, (req, res) => {
  const { theme, notificationRules, notificationRulesUpdatedAt } = req.body

  if (theme !== undefined && typeof theme !== 'string') {
    return res.status(400).json({ error: 'theme は文字列である必要があります' })
  }
  if (notificationRules !== undefined && typeof notificationRules !== 'object') {
    return res.status(400).json({ error: 'notificationRules はオブジェクトである必要があります' })
  }

  db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(req.userId)

  if (theme !== undefined) {
    db.prepare(
      "UPDATE user_settings SET theme = ?, updated_at = datetime('now') WHERE user_id = ?"
    ).run(theme, req.userId)
  }

  if (notificationRules !== undefined) {
    db.prepare(
      'UPDATE user_settings SET notification_rules = ?, notification_rules_updated_at = ? WHERE user_id = ?'
    ).run(JSON.stringify(notificationRules), notificationRulesUpdatedAt ?? new Date().toISOString(), req.userId)
  }

  return res.json({ ok: true })
})

router.post('/courses', requireAuth, (req, res) => {
  const { courses } = req.body

  if (!Array.isArray(courses)) {
    return res.status(400).json({ error: 'courses は配列である必要があります' })
  }

  const upsert = db.prepare(`
    INSERT INTO user_courses (user_id, course_id, course_name, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, course_id) DO UPDATE SET
      course_name = excluded.course_name,
      updated_at = excluded.updated_at
  `)

  const insertMany = db.transaction((rows) => {
    for (const course of rows) {
      upsert.run(req.userId, course.id, course.name)
    }
  })

  insertMany(courses)

  return res.json({ ok: true })
})

router.get('/courses', requireAuth, (req, res) => {
  const rows = db.prepare(
    `SELECT course_id as courseId, course_name as courseName, discord_role_wanted as discordRoleWanted
     FROM user_courses WHERE user_id = ?`
  ).all(req.userId)

  const courses = rows.map((row) => ({
    ...row,
    discordRoleWanted: Boolean(row.discordRoleWanted),
  }))

  return res.json({ courses })
})

router.patch('/courses/:courseId', requireAuth, async (req, res) => {
  const { courseId } = req.params
  const { discordRoleWanted } = req.body

  const courseRow = db.prepare(
    'SELECT course_name FROM user_courses WHERE user_id = ? AND course_id = ?'
  ).get(req.userId, courseId)

  if (!courseRow) {
    return res.status(404).json({ error: 'コースが見つかりません' })
  }

  db.prepare(
    `UPDATE user_courses SET discord_role_wanted = ?, updated_at = datetime('now')
     WHERE user_id = ? AND course_id = ?`
  ).run(discordRoleWanted ? 1 : 0, req.userId, courseId)

  const sub = db.prepare(
    'SELECT discord_user_id FROM subscriptions WHERE user_id = ?'
  ).get(req.userId)

  if (sub?.discord_user_id) {
    try {
      if (discordRoleWanted) {
        const { roleId } = await discord.ensureCourseRole(db, courseId, courseRow.course_name)
        await discord.assignRoleToMember(sub.discord_user_id, roleId)
      } else {
        const mapping = db.prepare(
          'SELECT discord_role_id FROM discord_course_roles WHERE course_id = ?'
        ).get(courseId)
        if (mapping) {
          await discord.removeRoleFromMember(sub.discord_user_id, mapping.discord_role_id)
        }
      }
    } catch (err) {
      console.error('Discordロール更新に失敗:', err.message)
    }
  }

  return res.json({ ok: true })
})

module.exports = router
