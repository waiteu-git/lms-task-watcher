import { useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineItem } from '../utils/timeline'
import {
  addDays,
  buildCalendarWeek,
  calendarDateKey,
  formatDayLabel,
  formatWeekRangeLabel,
  isTimelineItemSubmitted,
  startOfCalendarWeek,
  timelineItemUrl,
} from '../core/calendarView'
import { buildCalendarIcs, icsFileName } from '../core/icsExport'

type Props = {
  /** 統合済みタイムライン（スキャン＋手動・オーバーライド適用済み・非表示除外済み） */
  items: TimelineItem[]
}

function formatChipTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function CalendarChip({ item, withTime }: { item: TimelineItem; withTime: boolean }) {
  const submitted = isTimelineItemSubmitted(item)
  const url = timelineItemUrl(item)
  const deadline = item.assignment.deadline

  const body = (
    <>
      {withTime && deadline && <span className="calendarChipTime">{formatChipTime(deadline)}</span>}
      <span className="calendarChipTitle">
        {submitted && <span className="calendarChipCheck">✓ </span>}
        {item.assignment.title}
      </span>
      <span className="calendarChipCourse">{item.assignment.courseName}</span>
    </>
  )

  const className = `calendarChip${submitted ? ' submitted' : ''}${item.kind === 'manual' ? ' manual' : ''}`

  if (!url) {
    return <span className={className}>{body}</span>
  }
  return (
    <a className={className} href={url} target="_blank" rel="noreferrer">
      {body}
    </a>
  )
}

export function WeeklyCalendarSection({ items }: Props) {
  const [weekOffset, setWeekOffset] = useState(0)
  const sectionRef = useRef<HTMLElement>(null)

  // popup の「カレンダーで見る」導線（?focus=calendar）から開かれたらここへスクロールする
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('focus') === 'calendar') {
      sectionRef.current?.scrollIntoView({ block: 'start' })
    }
  }, [])

  const reference = useMemo(
    () => addDays(startOfCalendarWeek(new Date()), weekOffset * 7),
    [weekOffset],
  )
  const week = useMemo(() => buildCalendarWeek(items, reference), [items, reference])
  const todayKey = calendarDateKey(new Date())
  const weekCount = useMemo(
    () => [...week.byDay.values()].reduce((sum, bucket) => sum + bucket.length, 0),
    [week],
  )

  function exportIcs() {
    const now = new Date()
    const blob = new Blob([buildCalendarIcs(items, now)], {
      type: 'text/calendar;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = icsFileName(now)
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="section weeklyCalendar" ref={sectionRef}>
      <div className="sectionHeader">
        <h2>週間カレンダー</h2>
        <div className="calendarControls">
          <button
            type="button"
            className="calendarNavBtn"
            aria-label="前の週"
            onClick={() => setWeekOffset((offset) => offset - 1)}
          >
            ◀
          </button>
          <button
            type="button"
            className="calendarNavBtn calendarTodayBtn"
            onClick={() => setWeekOffset(0)}
            disabled={weekOffset === 0}
          >
            今週
          </button>
          <button
            type="button"
            className="calendarNavBtn"
            aria-label="次の週"
            onClick={() => setWeekOffset((offset) => offset + 1)}
          >
            ▶
          </button>
        </div>
      </div>

      <div className="calendarMeta">
        <span className="calendarRange">
          {formatWeekRangeLabel(week.weekStart)}
          <span className="calendarWeekCount">{weekCount}件</span>
        </span>
        <button type="button" className="calendarExportBtn" onClick={exportIcs}>
          .ics で書き出す
        </button>
      </div>
      <p className="calendarExportNote">
        書き出した .ics は書き出し時点のスナップショットです（Googleカレンダー等に取り込めますが、自動では同期されません）。
      </p>

      <div className="calendarGrid">
        {week.days.map((day) => {
          const key = calendarDateKey(day)
          const dayItems = week.byDay.get(key) ?? []
          return (
            <div key={key} className={`calendarDay${key === todayKey ? ' isToday' : ''}`}>
              <div className="calendarDayLabel">{formatDayLabel(day)}</div>
              {dayItems.length === 0 ? (
                <p className="calendarDayEmpty" aria-hidden="true">
                  —
                </p>
              ) : (
                dayItems.map((item) => (
                  <CalendarChip
                    key={`${item.kind}-${item.assignment.id}`}
                    item={item}
                    withTime
                  />
                ))
              )}
            </div>
          )
        })}
      </div>

      {week.undated.length > 0 && (
        <div className="calendarUndated">
          <span className="calendarUndatedLabel">締切未設定</span>
          <div className="calendarUndatedList">
            {week.undated.map((item) => (
              <CalendarChip
                key={`${item.kind}-${item.assignment.id}`}
                item={item}
                withTime={false}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
