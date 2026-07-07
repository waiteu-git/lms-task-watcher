import { describe, it, expect } from 'vitest'
import { extractSesskey } from './letusApi'
import { SESSKEY_HTML_SNIPPET } from './letusApi.fixtures'

describe('extractSesskey', () => {
  it('ログイン済みページHTMLのM.cfgインラインJSONからsesskeyを抽出する', () => {
    expect(extractSesskey(SESSKEY_HTML_SNIPPET)).toBe('AbCd012345')
  })

  it('sesskeyを含まないHTMLはnull', () => {
    expect(extractSesskey('<html><body>login page</body></html>')).toBe(null)
  })

  it('壊れた入力（空文字）はnull', () => {
    expect(extractSesskey('')).toBe(null)
  })
})
