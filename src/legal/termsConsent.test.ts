import { describe, expect, it } from 'vitest'
import { hasValidConsent } from './termsConsent'

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
})
