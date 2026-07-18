import type { Semester, TimetableOverride, SemesterCapture } from './timetableLink'
import type { Quarter } from './timetable'

export type TimetableCapture = { rawTableHtml: string; jigenText: string; capturedAt: string }

const VIEW_KEY = 'timetableView'
const timetableKey = (year: number, semester: Semester) => `timetable:${year}:${semester}`
const overrideKey = (year: number, semester: Semester, courseCode: string) =>
  `timetableOverrides:${year}:${semester}:${courseCode}`
/** 「今が前半/後半か」の手動指定。未設定(null)は日付からの既定値を使う。`timetable:` 前方一致に混ざらない名前にする。 */
const currentQuarterKey = (year: number, semester: Semester) => `currentQuarter:${year}:${semester}`

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

/**
 * 既存のオーバーライドに部分パッチをマージする。全置換にすると、教室を編集した瞬間に
 * quarter が消える（逆も同様）ため。値に undefined を明示するとそのフィールドを削除し、
 * 結果が空になればキーごと消してゴミを残さない。
 */
export async function setOverride(
  year: number,
  semester: Semester,
  courseCode: string,
  patch: Partial<TimetableOverride>,
): Promise<void> {
  const key = overrideKey(year, semester, courseCode)
  const current = (await getOverride(year, semester, courseCode)) ?? {}
  const next: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  if (Object.keys(next).length === 0) await chrome.storage.local.remove(key)
  else await chrome.storage.local.set({ [key]: next as TimetableOverride })
}

/** 「今が前半/後半か」の手動指定を読む。null は未指定＝日付からの既定値を使う。 */
export async function getCurrentQuarter(year: number, semester: Semester): Promise<Quarter | null> {
  const key = currentQuarterKey(year, semester)
  const res = (await chrome.storage.local.get(key)) as Record<string, Quarter | undefined>
  return res[key] ?? null
}

/** 「今が前半/後半か」を手動指定する。null を渡すと指定を解除し日付からの既定値に戻す。 */
export async function setCurrentQuarter(year: number, semester: Semester, quarter: Quarter | null): Promise<void> {
  const key = currentQuarterKey(year, semester)
  if (quarter === null) await chrome.storage.local.remove(key)
  else await chrome.storage.local.set({ [key]: quarter })
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
