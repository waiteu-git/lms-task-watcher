import { useContext, useEffect, useMemo, useState } from 'react'
import type { Course, Assignment } from '../core/types'
import type { ManualAssignment } from '../core/manualAssignment'
import type { DayOfWeek, TimetableSlot, Quarter } from '../core/timetable'
import { parseTimetable } from '../core/timetable'
import { getTimetableCapture, listCapturedSemesters, getPreferredView, setPreferredView, setOverride, getCurrentQuarter, setCurrentQuarter } from '../core/timetableStore'
import type { Semester, TimetableOverride } from '../core/timetableLink'
import { applyOverrides, linkAssignmentsToSlots, extractCourseCodes, isQuarterSlot, resolveCurrentQuarter, isDimmedForCurrentQuarter, findMissingCurrentSemester, findStaleDisplayedSemester, resolveSemester } from '../core/timetableLink'
import { loadCourseOverrides, resolveViewSemester } from '../core/timetableView'
import { SyllabusContext } from '../core/syllabusContext'
import { buildSyllabusUrl, academicYear } from '../core/syllabus'
import { formatDateTime } from '../utils/date'

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
  /** 表示学期の手動指定。null は未指定＝自動（取得済み最新を使う）。3択トグルの選択状態を表す。 */
  const [semesterPref, setSemesterPref] = useState<Semester | null>(null)
  const [captured, setCaptured] = useState<Semester[]>([])
  const [missingSemester, setMissingSemester] = useState<Semester | null>(null)
  const [staleSemester, setStaleSemester] = useState<Semester | null>(null)
  const [rawHtml, setRawHtml] = useState<string | null>(null)
  const [capturedAt, setCapturedAt] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, TimetableOverride>>({})
  const [open, setOpen] = useState(true)
  /** 「今が前半/後半か」。null は未指定＝日付からの既定値を使う。 */
  const [currentQuarterPref, setCurrentQuarterPref] = useState<Quarter | null>(null)

  useEffect(() => {
    void (async () => {
      const list = await listCapturedSemesters(year)
      setCaptured(list.map((c) => c.semester))
      setMissingSemester(findMissingCurrentSemester(now, list))
      const pref = await getPreferredView()
      setSemesterPref(pref?.year === year ? pref.semester : null)
      const initial = await resolveViewSemester(year, now)
      setSemester(initial)
      setStaleSemester(findStaleDisplayedSemester(now, list, initial))
    })()
  }, [year])

  useEffect(() => {
    if (!semester) return
    // 学期を素早く切り替えると複数の非同期読み込みが競合し、古い学期のデータで新しいstateを
    // 上書きしうる（さらにその隙にquarter指定すると別学期の孤児オーバーライドが残る）。
    // 破棄フラグで、上書きされた読み込みが後からsetStateしないようにする。
    let alive = true
    void (async () => {
      const cap = await getTimetableCapture(year, semester)
      const ov = await loadCourseOverrides(year, semester, courses)
      const cq = await getCurrentQuarter(year, semester)
      if (!alive) return
      setRawHtml(cap?.rawTableHtml ?? null)
      setCapturedAt(cap?.capturedAt ?? null)
      setOverrides(ov)
      setCurrentQuarterPref(cq)
    })()
    return () => { alive = false }
  }, [semester, year, courses])

  const slots: TimetableSlot[] = useMemo(() => {
    if (!rawHtml) return []
    return applyOverrides(parseTimetable(rawHtml), overrides)
  }, [rawHtml, overrides])

  const { courseCodeUrgency } = useMemo(
    () => linkAssignmentsToSlots(slots, courses, assignments, manualAssignments, now),
    [slots, courses, assignments, manualAssignments, now],
  )

  /**
   * 1コマに複数科目が入る（クォーター科目は同一曜限に2科目積まれる）ため、コマ→科目「配列」で持つ。
   * 以前は Map<コマ, 科目> で後勝ち上書きしており、積まれた科目が1つ消えていた。
   */
  const grid = useMemo(() => {
    const m = new Map<string, TimetableSlot['classes']>()
    for (const s of slots) {
      const key = `${s.day}:${s.period}`
      const cur = m.get(key)
      if (cur) cur.push(...s.classes)
      else m.set(key, [...s.classes])
    }
    return m
  }, [slots])

  /** 積みコマ（=半期科目）が1つでもあるときだけ、前半/後半の指定UIを出す。 */
  const hasQuarterSlots = useMemo(() => slots.some(isQuarterSlot), [slots])
  /** 実際に適用する「現在の半期」。手動指定が無ければ日付からの既定値（純関数で TodayTimetable と共有）。 */
  const currentQuarter: Quarter = resolveCurrentQuarter(currentQuarterPref, now, semester)

  const codeToUrl = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of courses) {
      if (!c.url) continue
      for (const code of extractCourseCodes(c.name)) if (!(code in m)) m[code] = c.url
    }
    return m
  }, [courses])

  const todayDow = JS_DAY_TO_DOW[now.getDay()]

  /** 表示学期を選ぶ。null＝自動（取得済み最新を使う）。前期/後期/自動の明示3択。 */
  async function chooseSemester(next: Semester | null) {
    setSemesterPref(next)
    setStaleSemester(null)
    await setPreferredView(year, next)
    const displayed = next ?? resolveSemester(now, await listCapturedSemesters(year))
    setSemester(displayed)
  }

  async function editRoom(courseCode: string, current: string) {
    if (!semester) return
    const next = window.prompt('教室を編集', current)
    if (next === null) return
    await setOverride(year, semester, courseCode, { room: next })
    // 既存フィールド（quarter）を保持したままマージする。置換すると教室編集で前半/後半の指定が消える。
    setOverrides((prev) => ({ ...prev, [courseCode]: { ...prev[courseCode], room: next } }))
  }

  /** 半期科目に前半/後半を指定する。同じ値を再度押すと指定解除。 */
  async function assignQuarter(courseCode: string, quarter: Quarter | undefined) {
    if (!semester) return
    await setOverride(year, semester, courseCode, { quarter })
    setOverrides((prev) => {
      const merged: TimetableOverride = { ...prev[courseCode] }
      if (quarter === undefined) delete merged.quarter
      else merged.quarter = quarter
      const nextAll = { ...prev }
      // フィールドが全て消えたらキーごと除去し、storage(setOverride)側の空キー削除と状態を揃える。
      if (Object.keys(merged).length === 0) delete nextAll[courseCode]
      else nextAll[courseCode] = merged
      return nextAll
    })
  }

  /** 「現在の半期」を選ぶ。null＝自動（日付からの既定値）。前半/後半/自動の明示3択。 */
  async function chooseCurrentQuarter(next: Quarter | null) {
    if (!semester) return
    setCurrentQuarterPref(next)
    await setCurrentQuarter(year, semester, next)
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
        <div className="semesterToggle" role="group" aria-label="表示学期の切替">
          {([['zenki', '前期'], ['kouki', '後期'], [null, '自動']] as const).map(([val, label]) => {
            const active = semesterPref === val
            return (
              <button
                key={label}
                type="button"
                className={`semesterBtn ${active ? 'active' : ''}`}
                disabled={val !== null && !captured.includes(val)}
                aria-pressed={active}
                title={val === null ? '取得済み最新を自動選択します（新しい学期を取り込むと自動で切り替わります）' : undefined}
                onClick={() => void chooseSemester(val)}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {missingSemester && (
        <section className="warningCard">
          <strong>{missingSemester === 'kouki' ? '後期' : '前期'}の時間割が未取込です</strong>
          <span>
            CLASSの「履修 → 学生時間割表」で{missingSemester === 'kouki' ? '後期' : '前期'}を表示すると、自動で取り込みます。
            表示中の時間割は前の学期のものです。
          </span>
          <button type="button" onClick={() => chrome.tabs.create({ url: 'https://class.admin.tus.ac.jp/' })}>
            CLASS を開く →
          </button>
        </section>
      )}

      {staleSemester && (
        <section className="warningCard">
          <strong>{staleSemester === 'kouki' ? '後期' : '前期'}の時間割は取込済みです</strong>
          <span>
            表示は{staleSemester === 'kouki' ? '前期' : '後期'}のままになっています。切り替えてください。
          </span>
          <button type="button" onClick={() => void chooseSemester(staleSemester)}>
            {staleSemester === 'kouki' ? '後期' : '前期'}の表示に切り替える →
          </button>
        </section>
      )}

      {rawHtml !== null && capturedAt && (
        <p className="timetableCapturedAt">最終取込 {formatDateTime(capturedAt)}</p>
      )}

      {open && hasQuarterSlots && (
        <div className="quarterBar" role="group" aria-label="クォーター科目の表示切替">
          <span className="quarterBarLabel" title="同じコマに2科目ある授業（クォーター科目）の、今どちらを強調表示するかを選びます">現在</span>
          {([['first', '前半'], ['second', '後半'], [null, '自動']] as const).map(([val, label]) => {
            const active = currentQuarterPref === val
            return (
              <button
                key={label}
                type="button"
                className={`quarterBarBtn ${active ? 'active' : ''}`}
                aria-pressed={active}
                title={val === null ? '日付から自動判定（境界時期は手動で切り替えてください）' : `${label}の科目を強調し、もう一方を薄く表示`}
                onClick={() => void chooseCurrentQuarter(val)}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

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
                  const list = grid.get(`${d}:${period}`)
                  if (!list || list.length === 0) return <div key={`${d}:${period}`} className={`timetableCell empty ${d === todayDow ? 'today' : ''}`} />
                  // 同一コマ2科目以上＝クォーター科目。全件描画する（以前は1件しか出ていなかった）。
                  const stacked = list.length >= 2
                  return (
                    <div key={`${d}:${period}`} className={`timetableCell ${stacked ? 'stacked' : ''} ${d === todayDow ? 'today' : ''}`}>
                      {list.map((c, i) => {
                        // 前半/後半が指定済みで、今の半期と違う科目は薄く表示（消さない）
                        const dimmed = isDimmedForCurrentQuarter(c.quarter, currentQuarter, stacked)
                        return (
                          <div key={`${c.courseCode || c.name}:${i}`} className={`timetableClass ${dimmed ? 'dimmed' : ''}`}>
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
                            {stacked && c.courseCode && (
                              <div className="timetableQuarterPick">
                                {(['first', 'second'] as const).map((q) => (
                                  <button
                                    key={q}
                                    type="button"
                                    className={`quarterPickBtn ${c.quarter === q ? 'active' : ''}`}
                                    aria-pressed={c.quarter === q}
                                    title={q === 'first' ? '前半（1Q）の科目に指定' : '後半（2Q）の科目に指定'}
                                    onClick={() => void assignQuarter(c.courseCode, c.quarter === q ? undefined : q)}
                                  >
                                    {q === 'first' ? '前半' : '後半'}
                                  </button>
                                ))}
                              </div>
                            )}
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
