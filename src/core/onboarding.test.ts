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

import { getOnboardingCompleted, setOnboardingCompleted } from './onboarding'

beforeEach(() => {
  Object.keys(store).forEach((k) => delete store[k])
})

describe('getOnboardingCompleted', () => {
  it('フラグ未設定のとき false を返す', async () => {
    expect(await getOnboardingCompleted()).toBe(false)
  })

  it('setOnboardingCompleted 後に true を返す', async () => {
    await setOnboardingCompleted()
    expect(await getOnboardingCompleted()).toBe(true)
  })
})
