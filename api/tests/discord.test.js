process.env.DB_PATH = ':memory:'
process.env.DISCORD_CLIENT_ID = 'test-client-id'
process.env.DISCORD_CLIENT_SECRET = 'test-client-secret'
process.env.DISCORD_BOT_TOKEN = 'test-bot-token'
process.env.DISCORD_GUILD_ID = 'test-guild-id'
process.env.DISCORD_REDIRECT_URI = 'https://api.waiteu.dev/api/discord/callback'

const {
  exchangeOAuthCode,
  getDiscordUser,
  joinGuild,
  kickMember,
} = require('../lib/discord')

describe('exchangeOAuthCode', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('正しいbodyでトークンエンドポイントを呼び、access_tokenを返す', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'discord-access-token' }),
    })

    const result = await exchangeOAuthCode('auth-code-123')

    expect(result.access_token).toBe('discord-access-token')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/oauth2/token',
      expect.objectContaining({ method: 'POST' })
    )
    const callBody = global.fetch.mock.calls[0][1].body
    expect(callBody.toString()).toContain('code=auth-code-123')
  })

  it('失敗レスポンスなら例外を投げる', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 })

    await expect(exchangeOAuthCode('bad-code')).rejects.toThrow()
  })
})

describe('getDiscordUser', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('Bearerトークンでユーザー情報を取得する', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'discord-user-1' }),
    })

    const result = await getDiscordUser('user-access-token')

    expect(result.id).toBe('discord-user-1')
    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/users/@me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer user-access-token' },
      })
    )
  })
})

describe('joinGuild', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('Bot認証でギルド参加APIを呼ぶ', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201 })

    await joinGuild('discord-user-1', 'user-access-token', ['role-1'])

    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/test-guild-id/members/discord-user-1',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bot test-bot-token' }),
      })
    )
    const callBody = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(callBody).toEqual({ access_token: 'user-access-token', roles: ['role-1'] })
  })
})

describe('kickMember', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('Bot認証でメンバーを削除する', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 })

    await kickMember('discord-user-1')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/test-guild-id/members/discord-user-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bot test-bot-token' }),
      })
    )
  })

  it('404（既に居ない）はエラーにしない', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 })

    await expect(kickMember('gone-user')).resolves.toBeUndefined()
  })
})
