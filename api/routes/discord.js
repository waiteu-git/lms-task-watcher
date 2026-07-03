const express = require('express')
const jwt = require('jsonwebtoken')
const db = require('../db/sqlite')
const discord = require('../lib/discord')

const router = express.Router()

// GET /api/discord/callback
// Discord OAuth2のstateパラメータにJWTをそのまま渡す方式を採る
// （mypage.htmlがOAuth認可URLへ遷移する際、state=<現在のauthToken>を付与する）
router.get('/callback', async (req, res) => {
  const { code, state } = req.query

  let payload
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'トークンが無効です' })
  }

  const userId = payload.userId

  try {
    const { access_token: discordAccessToken } = await discord.exchangeOAuthCode(code)
    const discordUser = await discord.getDiscordUser(discordAccessToken)

    const wantedCourses = db.prepare(
      'SELECT course_id, course_name FROM user_courses WHERE user_id = ? AND discord_role_wanted = 1'
    ).all(userId)

    const roleIds = [process.env.DISCORD_SUBSCRIBER_ROLE_ID]
    for (const course of wantedCourses) {
      const { roleId } = await discord.ensureCourseRole(db, course.course_id, course.course_name)
      roleIds.push(roleId)
    }

    await discord.joinGuild(discordUser.id, discordAccessToken, roleIds)

    db.prepare('UPDATE subscriptions SET discord_user_id = ? WHERE user_id = ?').run(discordUser.id, userId)

    return res.redirect('https://lms.waiteu.dev/mypage.html?discord=connected')
  } catch (err) {
    console.error('Discord連携に失敗:', err.message)
    return res.redirect('https://lms.waiteu.dev/mypage.html?discord=error')
  }
})

module.exports = router
