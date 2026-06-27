import { getAuthToken } from './auth'

const ASSIGNMENT_MEMOS_KEY = 'assignmentMemos'
const ASSIGNMENT_MEMOS_SYNCED_AT_KEY = 'assignmentMemosSyncedAt'
const THEME_KEY = 'theme'

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
  return result.theme ?? 'default'
}

export async function saveTheme(theme: string): Promise<void> {
  await chrome.storage.local.set({ [THEME_KEY]: theme })
  void syncToServer(import.meta.env.VITE_API_BASE_URL ?? '')
}

export async function syncToServer(apiBaseUrl: string): Promise<void> {
  if (!apiBaseUrl) return

  const token = await getAuthToken()
  if (!token) return

  try {
    const memos = await getAllMemos()
    const theme = await getTheme()

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
        body: JSON.stringify({ theme }),
      }),
    ])

    await chrome.storage.local.set({ [ASSIGNMENT_MEMOS_SYNCED_AT_KEY]: new Date().toISOString() })
  } catch {
    // サーバー同期失敗はサイレントに扱う（ローカルデータは保持される）
  }
}
