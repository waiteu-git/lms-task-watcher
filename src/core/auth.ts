const AUTH_TOKEN_KEY = 'authToken'
const AUTH_TOKEN_EXPIRES_AT_KEY = 'authTokenExpiresAt'
const AUTH_EMAIL_KEY = 'authEmail'
const SUBSCRIPTION_STATUS_KEY = 'subscriptionStatus'
const SUBSCRIPTION_CHECKED_AT_KEY = 'subscriptionCheckedAt'
const SUBSCRIPTION_GRACE_UNTIL_KEY = 'subscriptionGraceUntil'

const CACHE_VALID_MS = 7 * 24 * 60 * 60 * 1000   // 7日
const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000  // 追加3日

export async function getAuthToken(): Promise<string | null> {
  const result = await chrome.storage.local.get([AUTH_TOKEN_KEY, AUTH_TOKEN_EXPIRES_AT_KEY]) as {
    authToken?: string
    authTokenExpiresAt?: string
  }

  if (!result.authToken || !result.authTokenExpiresAt) {
    return null
  }

  if (new Date(result.authTokenExpiresAt).getTime() <= Date.now()) {
    return null
  }

  return result.authToken
}

export async function getAuthEmail(): Promise<string | null> {
  const result = await chrome.storage.local.get(AUTH_EMAIL_KEY) as { authEmail?: string }
  return result.authEmail ?? null
}

export async function saveAuthSession(token: string, expiresAt: string, email?: string): Promise<void> {
  await chrome.storage.local.set({
    [AUTH_TOKEN_KEY]: token,
    [AUTH_TOKEN_EXPIRES_AT_KEY]: expiresAt,
    ...(email ? { [AUTH_EMAIL_KEY]: email } : {}),
  })
}

export async function clearAuthSession(): Promise<void> {
  await chrome.storage.local.remove([
    AUTH_TOKEN_KEY,
    AUTH_TOKEN_EXPIRES_AT_KEY,
    AUTH_EMAIL_KEY,
    SUBSCRIPTION_STATUS_KEY,
    SUBSCRIPTION_CHECKED_AT_KEY,
    SUBSCRIPTION_GRACE_UNTIL_KEY,
  ])
}

export async function getSubscriptionCurrentPeriodEnd(): Promise<string | null> {
  const result = await chrome.storage.local.get('subscriptionCurrentPeriodEnd') as { subscriptionCurrentPeriodEnd?: string }
  return result.subscriptionCurrentPeriodEnd ?? null
}

export async function saveSubscriptionCache(
  status: string,
  currentPeriodEnd: string | null,
): Promise<void> {
  const now = new Date()
  const graceUntil = new Date(now.getTime() + CACHE_VALID_MS + GRACE_PERIOD_MS)

  await chrome.storage.local.set({
    [SUBSCRIPTION_STATUS_KEY]: status,
    [SUBSCRIPTION_CHECKED_AT_KEY]: now.toISOString(),
    [SUBSCRIPTION_GRACE_UNTIL_KEY]: graceUntil.toISOString(),
    ...(currentPeriodEnd ? { subscriptionCurrentPeriodEnd: currentPeriodEnd } : {}),
  })
}

export type SubscriptionState = 'active' | 'grace' | 'inactive' | 'unknown'

export async function getSubscriptionState(): Promise<SubscriptionState> {
  const result = await chrome.storage.local.get([
    SUBSCRIPTION_STATUS_KEY,
    SUBSCRIPTION_CHECKED_AT_KEY,
    SUBSCRIPTION_GRACE_UNTIL_KEY,
  ]) as {
    subscriptionStatus?: string
    subscriptionCheckedAt?: string
    subscriptionGraceUntil?: string
  }

  if (!result.subscriptionStatus || !result.subscriptionCheckedAt) {
    return 'unknown'
  }

  if (result.subscriptionStatus !== 'active') {
    return 'inactive'
  }

  const checkedAt = new Date(result.subscriptionCheckedAt).getTime()
  const cacheAge = Date.now() - checkedAt

  if (cacheAge <= CACHE_VALID_MS) {
    return 'active'
  }

  if (
    result.subscriptionGraceUntil &&
    new Date(result.subscriptionGraceUntil).getTime() > Date.now()
  ) {
    return 'grace'
  }

  return 'inactive'
}

export async function isSubscriptionActive(): Promise<boolean> {
  const state = await getSubscriptionState()
  return state === 'active' || state === 'grace'
}
