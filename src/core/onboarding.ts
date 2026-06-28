import { ONBOARDING_COMPLETED_KEY } from '../background/storageKeys'

export async function getOnboardingCompleted(): Promise<boolean> {
  const result = await chrome.storage.local.get(ONBOARDING_COMPLETED_KEY) as {
    onboardingCompleted?: boolean
  }
  return result.onboardingCompleted === true
}

export async function setOnboardingCompleted(): Promise<void> {
  await chrome.storage.local.set({ [ONBOARDING_COMPLETED_KEY]: true })
}
