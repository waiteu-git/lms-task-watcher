import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, unknown> = {}
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {}
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const k of keyList) result[k] = store[k]
        return result
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj) }),
    },
  },
})

vi.mock('./auth', () => ({
  getAuthToken: vi.fn(),
}))

import {
  getMemo,
  saveMemo,
  getAllMemos,
  getTheme,
  saveTheme,
  syncToServer,
  getNotificationRules,
  getNotificationRulesUpdatedAt,
  saveNotificationRules,
  pullSettingsFromServer,
} from './premium'
import { getAuthToken } from './auth'

const mockGetAuthToken = vi.mocked(getAuthToken)

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
  mockGetAuthToken.mockReset()
})

describe('getMemo', () => {
  it('未保存のassignmentIdはデフォルト値を返す', async () => {
    const memo = await getMemo('assign-999')
    expect(memo).toEqual({ priority: 0, memo: '' })
  })

  it('保存したメモを返す', async () => {
    await saveMemo('assign-1', { priority: 2, memo: '重要' })
    const memo = await getMemo('assign-1')
    expect(memo).toEqual({ priority: 2, memo: '重要' })
  })
})

describe('getAllMemos', () => {
  it('メモがない場合は空オブジェクトを返す', async () => {
    expect(await getAllMemos()).toEqual({})
  })

  it('保存した全メモを返す', async () => {
    await saveMemo('assign-1', { priority: 1, memo: 'first' })
    await saveMemo('assign-2', { priority: 3, memo: 'second' })
    const all = await getAllMemos()
    expect(all).toEqual({
      'assign-1': { priority: 1, memo: 'first' },
      'assign-2': { priority: 3, memo: 'second' },
    })
  })
})

describe('getTheme / saveTheme', () => {
  it('未保存はdefaultを返す', async () => {
    expect(await getTheme()).toBe('default')
  })

  it('保存したテーマを返す', async () => {
    await saveTheme('dark')
    expect(await getTheme()).toBe('dark')
  })
})

describe('syncToServer', () => {
  it('tokenがnullのとき早期リターンしfetchを呼ばない', async () => {
    mockGetAuthToken.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await syncToServer('https://example.com')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('apiBaseUrlが空文字のとき早期リターンしfetchを呼ばない', async () => {
    mockGetAuthToken.mockResolvedValue('token-abc')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await syncToServer('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('tokenがある場合、/api/user/dataと/api/user/settingsにPOSTする', async () => {
    mockGetAuthToken.mockResolvedValue('token-abc')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await saveMemo('assign-1', { priority: 1, memo: 'test' })
    await syncToServer('https://example.com')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/user/data',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
      }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/user/settings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-abc' }),
      }),
    )
  })

  it('fetchがエラーを投げてもsyncToServerはthrowしない', async () => {
    mockGetAuthToken.mockResolvedValue('token-abc')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    await expect(syncToServer('https://example.com')).resolves.toBeUndefined()
  })

  it('notificationRulesが設定済みの場合、settingsPOSTにnotificationRulesとnotificationRulesUpdatedAtを含める', async () => {
    mockGetAuthToken.mockResolvedValue('token-abc')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const rules = { version: 1 as const, defaultThresholds: [1, 3], courseOverrides: {} }
    await saveNotificationRules(rules, '2026-07-04T12:00:00.000Z')
    await syncToServer('https://example.com')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/user/settings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          theme: 'default',
          notificationRules: rules,
          notificationRulesUpdatedAt: '2026-07-04T12:00:00.000Z',
        }),
      }),
    )
  })

  it('notificationRules未設定の場合、settingsPOSTはthemeのみ送る', async () => {
    mockGetAuthToken.mockResolvedValue('token-abc')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await syncToServer('https://example.com')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/api/user/settings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ theme: 'default' }),
      }),
    )
  })
})

describe('notification rules storage', () => {
  it('saveNotificationRules は rules と updatedAt を保存する', async () => {
    const rules = { version: 1 as const, defaultThresholds: [1, 3], courseOverrides: {} }
    await saveNotificationRules(rules, '2026-07-04T12:00:00.000Z')
    expect(await getNotificationRules()).toEqual(rules)
    expect(await getNotificationRulesUpdatedAt()).toBe('2026-07-04T12:00:00.000Z')
  })

  it('未設定なら getNotificationRules は null', async () => {
    expect(await getNotificationRules()).toBeNull()
  })

  it('未設定なら getNotificationRulesUpdatedAt は null', async () => {
    expect(await getNotificationRulesUpdatedAt()).toBeNull()
  })
})

describe('pullSettingsFromServer', () => {
  it('tokenがnullのとき早期リターンしfetchを呼ばない', async () => {
    mockGetAuthToken.mockResolvedValue(null)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await pullSettingsFromServer('https://example.com')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('apiBaseUrlが空文字のとき早期リターンしfetchを呼ばない', async () => {
    mockGetAuthToken.mockResolvedValue('token-abc')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await pullSettingsFromServer('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('サーバーが新しければローカルへ反映する', async () => {
    mockGetAuthToken.mockResolvedValue('token-abc')
    await saveNotificationRules({ version: 1, defaultThresholds: [1], courseOverrides: {} }, '2026-07-04T10:00:00.000Z')
    const serverRules = { version: 1, defaultThresholds: [1, 3, 24], courseOverrides: {} }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ theme: 'default', notificationRules: serverRules, notificationRulesUpdatedAt: '2026-07-04T20:00:00.000Z' }),
      }),
    )

    await pullSettingsFromServer('https://example.com')

    expect(await getNotificationRules()).toEqual(serverRules)
    expect(await getNotificationRulesUpdatedAt()).toBe('2026-07-04T20:00:00.000Z')
  })

  it('ローカルが新しければ保持する', async () => {
    mockGetAuthToken.mockResolvedValue('token-abc')
    const localRules = { version: 1 as const, defaultThresholds: [99], courseOverrides: {} }
    await saveNotificationRules(localRules, '2026-07-04T20:00:00.000Z')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ theme: 'default', notificationRules: { version: 1, defaultThresholds: [1], courseOverrides: {} }, notificationRulesUpdatedAt: '2026-07-04T10:00:00.000Z' }),
      }),
    )

    await pullSettingsFromServer('https://example.com')

    expect(await getNotificationRules()).toEqual(localRules)
  })

  it('ローカル未設定でもサーバーの値を反映する', async () => {
    mockGetAuthToken.mockResolvedValue('token-abc')
    const serverRules = { version: 1 as const, defaultThresholds: [2], courseOverrides: {} }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ theme: 'default', notificationRules: serverRules, notificationRulesUpdatedAt: '2026-07-04T20:00:00.000Z' }),
      }),
    )

    await pullSettingsFromServer('https://example.com')

    expect(await getNotificationRules()).toEqual(serverRules)
  })

  it('fetchがエラーを投げてもpullSettingsFromServerはthrowしない', async () => {
    mockGetAuthToken.mockResolvedValue('token-abc')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    await expect(pullSettingsFromServer('https://example.com')).resolves.toBeUndefined()
  })
})
