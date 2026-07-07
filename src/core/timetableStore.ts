import type { Semester, TimetableOverride, SemesterCapture } from './timetableLink'

export type TimetableCapture = { rawTableHtml: string; jigenText: string; capturedAt: string }

const VIEW_KEY = 'timetableView'
const timetableKey = (year: number, semester: Semester) => `timetable:${year}:${semester}`
const overrideKey = (year: number, semester: Semester, courseCode: string) =>
  `timetableOverrides:${year}:${semester}:${courseCode}`

export async function saveTimetableCapture(year: number, semester: Semester, cap: TimetableCapture): Promise<void> {
  await chrome.storage.local.set({ [timetableKey(year, semester)]: cap })
}

export async function getTimetableCapture(year: number, semester: Semester): Promise<TimetableCapture | null> {
  const key = timetableKey(year, semester)
  const res = (await chrome.storage.local.get(key)) as Record<string, TimetableCapture | undefined>
  return res[key] ?? null
}

export async function listCapturedSemesters(year: number): Promise<SemesterCapture[]> {
  const out: SemesterCapture[] = []
  for (const semester of ['zenki', 'kouki'] as const) {
    const cap = await getTimetableCapture(year, semester)
    if (cap) out.push({ semester, capturedAt: cap.capturedAt })
  }
  return out
}

export async function getOverride(year: number, semester: Semester, courseCode: string): Promise<TimetableOverride | null> {
  const key = overrideKey(year, semester, courseCode)
  const res = (await chrome.storage.local.get(key)) as Record<string, TimetableOverride | undefined>
  return res[key] ?? null
}

export async function setOverride(year: number, semester: Semester, courseCode: string, ov: TimetableOverride): Promise<void> {
  await chrome.storage.local.set({ [overrideKey(year, semester, courseCode)]: ov })
}

/** 複数科目コードの教室オーバーライドを1回の get でまとめて読む。 */
export async function getOverrides(
  year: number,
  semester: Semester,
  courseCodes: string[],
): Promise<Record<string, TimetableOverride>> {
  if (courseCodes.length === 0) return {}
  const keyOf = (code: string) => overrideKey(year, semester, code)
  const res = (await chrome.storage.local.get(courseCodes.map(keyOf))) as Record<string, TimetableOverride | undefined>
  const out: Record<string, TimetableOverride> = {}
  for (const code of courseCodes) {
    const v = res[keyOf(code)]
    if (v) out[code] = v
  }
  return out
}

export async function getPreferredView(): Promise<{ year: number; semester: Semester } | null> {
  const res = (await chrome.storage.local.get(VIEW_KEY)) as Record<string, { year: number; semester: Semester } | undefined>
  return res[VIEW_KEY] ?? null
}

export async function setPreferredView(year: number, semester: Semester): Promise<void> {
  await chrome.storage.local.set({ [VIEW_KEY]: { year, semester } })
}
