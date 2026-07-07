import type { Course } from './types'
import type { Semester, TimetableOverride } from './timetableLink'
import { extractCourseCodes, resolveSemester } from './timetableLink'
import { getPreferredView, listCapturedSemesters, getOverrides } from './timetableStore'

/**
 * 時間割ビューの学期解決とオーバーライド読込を App.tsx と TimetableSection で共有する。
 * 両者が同じ規則で学期を決め、同じ教室オーバーライドを適用するための単一の出所。
 */

/** 既定表示学期を解決（表示選択 > 取得済み最新 > 日付判定）。 */
export async function resolveViewSemester(year: number, now: Date): Promise<Semester> {
  const pref = await getPreferredView()
  return pref?.semester ?? resolveSemester(now, await listCapturedSemesters(year))
}

/** courses に含まれる全科目コード分の教室オーバーライドをまとめて読む。 */
export async function loadCourseOverrides(
  year: number,
  semester: Semester,
  courses: Course[],
): Promise<Record<string, TimetableOverride>> {
  const codes = Array.from(new Set(courses.flatMap((c) => extractCourseCodes(c.name))))
  return getOverrides(year, semester, codes)
}
