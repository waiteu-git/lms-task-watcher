import {
  ASSIGNMENT_SCAN_STATUS_KEY,
  DEADLINE_SCAN_STATUS_KEY,
  IGNORED_ASSIGNMENT_IDS_KEY,
  LAST_REFRESH_AT_KEY,
  LAST_STALE_NOTIFICATION_AT_KEY,
  NOTIFIED_DEADLINE_KEYS_KEY,
} from '../constants'

export type ScanState = 'idle' | 'running' | 'completed' | 'error'

export type AssignmentScanStatus = {
  state: ScanState
  startedAt: string | null
  finishedAt: string | null
  totalCourses: number
  completedCourses: number
  currentCourseName: string
  detectedCount: number
  errorMessage: string | null
}

export type DeadlineScanStatus = {
  state: ScanState
  startedAt: string | null
  finishedAt: string | null
  totalItems: number
  completedItems: number
  currentItemTitle: string
  detectedCount: number
  errorMessage: string | null
}

export const initialAssignmentScanStatus: AssignmentScanStatus = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  totalCourses: 0,
  completedCourses: 0,
  currentCourseName: '',
  detectedCount: 0,
  errorMessage: null,
}

export const initialDeadlineScanStatus: DeadlineScanStatus = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  totalItems: 0,
  completedItems: 0,
  currentItemTitle: '',
  detectedCount: 0,
  errorMessage: null,
}

export async function getAssignmentScanStatus(): Promise<AssignmentScanStatus> {
  const result = (await chrome.storage.local.get(
    ASSIGNMENT_SCAN_STATUS_KEY,
  )) as {
    assignmentScanStatus?: AssignmentScanStatus
  }

  return result.assignmentScanStatus ?? initialAssignmentScanStatus
}

export async function getDeadlineScanStatus(): Promise<DeadlineScanStatus> {
  const result = (await chrome.storage.local.get(DEADLINE_SCAN_STATUS_KEY)) as {
    deadlineScanStatus?: DeadlineScanStatus
  }

  return result.deadlineScanStatus ?? initialDeadlineScanStatus
}

export async function getLastRefreshAt(): Promise<string | null> {
  const result = (await chrome.storage.local.get(LAST_REFRESH_AT_KEY)) as {
    lastSuccessfulRefreshAt?: string
  }

  return result.lastSuccessfulRefreshAt ?? null
}

export async function saveLastRefreshAt(value: string): Promise<void> {
  await chrome.storage.local.set({
    lastSuccessfulRefreshAt: value,
  })
}

export async function getLastStaleNotificationAt(): Promise<string | null> {
  const result = (await chrome.storage.local.get(
    LAST_STALE_NOTIFICATION_AT_KEY,
  )) as {
    lastStaleRefreshNotificationAt?: string
  }

  return result.lastStaleRefreshNotificationAt ?? null
}

export async function saveLastStaleNotificationAt(value: string): Promise<void> {
  await chrome.storage.local.set({
    lastStaleRefreshNotificationAt: value,
  })
}

export async function getIgnoredAssignmentIds(): Promise<string[]> {
  const result = (await chrome.storage.local.get(IGNORED_ASSIGNMENT_IDS_KEY)) as {
    ignoredAssignmentIds?: string[]
  }

  return result.ignoredAssignmentIds ?? []
}

export async function saveIgnoredAssignmentIds(ignoredAssignmentIds: string[]) {
  await chrome.storage.local.set({
    ignoredAssignmentIds,
  })
}

export async function getNotifiedDeadlineKeys(): Promise<string[]> {
  const result = (await chrome.storage.local.get(NOTIFIED_DEADLINE_KEYS_KEY)) as {
    notifiedDeadlineKeys?: string[]
  }

  return result.notifiedDeadlineKeys ?? []
}

export async function saveNotifiedDeadlineKeys(notifiedDeadlineKeys: string[]) {
  await chrome.storage.local.set({
    notifiedDeadlineKeys,
  })
}

export async function waitForAssignmentScanToFinish(
  onTick: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 180_000) {
    const status = await getAssignmentScanStatus()
    await onTick()

    if (status.state === 'completed') {
      return
    }

    if (status.state === 'error') {
      throw new Error(status.errorMessage ?? '課題候補検索でエラー')
    }

    await new Promise((resolve) => setTimeout(resolve, 800))
  }

  throw new Error('課題候補検索がタイムアウトしました')
}

export async function waitForDeadlineScanToFinish(
  onTick: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 240_000) {
    const status = await getDeadlineScanStatus()
    await onTick()

    if (status.state === 'completed') {
      return
    }

    if (status.state === 'error') {
      throw new Error(status.errorMessage ?? '締切読み取りでエラー')
    }

    await new Promise((resolve) => setTimeout(resolve, 800))
  }

  throw new Error('締切読み取りがタイムアウトしました')
}
