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
  createCourseRoleAndChannel,
  assignRoleToMember,
  removeRoleFromMember,
  ensureCourseRole,
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

describe('createCourseRoleAndChannel', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('ロールとチャンネルを作成し、両方のidを返す', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'role-abc' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'channel-xyz' }) })

    const result = await createCourseRoleAndChannel('物理学A1')

    expect(result).toEqual({ roleId: 'role-abc', channelId: 'channel-xyz' })

    const roleCall = global.fetch.mock.calls[0]
    expect(roleCall[0]).toBe('https://discord.com/api/v10/guilds/test-guild-id/roles')
    expect(JSON.parse(roleCall[1].body)).toEqual({ name: '物理学A1' })

    const channelCall = global.fetch.mock.calls[1]
    expect(channelCall[0]).toBe('https://discord.com/api/v10/guilds/test-guild-id/channels')
    const channelBody = JSON.parse(channelCall[1].body)
    expect(channelBody.name).toBe('物理学A1')
    expect(channelBody.type).toBe(0)
    expect(channelBody.permission_overwrites).toEqual([
      { id: 'test-guild-id', type: 0, deny: '1024' },
      { id: 'role-abc', type: 0, allow: '3072' },
      // Bot自身(member override)に閲覧権を付与し、自作チャンネルの管理権を保持する
      { id: 'test-client-id', type: 1, allow: '1024' },
    ])
    // カテゴリ未設定時はparent_idを付けない（トップレベルに作成）
    expect(channelBody.parent_id).toBeUndefined()
  })

  it('DISCORD_COURSE_CATEGORY_ID設定時はチャンネルをそのカテゴリ配下に作る', async () => {
    process.env.DISCORD_COURSE_CATEGORY_ID = 'category-123'
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'role-abc' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'channel-xyz' }) })

    await createCourseRoleAndChannel('物理学A1')

    const channelBody = JSON.parse(global.fetch.mock.calls[1][1].body)
    expect(channelBody.parent_id).toBe('category-123')

    delete process.env.DISCORD_COURSE_CATEGORY_ID
  })
})

describe('assignRoleToMember / removeRoleFromMember', () => {
  afterEach(() => {
    global.fetch.mockRestore?.()
  })

  it('ロール付与はPUT /members/{id}/roles/{roleId}', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 })

    await assignRoleToMember('discord-user-1', 'role-abc')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/test-guild-id/members/discord-user-1/roles/role-abc',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('ロール剥奪はDELETE /members/{id}/roles/{roleId}', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 })

    await removeRoleFromMember('discord-user-1', 'role-abc')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/test-guild-id/members/discord-user-1/roles/role-abc',
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})

describe('ensureCourseRole', () => {
  const Database = require('better-sqlite3')
  let db

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE discord_course_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id TEXT NOT NULL UNIQUE,
        course_name TEXT NOT NULL,
        discord_role_id TEXT NOT NULL,
        discord_channel_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  })

  afterEach(() => {
    global.fetch.mockRestore?.()
    db.close()
  })

  it('既存のマッピングがあればDiscord APIを呼ばずそれを返す', async () => {
    db.prepare(
      'INSERT INTO discord_course_roles (course_id, course_name, discord_role_id, discord_channel_id) VALUES (?, ?, ?, ?)'
    ).run('course-1', '物理学A1', 'existing-role', 'existing-channel')

    global.fetch = jest.fn()

    const result = await ensureCourseRole(db, 'course-1', '物理学A1')

    expect(result).toEqual({ roleId: 'existing-role', channelId: 'existing-channel' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('マッピングが無ければ作成してDBに保存する', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'new-role' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'new-channel' }) })

    const result = await ensureCourseRole(db, 'course-2', '化学実験')

    expect(result).toEqual({ roleId: 'new-role', channelId: 'new-channel' })

    const row = db.prepare('SELECT * FROM discord_course_roles WHERE course_id = ?').get('course-2')
    expect(row.discord_role_id).toBe('new-role')
    expect(row.discord_channel_id).toBe('new-channel')
  })
})
