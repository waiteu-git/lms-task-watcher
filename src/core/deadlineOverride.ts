import type { Assignment } from './types'
import { DEADLINE_OVERRIDES_KEY } from '../background/storageKeys'

// content script と同じ正規化。badgeState を import すると popup/background 経由で
// content と共有チャンク化し import ガードを壊すため、ここでは import せずインライン化する。
function normalizeUrl(url: string): string {
  return url.split('#')[0]
}

/** スキャン課題のパース済み締切を保持したまま、ユーザー設定の締切を読取時に重ねる。 */
export function applyDeadlineOverrides(
  assignments: Assignment[],
  overrides: Record<string, string>,
): Assignment[] {
  if (!overrides || Object.keys(overrides).length === 0) return assignments
  return assignments.map((assignment) => {
    if (!assignment.url) return assignment
    const override = overrides[normalizeUrl(assignment.url)]
    return override ? { ...assignment, deadline: override, deadlineSource: 'user' } : assignment
  })
}

export async function getDeadlineOverrides(): Promise<Record<string, string>> {
  const result = (await chrome.storage.local.get(DEADLINE_OVERRIDES_KEY)) as {
    deadlineOverrides?: Record<string, string>
  }
  return result[DEADLINE_OVERRIDES_KEY] ?? {}
}

/**
 * ユーザー設定の締切を保存する（週間カレンダーの「＋締切」等・popup/dashboard側の書き込み口）。
 * content script 側（manualTaskWidget の openDeadlineEditor）と同じキー・同じ正規化。
 */
export async function setDeadlineOverride(url: string, iso: string): Promise<void> {
  const current = await getDeadlineOverrides()
  await chrome.storage.local.set({
    [DEADLINE_OVERRIDES_KEY]: { ...current, [normalizeUrl(url)]: iso },
  })
}

/** ユーザー設定の締切を外し、自動検出値に戻す。 */
export async function clearDeadlineOverride(url: string): Promise<void> {
  const current = await getDeadlineOverrides()
  const next = { ...current }
  delete next[normalizeUrl(url)]
  await chrome.storage.local.set({ [DEADLINE_OVERRIDES_KEY]: next })
}
