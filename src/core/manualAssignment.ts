import { MANUAL_ASSIGNMENTS_KEY } from '../background/storageKeys'

export type ManualAssignment = {
  id: string
  courseId: string
  courseName: string
  title: string
  letusUrl: string | null
  deadline: string
  memo: string
  submitted: boolean
  createdAt: string
}

type LegacyManualAssignment = Omit<ManualAssignment, 'submitted'> & {
  submitted?: boolean
}

type ManualAssignmentsStorage = {
  manualAssignments?: LegacyManualAssignment[]
}

export async function getManualAssignments(): Promise<ManualAssignment[]> {
  const result = (await chrome.storage.local.get(
    MANUAL_ASSIGNMENTS_KEY,
  )) as ManualAssignmentsStorage

  const records = result.manualAssignments ?? []

  return records.map((record) => ({
    ...record,
    submitted: record.submitted ?? false,
  }))
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

export async function toggleManualAssignmentSubmitted(id: string): Promise<void> {
  const current = await getManualAssignments()
  const updated = current.map((a) =>
    a.id === id ? { ...a, submitted: !a.submitted } : a,
  )
  await saveManualAssignments(updated)
}
