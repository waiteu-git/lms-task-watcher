import { describe, expect, it } from 'vitest'
import termsSource from '../../docs/legal/terms-ja.md?raw'
import { TERMS_BODY } from './termsBody'
import { TERMS_VERSION } from './termsVersion'

describe('TERMS_BODY', () => {
  it('正典 docs/legal/terms-ja.md と完全に一致する（手編集・再生成漏れの検出）', () => {
    expect(TERMS_BODY).toBe(termsSource)
  })

  it('正典に記載された版番号が TERMS_VERSION と一致する', () => {
    const m = TERMS_BODY.match(/版（TERMS_VERSION）: \*\*(\d+)\*\*/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(TERMS_VERSION)
  })
})
