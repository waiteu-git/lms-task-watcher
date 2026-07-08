import type { TimetableSlot, DayOfWeek } from './timetable'
import type { Course, Assignment } from './types'
import type { ManualAssignment } from './manualAssignment'
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
}

/** LETUSコース名に埋め込まれた全7桁科目コードを抽出する（統合コースは複数）。 */
export function extractCourseCodes(letusCourseName: string): string[] {
  const matches = letusCourseName.match(/(?<!\d)\d{7}(?!\d)/g)
  return matches ? Array.from(new Set(matches)) : []
}

/** 先頭の7桁コード。無ければ null。 */
export function extractCourseCode(letusCourseName: string): string | null {
  return extractCourseCodes(letusCourseName)[0] ?? null
}

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

  const codeToSlot: Record<string, AssignmentSlotInfo> = {}
  for (const s of slots) {
    for (const c of s.classes) {
      // 7桁コードの無いセル(courseCode='')は突合キーにならない。空文字で全て衝突するのを防ぐ。
      if (!c.courseCode) continue
      if (!(c.courseCode in codeToSlot)) {
        codeToSlot[c.courseCode] = {
          day: s.day, period: s.period, room: c.room, isRemote: c.isRemote, courseCode: c.courseCode,
        }
      }
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
    // チップは時間割に存在する先頭一致コマに付ける
    const matched = codes.find((code) => code in codeToSlot)
    if (matched) assignmentInfo[a.id] = codeToSlot[matched]
  }

  for (const m of manualAssignments) {
    if (m.submitted || !m.deadline) continue
    const tier = deadlineTier(m.deadline, now)
    if (tier === 'none') continue
    for (const code of extractCourseCodes(m.courseName)) bump(code, tier)
  }

  return { assignmentInfo, courseCodeUrgency }
}
