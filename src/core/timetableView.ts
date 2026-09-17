import type { Course } from './types'
import type { Semester, TimetableOverride } from './timetableLink'
import type { DayOfWeek } from './timetable'
import { extractCourseCodes, resolveSemester } from './timetableLink'
import { getPreferredView, listCapturedSemesters, getOverrides, getTimetableCapture } from './timetableStore'
import { parseTimetable } from './timetable'

/**
 * 時間割ビューの学期解決とオーバーライド読込を App.tsx と TimetableSection で共有する。
 * 両者が同じ規則で学期を決め、同じ教室オーバーライドを適用するための単一の出所。
 */

/** 既定表示学期を解決（表示選択 > 取得済み最新 > 日付判定）。 */
export async function resolveViewSemester(year: number, now: Date): Promise<Semester> {
  const pref = await getPreferredView()
  if (pref?.year === year) return pref.semester
  return resolveSemester(now, await listCapturedSemesters(year))
}

/**
 * オーバーライドをまとめて読む。対象コードは LETUSコース名由来 ∪ 取得済み時間割由来。
 * 時間割にしか存在しない科目（LETUSで未登録・未追跡のクォーター科目など）の指定を
 * 取りこぼさないため、courses だけに頼らない。
 */
export async function loadCourseOverrides(
  year: number,
  semester: Semester,
  courses: Course[],
): Promise<Record<string, TimetableOverride>> {
  const fromCourses = courses.flatMap((c) => extractCourseCodes(c.name))
  const fromTimetable = await getCapturedCourseCodes(year, semester)
  const codes = Array.from(new Set([...fromCourses, ...fromTimetable]))
  return getOverrides(year, semester, codes)
}

/** 取得済み時間割から重複なしの7桁科目コード配列を返す（未取得は空）。 */
export async function getCapturedCourseCodes(year: number, semester: Semester): Promise<string[]> {
  const cap = await getTimetableCapture(year, semester)
  if (!cap) return []
  const codes = new Set<string>()
  for (const s of parseTimetable(cap.rawTableHtml)) {
    for (const c of s.classes) if (c.courseCode) codes.add(c.courseCode)
  }
  return Array.from(codes)
}

const WEEKDAY: Record<number, DayOfWeek | undefined> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' }

/** ポップアップに表示する曜日を決める。平日は当日、土日は翌月曜。 */
export function resolveDisplayDay(now: Date): { day: DayOfWeek; label: string } {
  const day = WEEKDAY[now.getDay()]
  return day ? { day, label: '今日' } : { day: 'mon', label: '月曜' }
}
