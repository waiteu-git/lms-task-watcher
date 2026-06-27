import { describe, it, expect, vi, beforeEach } from 'vitest'

// chrome.storage.local のモック
const store: Record<string, unknown> = {}
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string[]) => {
        const result: Record<string, unknown> = {}
        for (const k of keys) result[k] = store[k]
        return result
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(store, obj)
      }),
      remove: vi.fn(async (keys: string[]) => {
        for (const k of keys) delete store[k]
      }),
    },
  },
})

import {
  getAuthToken,
  saveAuthSession,
  clearAuthSession,
  isSubscriptionActive,
  saveSubscriptionCache,
} from './auth'

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
})

describe('getAuthToken', () => {
  it('トークンが未保存のときはnullを返す', async () => {
    expect(await getAuthToken()).toBeNull()
  })

  it('保存したトークンを返す', async () => {
    await saveAuthSession('my-token', new Date(Date.now() + 86400000).toISOString())
    expect(await getAuthToken()).toBe('my-token')
  })

  it('期限切れトークンはnullを返す', async () => {
    await saveAuthSession('expired', new Date(Date.now() - 1000).toISOString())
    expect(await getAuthToken()).toBeNull()
  })
})

describe('isSubscriptionActive', () => {
  it('キャッシュがない場合はfalseを返す', async () => {
    expect(await isSubscriptionActive()).toBe(false)
  })

  it('activeかつキャッシュ有効期間内はtrueを返す', async () => {
    const checkedAt = new Date(Date.now() - 1000).toISOString()
    await saveSubscriptionCache('active', null)
    store['subscriptionCheckedAt'] = checkedAt
    expect(await isSubscriptionActive()).toBe(true)
  })

  it('activeだがキャッシュが7日超過+グレース期間内はtrueを返す', async () => {
    const checkedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    store['subscriptionStatus'] = 'active'
    store['subscriptionCheckedAt'] = checkedAt
    store['subscriptionGraceUntil'] = new Date(Date.now() + 86400000).toISOString()
    expect(await isSubscriptionActive()).toBe(true)
  })

  it('グレース期間も超過した場合はfalseを返す', async () => {
    store['subscriptionStatus'] = 'active'
    store['subscriptionCheckedAt'] = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
    store['subscriptionGraceUntil'] = new Date(Date.now() - 1000).toISOString()
    expect(await isSubscriptionActive()).toBe(false)
  })
})
