const DISCORD_API_BASE = 'https://discord.com/api/v10'

function botHeaders() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

async function exchangeOAuthCode(code) {
  const res = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
    }),
  })

  if (!res.ok) {
    throw new Error(`Discord token exchange failed: ${res.status}`)
  }

  return res.json()
}

async function getDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    throw new Error(`Discord user fetch failed: ${res.status}`)
  }

  return res.json()
}

async function joinGuild(discordUserId, accessToken, roleIds) {
  const res = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}`,
    {
      method: 'PUT',
      headers: botHeaders(),
      body: JSON.stringify({ access_token: accessToken, roles: roleIds }),
    }
  )

  if (!res.ok && res.status !== 204) {
    throw new Error(`Discord guild join failed: ${res.status}`)
  }
}

async function kickMember(discordUserId) {
  const res = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}`,
    {
      method: 'DELETE',
      headers: botHeaders(),
    }
  )

  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`Discord kick failed: ${res.status}`)
  }
}

async function createCourseRoleAndChannel(courseName) {
  const roleRes = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/roles`,
    {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({ name: courseName }),
    }
  )

  if (!roleRes.ok) {
    throw new Error(`Discord role create failed: ${roleRes.status}`)
  }

  const role = await roleRes.json()

  const channelRes = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/channels`,
    {
      method: 'POST',
      headers: botHeaders(),
      body: JSON.stringify({
        name: courseName,
        type: 0,
        permission_overwrites: [
          { id: process.env.DISCORD_GUILD_ID, type: 0, deny: '1024' },
          { id: role.id, type: 0, allow: '3072' },
        ],
      }),
    }
  )

  if (!channelRes.ok) {
    throw new Error(`Discord channel create failed: ${channelRes.status}`)
  }

  const channel = await channelRes.json()

  return { roleId: role.id, channelId: channel.id }
}

async function assignRoleToMember(discordUserId, roleId) {
  const res = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
    { method: 'PUT', headers: botHeaders() }
  )

  if (!res.ok && res.status !== 204) {
    throw new Error(`Discord role assign failed: ${res.status}`)
  }
}

async function removeRoleFromMember(discordUserId, roleId) {
  const res = await fetch(
    `${DISCORD_API_BASE}/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUserId}/roles/${roleId}`,
    { method: 'DELETE', headers: botHeaders() }
  )

  if (!res.ok && res.status !== 204) {
    throw new Error(`Discord role remove failed: ${res.status}`)
  }
}

async function ensureCourseRole(db, courseId, courseName) {
  const existing = db.prepare(
    'SELECT discord_role_id, discord_channel_id FROM discord_course_roles WHERE course_id = ?'
  ).get(courseId)

  if (existing) {
    return { roleId: existing.discord_role_id, channelId: existing.discord_channel_id }
  }

  const { roleId, channelId } = await createCourseRoleAndChannel(courseName)

  db.prepare(
    'INSERT INTO discord_course_roles (course_id, course_name, discord_role_id, discord_channel_id) VALUES (?, ?, ?, ?)'
  ).run(courseId, courseName, roleId, channelId)

  return { roleId, channelId }
}

module.exports = {
  exchangeOAuthCode,
  getDiscordUser,
  joinGuild,
  kickMember,
  createCourseRoleAndChannel,
  assignRoleToMember,
  removeRoleFromMember,
  ensureCourseRole,
}
