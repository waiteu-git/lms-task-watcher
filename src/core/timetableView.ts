import type { Course } from './types'
import type { Semester, TimetableOverride } from './timetableLink'
import type { DayOfWeek, TimetableSlot } from './timetable'
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

/** JSの曜日（Date#getDay）を時間割の曜日へ対応づける。日曜は授業が無いので undefined。 */
const WEEKDAY: Record<number, DayOfWeek | undefined> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' }

export function dayOfWeekOf(date: Date): DayOfWeek | undefined {
  return WEEKDAY[date.getDay()]
}

const WEEKDAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri']

/** 土曜に授業が1件でもあるか（授業なしのコマは数えない）。 */
export function hasSaturdayClasses(slots: TimetableSlot[]): boolean {
  return slots.some((s) => s.day === 'sat' && s.classes.length > 0)
}

/**
 * 時間割グリッドに出す曜日の列。平日5列は常に出し、土曜は授業があるときだけ6列目に足す。
 * （CLASSの時間割は月〜土の6列で取り込まれる。授業が無い人に空の土曜列を見せないための条件付き）
 */
export function visibleDays(slots: TimetableSlot[]): DayOfWeek[] {
  return hasSaturdayClasses(slots) ? [...WEEKDAYS, 'sat'] : [...WEEKDAYS]
}

/**
 * ポップアップに表示する曜日を決める。平日は当日、日曜は翌月曜。
 * 土曜は、土曜に授業がある時間割なら当日（授業が無い人は従来どおり翌月曜）。
 */
export function resolveDisplayDay(now: Date, slots: TimetableSlot[] = []): { day: DayOfWeek; label: string } {
  const day = dayOfWeekOf(now)
  if (day === 'sat' && !hasSaturdayClasses(slots)) return { day: 'mon', label: '月曜' }
  return day ? { day, label: '今日' } : { day: 'mon', label: '月曜' }
}
