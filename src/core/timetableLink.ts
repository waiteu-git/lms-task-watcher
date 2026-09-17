import type { TimetableSlot, DayOfWeek, Quarter } from './timetable'
import type { Course, Assignment } from './types'
import type { ManualAssignment } from './manualAssignment'
import { extractCourseCodes, firstCourseCode } from './courseCode'
import { deadlineTier, type DeadlineTier } from '../utils/date'
import { isSubmittedAssignment } from '../utils/assignment'
import { academicYear } from './syllabus'

export type Semester = 'zenki' | 'kouki'
export type TimetableOverride = { room?: string; quarter?: Quarter }
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

/**
 * 後期開始日はCLASSが公開せず年度ごとに変わる。判明した年度をここに追記する運用。
 * 未登録の年度は暫定的に旧来の月境界（4-9月=前期）にフォールバックする
 * （＝誤った早期ナッジより、今日と同じ挙動を優先。年1回、後期開始前にこの表を更新すること）。
 */
const KOUKI_START_DATES: Record<number, { month: number; day: number }> = {
  2026: { month: 9, day: 11 }, // 東京理科大 2026年度後期開始日
}

/** 日付だけから「今あるべき学期」を判定する（取得データは見ない）。 */
function calendarSemester(now: Date): Semester {
  const year = academicYear(now)
  const confirmed = KOUKI_START_DATES[year]
  if (!confirmed) return now.getMonth() >= 3 && now.getMonth() <= 8 ? 'zenki' : 'kouki'
  const koukiStart = new Date(year, confirmed.month - 1, confirmed.day)
  return now >= koukiStart ? 'kouki' : 'zenki'
}

/** 既定表示学期。取得済みがあれば capturedAt 最新、無ければ日付から判定（stale でも表示は変えない）。 */
export function resolveSemester(now: Date, captured: SemesterCapture[]): Semester {
  if (captured.length > 0) {
    const latest = captured.reduce((a, b) => (a.capturedAt >= b.capturedAt ? a : b))
    return latest.semester
  }
  return calendarSemester(now)
}

/**
 * 今、日付上「あるべき」学期のうち未取得のものを返す。取得済みが1件も無ければ null
 * （未取得は別の空状態UIが既に案内している＝この関数の対象外）。取得済みはあるが
 * 日付上の現学期がその中に無ければ、その学期を返す（取り込み漏れの合図）。
 * resolveSemester の「表示に使う学期」（stale でも latest capture を返す既存挙動）は変えない。
 * TimetableSection と TodayTimetable の両方から、各自が既に持つ captured リストで直接呼ぶ
 * （resolveViewSemester／直接resolveSemesterのどちらを使っているかに依存しない）。
 */
export function findMissingCurrentSemester(now: Date, captured: SemesterCapture[]): Semester | null {
  if (captured.length === 0) return null
  const expected = calendarSemester(now)
  return captured.some((c) => c.semester === expected) ? null : expected
}

/**
 * 日付上「あるべき」学期は取得済みなのに、表示中の学期がそれと違う場合に、切替先の学期を返す
 * （＝表示が古いまま取り残されている合図）。findMissingCurrentSemester とは逆の欠落を拾う：
 * あちらは「未取得」の合図、こちらは「取得済みなのに表示に反映されていない」の合図。
 * 表示学期は手動指定(pref)が最優先のため、前の学期を指したまま pref が残っていると、
 * 新学期を取り込んでもここが検知するまで表示は切り替わらない。
 */
export function findStaleDisplayedSemester(
  now: Date,
  captured: SemesterCapture[],
  displayed: Semester | null,
): Semester | null {
  if (displayed === null) return null
  const expected = calendarSemester(now)
  if (displayed === expected) return null
  return captured.some((c) => c.semester === expected) ? expected : null
}

export function applyOverrides(
  slots: TimetableSlot[],
  overrides: Record<string, TimetableOverride>,
): TimetableSlot[] {
  return slots.map((s) => ({
    ...s,
    classes: s.classes.map((c) => {
      const ov = overrides[c.courseCode]
      if (!ov) return c
      let next = c
      if (ov.room !== undefined) next = { ...next, room: ov.room, isRemote: ov.room.includes('遠隔') }
      if (ov.quarter !== undefined) next = { ...next, quarter: ov.quarter }
      return next
    }),
  }))
}

/**
 * 同一コマに2科目以上ある＝クォーター（半期）科目の可能性が高いコマ。
 * 同じ曜限に通期科目が2つ並ぶことは無いため、積まれていること自体が半期科目のシグナルになる。
 * CLASSは1Q/2Qを公開しないので、どちらが前半かはここでは決められない（ユーザー指定）。
 */
export function isQuarterSlot(slot: TimetableSlot): boolean {
  return slot.classes.length >= 2
}

/**
 * 「現在が前半か後半か」の既定値を日付から推定する。あくまでトグルの初期値で、
 * 正確なクォーター境界日はCLASSに無く年度で動くため、最終的な判断はユーザーのトグルに従う。
 * 前期: 4–5月=前半 / 6–9月=後半、後期: 10–11月=前半 / 12–3月=後半。
 */
export function defaultCurrentQuarter(now: Date, semester: Semester): Quarter {
  const month = now.getMonth() + 1
  if (semester === 'zenki') return month >= 4 && month <= 5 ? 'first' : 'second'
  return month >= 10 && month <= 11 ? 'first' : 'second'
}

/**
 * 表示に使う「現在の半期」。手動指定(pref)が最優先、無ければ日付からの既定値。学期未確定なら 'first'。
 * TimetableSection と TodayTimetable で同一判断を使うため純関数として一本化する（Litusでも再利用）。
 */
export function resolveCurrentQuarter(pref: Quarter | null, now: Date, semester: Semester | null): Quarter {
  if (pref !== null) return pref
  if (!semester) return 'first'
  return defaultCurrentQuarter(now, semester)
}

/**
 * 積みコマ（半期科目）の科目を薄表示すべきか。前半/後半が指定済みで、現在の半期と異なるときだけ true。
 * 未指定(undefined)や非積みコマは薄くしない（＝消さずに全件見せる方針）。
 */
export function isDimmedForCurrentQuarter(
  quarter: Quarter | undefined,
  currentQuarter: Quarter,
  stacked: boolean,
): boolean {
  return stacked && quarter !== undefined && quarter !== currentQuarter
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
