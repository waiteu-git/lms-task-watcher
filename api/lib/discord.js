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

module.exports = {
  exchangeOAuthCode,
  getDiscordUser,
  joinGuild,
  kickMember,
}
