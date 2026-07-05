const BETA_SUBSCRIPTION_OVERRIDE_KEY = 'betaSubscriptionOverride'

export type BetaSubscriptionOverride = 'on' | 'off' | null

export async function getBetaSubscriptionOverride(): Promise<BetaSubscriptionOverride> {
  const result = await chrome.storage.local.get(BETA_SUBSCRIPTION_OVERRIDE_KEY) as {
    betaSubscriptionOverride?: 'on' | 'off'
  }
  return result.betaSubscriptionOverride ?? null
}

export async function setBetaSubscriptionOverride(v: 'on' | 'off'): Promise<void> {
  await chrome.storage.local.set({ [BETA_SUBSCRIPTION_OVERRIDE_KEY]: v })
}

export async function clearBetaSubscriptionOverride(): Promise<void> {
  await chrome.storage.local.remove(BETA_SUBSCRIPTION_OVERRIDE_KEY)
}

// override がある間はサーバー由来の serverActive より override を優先する。
// null（未設定）のときは現行挙動どおり serverActive をそのまま使う。
export function resolveSubscriber(
  serverActive: boolean,
  override: BetaSubscriptionOverride,
): boolean {
  if (override === 'on') return true
  if (override === 'off') return false
  return serverActive
}
