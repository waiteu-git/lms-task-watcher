import type { CourseLink } from '../core/letusLinks'
import type { UnreadUpdate } from '../core/courseUpdates'

const sigKey = (courseId: string) => `courseSignature:${courseId}`
const updKey = (courseId: string) => `courseUpdates:${courseId}`

export async function getCourseSignature(courseId: string): Promise<CourseLink[] | null> {
  const key = sigKey(courseId)
  const res = (await chrome.storage.local.get(key)) as Record<string, CourseLink[] | undefined>
  return res[key] ?? null
}

export async function saveCourseSignature(courseId: string, sig: CourseLink[]): Promise<void> {
  await chrome.storage.local.set({ [sigKey(courseId)]: sig })
}

export async function getUnreadUpdates(courseId: string): Promise<UnreadUpdate[]> {
  const key = updKey(courseId)
  const res = (await chrome.storage.local.get(key)) as Record<string, UnreadUpdate[] | undefined>
  return res[key] ?? []
}

export async function addUnreadUpdates(courseId: string, items: UnreadUpdate[]): Promise<void> {
  const existing = await getUnreadUpdates(courseId)
  const seen = new Set(existing.map((x) => x.url))
  const merged = [...existing]
  for (const it of items) {
    if (!seen.has(it.url)) {
      seen.add(it.url)
      merged.push(it)
    }
  }
  await chrome.storage.local.set({ [updKey(courseId)]: merged })
}

export async function markUpdateRead(courseId: string, url: string): Promise<void> {
  const remaining = (await getUnreadUpdates(courseId)).filter((x) => x.url !== url)
  await chrome.storage.local.set({ [updKey(courseId)]: remaining })
}

export async function clearCourseUpdates(courseId: string): Promise<void> {
  await chrome.storage.local.remove(updKey(courseId))
}
