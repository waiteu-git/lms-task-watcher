import { afterEach, describe, expect, it, vi } from 'vitest'
import { getConsent, hasValidConsent, isConsented, saveConsent } from './termsConsent'
import { TERMS_VERSION } from './termsVersion'

describe('hasValidConsent', () => {
  it('未設定(null/undefined)は未同意', () => {
    expect(hasValidConsent(null, 1)).toBe(false)
    expect(hasValidConsent(undefined, 1)).toBe(false)
  })

  it('版が一致すれば同意済み', () => {
    expect(hasValidConsent({ version: 1, acceptedAt: '2026-07-10T00:00:00.000Z' }, 1)).toBe(true)
  })

  it('版が古ければ未同意（規約改定で再同意を求める）', () => {
    expect(hasValidConsent({ version: 1, acceptedAt: '2026-07-10T00:00:00.000Z' }, 2)).toBe(false)
  })

  it('版が新しすぎる場合も未同意（ダウングレード時の安全側）', () => {
    expect(hasValidConsent({ version: 3, acceptedAt: '2026-07-10T00:00:00.000Z' }, 2)).toBe(false)
  })

  it('壊れた値は未同意', () => {
    expect(hasValidConsent({}, 1)).toBe(false)
    expect(hasValidConsent({ version: '1' }, 1)).toBe(false)
    expect(hasValidConsent('yes', 1)).toBe(false)
    expect(hasValidConsent(42, 1)).toBe(false)
    expect(hasValidConsent({ version: 1 }, 1)).toBe(false)
    expect(hasValidConsent({ version: 1, acceptedAt: '' }, 1)).toBe(false)
  })

  describe('Object.prototype汚染への耐性', () => {
    afterEach(() => {
      delete (Object.prototype as Record<string, unknown>).version
      delete (Object.prototype as Record<string, unknown>).acceptedAt
    })

    it('Object.prototypeが汚染されていてもhasValidConsent({}, 1)はfalse', () => {
      ;(Object.prototype as Record<string, unknown>).version = 1
      ;(Object.prototype as Record<string, unknown>).acceptedAt = '2026-07-10T00:00:00.000Z'
      expect(hasValidConsent({}, 1)).toBe(false)
    })

    it('version/acceptedAtをownプロパティとして持つ配列は未同意', () => {
      const arr: unknown[] & { version?: number; acceptedAt?: string } = []
      arr.version = 1
      arr.acceptedAt = '2026-07-10T00:00:00.000Z'
      expect(hasValidConsent(arr, 1)).toBe(false)
    })
  })
})

type ChromeStorageStub = {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  store: Record<string, unknown>
}

function stubChromeStorage(initial: Record<string, unknown> = {}): ChromeStorageStub {
  const store: Record<string, unknown> = { ...initial }
  const get = vi.fn(async (key: string) => ({ [key]: store[key] }))
  const set = vi.fn(async (items: Record<string, unknown>) => {
    Object.assign(store, items)
  })
  vi.stubGlobal('chrome', { storage: { local: { get, set } } })
  return { get, set, store }
}

describe('storage連携（getConsent / saveConsent / isConsented）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saveConsentはtermsConsentキーだけを書く（既存データ削除の禁止）', async () => {
    const { set } = stubChromeStorage()
    await saveConsent()
    expect(set).toHaveBeenCalledTimes(1)
    const written = set.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(written)).toEqual(['termsConsent'])
  })

  it('saveConsentは{ version: TERMS_VERSION, acceptedAt: ISO8601文字列 }を書く', async () => {
    const { set } = stubChromeStorage()
    await saveConsent()
    const written = set.mock.calls[0][0] as { termsConsent: { version: number; acceptedAt: string } }
    expect(written.termsConsent.version).toBe(TERMS_VERSION)
    expect(written.termsConsent.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('保存→読み出しの往復でisConsentedがtrueになる', async () => {
    stubChromeStorage()
    await saveConsent()
    expect(await isConsented()).toBe(true)
  })

  it('版が古い記録が保存されている場合、isConsentedはfalse・getConsentはnull', async () => {
    stubChromeStorage({
      termsConsent: { version: TERMS_VERSION - 1, acceptedAt: '2020-01-01T00:00:00.000Z' },
    })
    expect(await isConsented()).toBe(false)
    expect(await getConsent()).toBeNull()
  })

  it('chrome.storage.local.getがrejectしてもgetConsentはnull・isConsentedはfalse（reject非伝播）', async () => {
    const get = vi.fn(async () => {
      throw new Error('storage unavailable')
    })
    vi.stubGlobal('chrome', { storage: { local: { get, set: vi.fn() } } })

    await expect(getConsent()).resolves.toBeNull()
    await expect(isConsented()).resolves.toBe(false)
  })
})
