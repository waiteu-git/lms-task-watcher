import { TERMS_CONSENT_KEY } from '../background/storageKeys'
import { TERMS_VERSION } from './termsVersion'

export type TermsConsent = { version: number; acceptedAt: string }

/**
 * 保存された同意記録が、指定した版に対して有効かを判定する純関数。
 * 版が一致するときのみ同意済みとみなす。未設定・版不一致・壊れた値はすべて未同意。
 */
export function hasValidConsent(stored: unknown, version: number): boolean {
  if (typeof stored !== 'object' || stored === null) return false
  const c = stored as Partial<TermsConsent>
  if (typeof c.version !== 'number') return false
  if (typeof c.acceptedAt !== 'string' || c.acceptedAt === '') return false
  return c.version === version
}

export async function getConsent(): Promise<TermsConsent | null> {
  const result = await chrome.storage.local.get(TERMS_CONSENT_KEY) as {
    termsConsent?: unknown
  }
  const stored = result.termsConsent
  return hasValidConsent(stored, TERMS_VERSION) ? (stored as TermsConsent) : null
}

export async function saveConsent(version: number = TERMS_VERSION): Promise<void> {
  const consent: TermsConsent = { version, acceptedAt: new Date().toISOString() }
  await chrome.storage.local.set({ [TERMS_CONSENT_KEY]: consent })
}

/** 収集を行ってよいか。すべてのガードはこれを呼ぶ。 */
export async function isConsented(): Promise<boolean> {
  const result = await chrome.storage.local.get(TERMS_CONSENT_KEY) as {
    termsConsent?: unknown
  }
  return hasValidConsent(result.termsConsent, TERMS_VERSION)
}
