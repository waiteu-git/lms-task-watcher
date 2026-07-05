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
      remove: vi.fn(async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys]
        for (const k of keyList) delete store[k]
      }),
    },
  },
})

import {
  getBetaSubscriptionOverride,
  setBetaSubscriptionOverride,
  clearBetaSubscriptionOverride,
  resolveSubscriber,
} from './betaOverride'

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
})

describe('betaSubscriptionOverride storage', () => {
  it('未設定なら null を返す', async () => {
    expect(await getBetaSubscriptionOverride()).toBeNull()
  })

  it("set('on') 後は 'on' を返す", async () => {
    await setBetaSubscriptionOverride('on')
    expect(await getBetaSubscriptionOverride()).toBe('on')
  })

  it("set('off') 後は 'off' を返す", async () => {
    await setBetaSubscriptionOverride('off')
    expect(await getBetaSubscriptionOverride()).toBe('off')
  })

  it('clear 後は null を返す', async () => {
    await setBetaSubscriptionOverride('on')
    await clearBetaSubscriptionOverride()
    expect(await getBetaSubscriptionOverride()).toBeNull()
  })
})

describe('resolveSubscriber', () => {
  it("override 'on' なら serverActive に関わらず true", () => {
    expect(resolveSubscriber(false, 'on')).toBe(true)
    expect(resolveSubscriber(true, 'on')).toBe(true)
  })

  it("override 'off' なら serverActive に関わらず false", () => {
    expect(resolveSubscriber(true, 'off')).toBe(false)
    expect(resolveSubscriber(false, 'off')).toBe(false)
  })

  it('override null なら serverActive をそのまま返す', () => {
    expect(resolveSubscriber(true, null)).toBe(true)
    expect(resolveSubscriber(false, null)).toBe(false)
  })
})
