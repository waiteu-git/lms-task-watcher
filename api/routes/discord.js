const express = require('express')
const jwt = require('jsonwebtoken')
const db = require('../db/sqlite')
const discord = require('../lib/discord')
const { requireAuth } = require('../middleware/auth')

const router = express.Router()

// GET /api/discord/oauth-state
// mypage.htmlがDiscord OAuth認可URLへ遷移する直前に呼び出し、
// stateパラメータ専用の短命JWT（5分・purpose: 'discord-oauth'）を発行する。
// 既存の30日間有効なセッションJWTをstateにそのまま使うと、
// Discordのリダイレクトチェーンやアクセスログに長期有効な資格情報が
// クエリ文字列として残ってしまうため、用途を限定した使い捨てトークンを別途発行する。
router.get('/oauth-state', requireAuth, (req, res) => {
  const state = jwt.sign(
    { userId: req.userId, purpose: 'discord-oauth' },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  )

  return res.json({ state })
})

// GET /api/discord/callback
router.get('/callback', async (req, res) => {
  const { code, state } = req.query

  let payload
  try {
    payload = jwt.verify(state, process.env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: 'トークンが無効です' })
  }

  if (payload.purpose !== 'discord-oauth') {
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

    // discord_user_idはギルド参加が成立した時点で確定。ロール付与より先に保存し、
    // 万一ロール付与で失敗しても連携情報が失われないようにする。
    db.prepare('UPDATE subscriptions SET discord_user_id = ? WHERE user_id = ?').run(discordUser.id, userId)

    // joinGuildのbody内rolesは新規参加（201）時のみ適用され、既にサーバーに
    // いるメンバー（サーバー所有者・招待リンクで先に参加したベータテスター等）には
    // 適用されない。参加済みか否かに関わらずロールを確実に付与するため、
    // 冪等なassignRoleToMember（PUT .../roles/{roleId}）で明示的に付与し直す。
    for (const roleId of roleIds) {
      await discord.assignRoleToMember(discordUser.id, roleId)
    }

    return res.redirect('https://lms.waiteu.dev/mypage.html?discord=connected')
  } catch (err) {
    console.error('Discord連携に失敗:', err.message)
    return res.redirect('https://lms.waiteu.dev/mypage.html?discord=error')
  }
})

module.exports = router
