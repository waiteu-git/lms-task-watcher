import { MANUAL_ASSIGNMENTS_KEY } from '../background/storageKeys'

export type ManualAssignment = {
  id: string
  courseId: string
  courseName: string
  title: string
  letusUrl: string | null
  deadline: string
  memo: string
  createdAt: string
}

type ManualAssignmentsStorage = {
  manualAssignments?: ManualAssignment[]
}

export async function getManualAssignments(): Promise<ManualAssignment[]> {
  const result = (await chrome.storage.local.get(
    MANUAL_ASSIGNMENTS_KEY,
  )) as ManualAssignmentsStorage
  return result.manualAssignments ?? []
}

export async function saveManualAssignments(
  items: ManualAssignment[],
): Promise<void> {
  await chrome.storage.local.set({ [MANUAL_ASSIGNMENTS_KEY]: items })
}

export async function addManualAssignment(
  item: ManualAssignment,
): Promise<void> {
  const current = await getManualAssignments()
  await saveManualAssignments([...current, item])
}

export async function deleteManualAssignment(id: string): Promise<void> {
  const current = await getManualAssignments()
  await saveManualAssignments(current.filter((a) => a.id !== id))
}
