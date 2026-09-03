import { useEffect, useMemo, useState } from 'react'
import type { Course, Assignment } from '../core/types'
import type { ManualAssignment } from '../core/manualAssignment'
import type { TimetableSlot, DayOfWeek, Quarter } from '../core/timetable'
import { parseTimetable } from '../core/timetable'
import type { Semester, TimetableOverride } from '../core/timetableLink'
import { applyOverrides, linkAssignmentsToSlots, extractCourseCodes, resolveCurrentQuarter, isDimmedForCurrentQuarter, findMissingCurrentSemester, findStaleDisplayedSemester } from '../core/timetableLink'
import { getTimetableCapture, getCurrentQuarter, listCapturedSemesters, setPreferredView } from '../core/timetableStore'
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
  const [overrides, setOverrides] = useState<Record<string, TimetableOverride>>({})
  const [loaded, setLoaded] = useState(false)
  const [semester, setSemester] = useState<Semester | null>(null)
  const [currentQuarterPref, setCurrentQuarterPref] = useState<Quarter | null>(null)
  const [missingSemester, setMissingSemester] = useState<Semester | null>(null)
  const [staleSemester, setStaleSemester] = useState<Semester | null>(null)

  useEffect(() => {
    // courses は1秒ごとに再生成されうる（App.refreshAll）。古い読み込みが新しいstateを
    // 上書きしないよう破棄フラグを張る。
    let alive = true
    void (async () => {
      const sem = await resolveViewSemester(year, now)
      const cap = await getTimetableCapture(year, sem)
      const ov = await loadCourseOverrides(year, sem, courses)
      const cq = await getCurrentQuarter(year, sem)
      const list = await listCapturedSemesters(year)
      if (!alive) return
      setRawHtml(cap?.rawTableHtml ?? null)
      setOverrides(ov)
      setSemester(sem)
      setCurrentQuarterPref(cq)
      setMissingSemester(findMissingCurrentSemester(now, list))
      setStaleSemester(findStaleDisplayedSemester(now, list, sem))
      setLoaded(true)
    })()
    return () => { alive = false }
  }, [year, courses])

  /** カードの「切り替える」から呼ぶ1タップ切替。表示学期を明示指定に固定する。 */
  async function switchToSemester(sem: Semester) {
    setSemester(sem)
    setStaleSemester(null)
    await setPreferredView(year, sem)
    const cap = await getTimetableCapture(year, sem)
    const ov = await loadCourseOverrides(year, sem, courses)
    const cq = await getCurrentQuarter(year, sem)
    setRawHtml(cap?.rawTableHtml ?? null)
    setOverrides(ov)
    setCurrentQuarterPref(cq)
  }

  /** 時間割セクションと同じ判断（純関数で共有）：手動指定が無ければ日付からの既定値。 */
  const currentQuarter: Quarter = resolveCurrentQuarter(currentQuarterPref, now, semester)

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

  const codeToUrl = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of courses) {
      if (!c.url) continue
      for (const code of extractCourseCodes(c.name)) if (!(code in m)) m[code] = c.url
    }
    return m
  }, [courses])

  const missingCard = missingSemester && (
    <section className="warningCard">
      <strong>{missingSemester === 'kouki' ? '後期' : '前期'}の時間割が未取込です</strong>
      <span>
        CLASSの「履修 → 学生時間割表」で{missingSemester === 'kouki' ? '後期' : '前期'}を表示すると、自動で取り込みます。
      </span>
      <button type="button" onClick={() => chrome.tabs.create({ url: 'https://class.admin.tus.ac.jp/' })}>
        CLASS を開く →
      </button>
    </section>
  )

  const staleCard = staleSemester && (
    <section className="warningCard">
      <strong>{staleSemester === 'kouki' ? '後期' : '前期'}の時間割は取込済みです</strong>
      <span>
        表示は{staleSemester === 'kouki' ? '前期' : '後期'}のままになっています。切り替えてください。
      </span>
      <button type="button" onClick={() => void switchToSemester(staleSemester)}>
        {staleSemester === 'kouki' ? '後期' : '前期'}の表示に切り替える →
      </button>
    </section>
  )

  if (!loaded) return null
  if (rawHtml === null) {
    return (
      <section className="todayTimetable">
        {missingCard}
        {staleCard}
        <div className="todayTimetableHead">{label}の時間割</div>
        <p className="todayTimetableEmpty">CLASSの「履修 → 学生時間割表」を開くと取り込みます。</p>
      </section>
    )
  }

  return (
    <section className="todayTimetable">
      {missingCard}
      {staleCard}
      <div className="todayTimetableHead">{label}（{DAY_LABELS[day]}）の時間割</div>
      {todayClasses.length === 0 ? (
        <p className="todayTimetableEmpty">本日は授業なし</p>
      ) : (
        <ul className="todayTimetableList">
          {/* 1コマに複数科目（クォーター科目）があるので全件出す。以前は classes[0] だけで片方が消えていた。 */}
          {todayClasses.flatMap((s) =>
            s.classes.map((c, i) => {
              const tier = courseCodeUrgency[c.courseCode] ?? 'none'
              const stacked = s.classes.length >= 2
              // 前半/後半が指定済みで今の半期と違うものは薄く（消しはしない：指定が誤っている可能性を残す）
              const dimmed = isDimmedForCurrentQuarter(c.quarter, currentQuarter, stacked)
              return (
                <li key={`${s.day}:${s.period}:${c.courseCode || c.name}:${i}`} className={`todayTimetableRow ${dimmed ? 'dimmed' : ''}`}>
                  <span className="todayPeriod">{s.period}</span>
                  {codeToUrl[c.courseCode] ? (
                    <button
                      type="button"
                      className="todayName todayNameLink"
                      title="LETUSのコースを開く"
                      onClick={() => chrome.tabs.create({ url: codeToUrl[c.courseCode] })}
                    >
                      {c.name}
                    </button>
                  ) : (
                    <span className="todayName">{c.name}</span>
                  )}
                  {stacked && c.quarter !== undefined && (
                    <span className="todayQuarter" title={c.quarter === 'first' ? '前半（1Q）の科目' : '後半（2Q）の科目'}>
                      {c.quarter === 'first' ? '前半' : '後半'}
                    </span>
                  )}
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
            }),
          )}
        </ul>
      )}
    </section>
  )
}
