import type { Course } from './types'
import { extractCourseCodes } from './timetableLink'

/**
 * 時間割の科目コード集合に一致する「未操作(userToggled未設定)かつ未ON」のコースを enabled:true にする。
 * 自動DISABLEはしない。変更が無ければ入力と同一参照を返す（呼び出し側で保存をスキップできる）。
 */
export function selectCoursesByTimetable(
  courses: Course[],
  timetableCodes: Set<string>,
  nowIso: string,
): Course[] {
  if (timetableCodes.size === 0) return courses
  let changed = false
  const next = courses.map((c) => {
    if (c.userToggled || c.enabled) return c
    const match = extractCourseCodes(c.name).some((code) => timetableCodes.has(code))
    if (!match) return c
    changed = true
    return { ...c, enabled: true, updatedAt: nowIso }
  })
  return changed ? next : courses
}
