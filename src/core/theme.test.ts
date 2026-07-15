import { describe, it, expect } from 'vitest'
import { resolveEffectiveTheme } from './theme'

describe('resolveEffectiveTheme', () => {
  it('明示 dark はOSに関係なく dark', () => {
    expect(resolveEffectiveTheme('dark', false)).toBe('dark')
    expect(resolveEffectiveTheme('dark', true)).toBe('dark')
  })

  it('明示 default（ライト）はOSに関係なく default', () => {
    expect(resolveEffectiveTheme('default', true)).toBe('default')
    expect(resolveEffectiveTheme('default', false)).toBe('default')
  })

  it('auto はOSの明暗に追従する', () => {
    expect(resolveEffectiveTheme('auto', true)).toBe('dark')
    expect(resolveEffectiveTheme('auto', false)).toBe('default')
  })

  it('未知の値は default にフォールバック', () => {
    expect(resolveEffectiveTheme('', false)).toBe('default')
    expect(resolveEffectiveTheme('nonsense', true)).toBe('default')
  })
})
