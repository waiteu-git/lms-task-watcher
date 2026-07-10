import type { TimetableSlot, DayOfWeek } from './timetable'
import type { Course, Assignment } from './types'
import type { ManualAssignment } from './manualAssignment'
import { extractCourseCodes, firstCourseCode } from './courseCode'
import { deadlineTier, type DeadlineTier } from '../utils/date'
import { isSubmittedAssignment } from '../utils/assignment'

export type Semester = 'zenki' | 'kouki'
export type TimetableOverride = { room?: string }
export type SemesterCapture = { semester: Semester; capturedAt: string }
export type AssignmentSlotInfo = {
  day: DayOfWeek
  period: number
  room: string
  isRemote: boolean
  courseCode: string
  /** この課題のコースが時間割で占める全コマ（曜日+時限）。週複数回・連続コマ・統合コース対応。重複排除・順序安定。 */
  occurrences: { day: DayOfWeek; period: number }[]
}

/** LETUSコース名に埋め込まれた全科目コードを抽出する（統合コースは複数）。 */
export { extractCourseCodes } from './courseCode'

/** 先頭の科目コード。無ければ null。 */
export const extractCourseCode = firstCourseCode

/** 既定表示学期。取得済みがあれば capturedAt 最新、無ければ日付（4–9月=前期）。 */
export function resolveSemester(now: Date, captured: SemesterCapture[]): Semester {
  if (captured.length > 0) {
    const latest = captured.reduce((a, b) => (a.capturedAt >= b.capturedAt ? a : b))
    return latest.semester
  }
  const month = now.getMonth()
  return month >= 3 && month <= 8 ? 'zenki' : 'kouki'
}

export function applyOverrides(
  slots: TimetableSlot[],
  overrides: Record<string, TimetableOverride>,
): TimetableSlot[] {
  return slots.map((s) => ({
    ...s,
    classes: s.classes.map((c) => {
      const ov = overrides[c.courseCode]
      if (!ov || ov.room === undefined) return c
      return { ...c, room: ov.room, isRemote: ov.room.includes('遠隔') }
    }),
  }))
}

const TIER_RANK: Record<DeadlineTier, number> = { none: 0, week: 1, today: 2 }

export function linkAssignmentsToSlots(
  slots: TimetableSlot[],
  courses: Course[],
  assignments: Assignment[],
  manualAssignments: ManualAssignment[] = [],
  now: Date = new Date(),
): {
  assignmentInfo: Record<string, AssignmentSlotInfo>
  courseCodeUrgency: Record<string, DeadlineTier>
} {
  const courseIdToCodes: Record<string, string[]> = {}
  for (const c of courses) {
    const codes = extractCourseCodes(c.name)
    if (codes.length > 0) courseIdToCodes[c.id] = codes
  }

  // 科目コード → 代表コマ（先頭一致）。room/シラバス表示や後方互換の day/period に使う。
  const codeToRep: Record<string, Omit<AssignmentSlotInfo, 'occurrences'>> = {}
  // 科目コード → 占有する全コマ。週複数回・連続コマを取りこぼさない。
  const codeToOccurrences: Record<string, { day: DayOfWeek; period: number }[]> = {}
  for (const s of slots) {
    for (const c of s.classes) {
      // 科目コードの無いセル(courseCode='')は突合キーにならない。空文字で全て衝突するのを防ぐ。
      if (!c.courseCode) continue
      codeToRep[c.courseCode] ??= {
        day: s.day, period: s.period, room: c.room, isRemote: c.isRemote, courseCode: c.courseCode,
      }
      ;(codeToOccurrences[c.courseCode] ??= []).push({ day: s.day, period: s.period })
    }
  }

  const assignmentInfo: Record<string, AssignmentSlotInfo> = {}
  const courseCodeUrgency: Record<string, DeadlineTier> = {}
  for (const s of slots) for (const c of s.classes) if (c.courseCode) courseCodeUrgency[c.courseCode] ??= 'none'

  const bump = (code: string, tier: DeadlineTier) => {
    if (TIER_RANK[tier] > TIER_RANK[courseCodeUrgency[code] ?? 'none']) courseCodeUrgency[code] = tier
  }

  for (const a of assignments) {
    const codes = courseIdToCodes[a.courseId]
    if (!codes) continue
    if (
      a.deadline &&
      !isSubmittedAssignment(a) &&
      a.lifecycleStatus !== 'passed' &&
      a.lifecycleStatus !== 'before_start'
    ) {
      const tier = deadlineTier(a.deadline, now)
      if (tier !== 'none') for (const code of codes) bump(code, tier)
    }
    // 代表は先頭一致コマ。occurrences には一致した全コード×全コマを重複排除して集約する。
    const matchedCodes = codes.filter((code) => code in codeToRep)
    if (matchedCodes.length > 0) {
      const seen = new Set<string>()
      const occurrences: { day: DayOfWeek; period: number }[] = []
      for (const code of matchedCodes) {
        for (const o of codeToOccurrences[code]) {
          const k = `${o.day}:${o.period}`
          if (seen.has(k)) continue
          seen.add(k)
          occurrences.push(o)
        }
      }
      assignmentInfo[a.id] = { ...codeToRep[matchedCodes[0]], occurrences }
    }
  }

  for (const m of manualAssignments) {
    if (m.submitted || !m.deadline) continue
    const tier = deadlineTier(m.deadline, now)
    if (tier === 'none') continue
    for (const code of extractCourseCodes(m.courseName)) bump(code, tier)
  }

  return { assignmentInfo, courseCodeUrgency }
}
