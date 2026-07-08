import { useEffect, useMemo, useState } from 'react'
import type { Course, Assignment } from '../core/types'
import type { ManualAssignment } from '../core/manualAssignment'
import type { TimetableSlot, DayOfWeek } from '../core/timetable'
import { parseTimetable } from '../core/timetable'
import { applyOverrides, linkAssignmentsToSlots } from '../core/timetableLink'
import { getTimetableCapture } from '../core/timetableStore'
import { resolveViewSemester, loadCourseOverrides, resolveDisplayDay } from '../core/timetableView'
import { academicYear } from '../core/syllabus'

const DAY_LABELS: Record<DayOfWeek, string> = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土' }

export function TodayTimetable({ courses, assignments, manualAssignments, newCodes }: {
  courses: Course[]; assignments: Assignment[]; manualAssignments: ManualAssignment[]; newCodes: string[]
}) {
  const now = new Date()
  const year = academicYear(now)
  const { day, label } = resolveDisplayDay(now)
  const [rawHtml, setRawHtml] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, { room?: string }>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    void (async () => {
      const semester = await resolveViewSemester(year, now)
      const cap = await getTimetableCapture(year, semester)
      setRawHtml(cap?.rawTableHtml ?? null)
      setOverrides(await loadCourseOverrides(year, semester, courses))
      setLoaded(true)
    })()
  }, [year, courses])

  const slots: TimetableSlot[] = useMemo(() => {
    if (!rawHtml) return []
    return applyOverrides(parseTimetable(rawHtml), overrides)
  }, [rawHtml, overrides])

  const { courseCodeUrgency } = useMemo(
    () => linkAssignmentsToSlots(slots, courses, assignments, manualAssignments, now),
    [slots, courses, assignments, manualAssignments, now],
  )

  const todayClasses = useMemo(
    () => slots.filter((s) => s.day === day).sort((a, b) => a.period - b.period),
    [slots, day],
  )

  if (!loaded) return null
  if (rawHtml === null) {
    return (
      <section className="todayTimetable">
        <div className="todayTimetableHead">{label}の時間割</div>
        <p className="todayTimetableEmpty">CLASSの「履修 → 学生時間割表」を開くと取り込みます。</p>
      </section>
    )
  }

  return (
    <section className="todayTimetable">
      <div className="todayTimetableHead">{label}（{DAY_LABELS[day]}）の時間割</div>
      {todayClasses.length === 0 ? (
        <p className="todayTimetableEmpty">本日は授業なし</p>
      ) : (
        <ul className="todayTimetableList">
          {todayClasses.map((s) => {
            const c = s.classes[0]
            const tier = courseCodeUrgency[c.courseCode] ?? 'none'
            return (
              <li key={`${s.day}:${s.period}`} className="todayTimetableRow">
                <span className="todayPeriod">{s.period}</span>
                <span className="todayName">{c.name}</span>
                <span className="todayRoom">{c.room}</span>
                {tier !== 'none' && (
                  <span
                    className={`timetableUrgency ${tier}`}
                    title={tier === 'today' ? '当日提出の課題あり' : '今週提出の課題あり'}
                    aria-label={tier === 'today' ? '当日提出の課題あり' : '今週提出の課題あり'}
                  />
                )}
                {newCodes.includes(c.courseCode) && (
                  <span className="timetableNew" title="コース内容に更新あり" aria-label="コース内容に更新あり">NEW</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
