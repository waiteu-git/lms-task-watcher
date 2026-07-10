import { useContext, useEffect, useMemo, useState } from 'react'
import type { Course, Assignment } from '../core/types'
import type { ManualAssignment } from '../core/manualAssignment'
import type { DayOfWeek, TimetableSlot } from '../core/timetable'
import { parseTimetable } from '../core/timetable'
import { getTimetableCapture, listCapturedSemesters, getPreferredView, setPreferredView, setOverride } from '../core/timetableStore'
import type { Semester } from '../core/timetableLink'
import { resolveSemester, applyOverrides, linkAssignmentsToSlots, extractCourseCodes } from '../core/timetableLink'
import { loadCourseOverrides } from '../core/timetableView'
import { SyllabusContext } from '../core/syllabusContext'
import { buildSyllabusUrl, academicYear } from '../core/syllabus'

const DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri']
const DAY_LABELS: Record<DayOfWeek, string> = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土' }
const JS_DAY_TO_DOW: Record<number, DayOfWeek | undefined> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' }
const PERIODS = [1, 2, 3, 4, 5, 6, 7]

export function TimetableSection({ courses, assignments, manualAssignments, newCodes }: {
  courses: Course[]; assignments: Assignment[]; manualAssignments: ManualAssignment[]; newCodes: string[]
}) {
  const now = new Date()
  const year = academicYear(now)
  const openSyllabus = useContext(SyllabusContext)
  const [semester, setSemester] = useState<Semester | null>(null)
  const [captured, setCaptured] = useState<Semester[]>([])
  const [rawHtml, setRawHtml] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, { room?: string }>>({})
  const [open, setOpen] = useState(true)

  useEffect(() => {
    void (async () => {
      const list = await listCapturedSemesters(year)
      setCaptured(list.map((c) => c.semester))
      const pref = await getPreferredView()
      const initial = pref?.semester ?? resolveSemester(now, list)
      setSemester(initial)
    })()
  }, [year])

  useEffect(() => {
    if (!semester) return
    void (async () => {
      const cap = await getTimetableCapture(year, semester)
      setRawHtml(cap?.rawTableHtml ?? null)
      setOverrides(await loadCourseOverrides(year, semester, courses))
    })()
  }, [semester, year, courses])

  const slots: TimetableSlot[] = useMemo(() => {
    if (!rawHtml) return []
    return applyOverrides(parseTimetable(rawHtml), overrides)
  }, [rawHtml, overrides])

  const { courseCodeUrgency } = useMemo(
    () => linkAssignmentsToSlots(slots, courses, assignments, manualAssignments, now),
    [slots, courses, assignments, manualAssignments, now],
  )

  const grid = useMemo(() => {
    const m = new Map<string, TimetableSlot['classes'][number]>()
    for (const s of slots) for (const c of s.classes) m.set(`${s.day}:${s.period}`, c)
    return m
  }, [slots])

  const codeToUrl = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of courses) {
      if (!c.url) continue
      for (const code of extractCourseCodes(c.name)) if (!(code in m)) m[code] = c.url
    }
    return m
  }, [courses])

  const todayDow = JS_DAY_TO_DOW[now.getDay()]

  async function chooseSemester(s: Semester) {
    setSemester(s)
    await setPreferredView(year, s)
  }

  async function editRoom(courseCode: string, current: string) {
    if (!semester) return
    const next = window.prompt('教室を編集', current)
    if (next === null) return
    await setOverride(year, semester, courseCode, { room: next })
    setOverrides((prev) => ({ ...prev, [courseCode]: { room: next } }))
  }

  const maxPeriod = slots.reduce((max, s) => Math.max(max, s.period), 5)
  const rows = PERIODS.filter((p) => p <= Math.max(5, maxPeriod))

  return (
    <section className="timetableSection">
      <div className="timetableHeader">
        <button type="button" className="timetableToggle" onClick={() => setOpen((v) => !v)}>
          時間割 <span className="timetableYear">{year} {semester === 'kouki' ? '後期' : '前期'}</span>
          <span>{open ? '▲' : '▼'}</span>
        </button>
        <div className="semesterToggle">
          {(['zenki', 'kouki'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`semesterBtn ${semester === s ? 'active' : ''}`}
              disabled={!captured.includes(s)}
              onClick={() => void chooseSemester(s)}
            >
              {s === 'zenki' ? '前期' : '後期'}
            </button>
          ))}
        </div>
      </div>

      {open && (
        rawHtml === null ? (
          <p className="timetableEmpty">
            CLASSの「履修 → 学生時間割表」を開くと、この学期の時間割を自動で取り込みます。
          </p>
        ) : slots.length === 0 ? (
          <p className="timetableEmpty">時間割を読み取れませんでした。ページを再読込して再度お試しください。</p>
        ) : (
          <div className="timetableGrid" style={{ gridTemplateColumns: `28px repeat(${DAYS.length}, 1fr)` }}>
            <div />
            {DAYS.map((d) => (
              <div key={d} className={`timetableDayHead ${d === todayDow ? 'today' : ''}`}>{DAY_LABELS[d]}</div>
            ))}
            {rows.map((period) => (
              <div key={`row-${period}`} style={{ display: 'contents' }}>
                <div className="timetablePeriodHead">{period}</div>
                {DAYS.map((d) => {
                  const c = grid.get(`${d}:${period}`)
                  if (!c) return <div key={`${d}:${period}`} className={`timetableCell empty ${d === todayDow ? 'today' : ''}`} />
                  return (
                    <div key={`${d}:${period}`} className={`timetableCell ${d === todayDow ? 'today' : ''}`}>
                      {codeToUrl[c.courseCode] ? (
                        <button
                          type="button"
                          className="timetableCellName timetableCellNameLink"
                          title="LETUSのコースを開く"
                          onClick={() => chrome.tabs.create({ url: codeToUrl[c.courseCode] })}
                        >
                          {c.name}
                        </button>
                      ) : (
                        <div className="timetableCellName">{c.name}</div>
                      )}
                      <div className="timetableCellRoom">{c.room}</div>
                      <div className="timetableCellMeta">
                        {(() => {
                          const tier = courseCodeUrgency[c.courseCode] ?? 'none'
                          return tier === 'none' ? null : (
                            <span
                              className={`timetableUrgency ${tier}`}
                              title={tier === 'today' ? '当日提出の課題あり' : '今週提出の課題あり'}
                              aria-label={tier === 'today' ? '当日提出の課題あり' : '今週提出の課題あり'}
                            />
                          )
                        })()}
                        {newCodes.includes(c.courseCode) && (
                          <span className="timetableNew" title="コース内容に更新あり" aria-label="コース内容に更新あり">NEW</span>
                        )}
                        {c.courseCode && (
                          openSyllabus ? (
                            <button
                              type="button"
                              className="timetableSyllabus"
                              title="シラバス"
                              onClick={() => openSyllabus(year, c.courseCode, c.name)}
                            >
                              📖
                            </button>
                          ) : (
                            <a className="timetableSyllabus" href={buildSyllabusUrl(c.courseCode, now)} target="_blank" rel="noreferrer" title="シラバス">📖</a>
                          )
                        )}
                        {c.courseCode && (
                          <button type="button" className="timetableEditRoom" title="教室を編集" onClick={() => void editRoom(c.courseCode, c.room)}>✎</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )
      )}
    </section>
  )
}
