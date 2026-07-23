import { getAuthToken } from './auth'
import type { NotificationRules } from '../background/notificationRules'

const ASSIGNMENT_MEMOS_KEY = 'assignmentMemos'
const ASSIGNMENT_MEMOS_SYNCED_AT_KEY = 'assignmentMemosSyncedAt'
const THEME_KEY = 'theme'
const COURSE_UPDATE_NOTIFY_ENABLED_KEY = 'courseUpdateNotifyEnabled'
const NOTIFICATION_RULES_KEY = 'notificationRules'
const NOTIFICATION_RULES_UPDATED_AT_KEY = 'notificationRulesUpdatedAt'

export type AssignmentMemo = {
  priority: 0 | 1 | 2 | 3
  memo: string
}

type MemosStorage = {
  assignmentMemos?: Record<string, AssignmentMemo>
}

export async function getMemo(assignmentId: string): Promise<AssignmentMemo> {
  const result = (await chrome.storage.local.get(ASSIGNMENT_MEMOS_KEY)) as MemosStorage
  return result.assignmentMemos?.[assignmentId] ?? { priority: 0, memo: '' }
}

export async function getAllMemos(): Promise<Record<string, AssignmentMemo>> {
  const result = (await chrome.storage.local.get(ASSIGNMENT_MEMOS_KEY)) as MemosStorage
  return result.assignmentMemos ?? {}
}

export async function saveMemo(assignmentId: string, memo: AssignmentMemo): Promise<void> {
  const current = await getAllMemos()
  await chrome.storage.local.set({
    [ASSIGNMENT_MEMOS_KEY]: { ...current, [assignmentId]: memo },
  })
}

export async function getTheme(): Promise<string> {
  const result = (await chrome.storage.local.get(THEME_KEY)) as { theme?: string }
  // 既定は 'auto'（OS追従）。明示的に保存された値（default/dark/auto）はそのまま維持。
  return result.theme ?? 'auto'
}

export async function saveTheme(theme: string): Promise<void> {
  await chrome.storage.local.set({ [THEME_KEY]: theme })
}

// コース内容の更新通知（Chrome通知）の全体ON/OFF。既定は ON。
export async function getCourseUpdateNotifyEnabled(): Promise<boolean> {
  const result = (await chrome.storage.local.get(COURSE_UPDATE_NOTIFY_ENABLED_KEY)) as {
    courseUpdateNotifyEnabled?: boolean
  }
  return result.courseUpdateNotifyEnabled !== false
}

export async function saveCourseUpdateNotifyEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [COURSE_UPDATE_NOTIFY_ENABLED_KEY]: enabled })
}

export async function getNotificationRules(): Promise<NotificationRules | null> {
  const result = (await chrome.storage.local.get(NOTIFICATION_RULES_KEY)) as {
    notificationRules?: NotificationRules
  }
  return result.notificationRules ?? null
}

export async function getNotificationRulesUpdatedAt(): Promise<string | null> {
  const result = (await chrome.storage.local.get(NOTIFICATION_RULES_UPDATED_AT_KEY)) as {
    notificationRulesUpdatedAt?: string
  }
  return result.notificationRulesUpdatedAt ?? null
}

export async function saveNotificationRules(
  rules: NotificationRules,
  updatedAt: string = new Date().toISOString(),
): Promise<void> {
  await chrome.storage.local.set({
    [NOTIFICATION_RULES_KEY]: rules,
    [NOTIFICATION_RULES_UPDATED_AT_KEY]: updatedAt,
  })
}

// ログイン/ダッシュボード起動時に呼ぶ。サーバーの通知ルールが新しければローカルへ反映（last-write-wins）。
export async function pullSettingsFromServer(apiBaseUrl: string): Promise<void> {
  if (!apiBaseUrl) return
  const token = await getAuthToken()
  if (!token) return

  try {
    const res = await fetch(`${apiBaseUrl}/api/user/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = (await res.json()) as {
      notificationRules: NotificationRules | null
      notificationRulesUpdatedAt: string | null
    }
    if (!data.notificationRules || !data.notificationRulesUpdatedAt) return

    const localUpdatedAt = await getNotificationRulesUpdatedAt()
    if (!localUpdatedAt || data.notificationRulesUpdatedAt > localUpdatedAt) {
      await saveNotificationRules(data.notificationRules, data.notificationRulesUpdatedAt)
    }
  } catch {
    // pull失敗はサイレント（ローカルを保持）
  }
}

export async function syncToServer(apiBaseUrl: string): Promise<void> {
  if (!apiBaseUrl) return

  const token = await getAuthToken()
  if (!token) return

  try {
    const memos = await getAllMemos()
    const theme = await getTheme()
    const notificationRules = await getNotificationRules()
    const notificationRulesUpdatedAt = await getNotificationRulesUpdatedAt()

    const items = Object.entries(memos).map(([assignmentId, { priority, memo }]) => ({
      assignmentId,
      priority,
      memo,
    }))

    await Promise.all([
      fetch(`${apiBaseUrl}/api/user/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items }),
      }),
      fetch(`${apiBaseUrl}/api/user/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(
          notificationRules
            ? { theme, notificationRules, notificationRulesUpdatedAt }
            : { theme },
        ),
      }),
    ])

    await chrome.storage.local.set({ [ASSIGNMENT_MEMOS_SYNCED_AT_KEY]: new Date().toISOString() })
  } catch {
    // サーバー同期失敗はサイレントに扱う（ローカルデータは保持される）
  }
}
