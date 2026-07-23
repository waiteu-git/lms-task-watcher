import { useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineItem } from '../utils/timeline'
import type { ManualAssignmentPatch } from '../core/manualAssignment'
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
  /** 締切未設定のスキャン課題にユーザー締切を設定する */
  onSetScanDeadline: (assignmentId: string, deadlineIso: string) => void
  /** スキャン課題をリストから非表示にする */
  onHideScanAssignment: (assignmentId: string) => void
  /** 手動課題の部分更新（締切変更時の通知再アームは呼び出し側が持つ） */
  onUpdateManualAssignment: (id: string, patch: ManualAssignmentPatch) => void
}

function formatChipTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** ISO文字列 → datetime-local の入力値（ローカル時刻）。 */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function ChipBody({ item, withTime }: { item: TimelineItem; withTime: boolean }) {
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

  if (!url) return <span className="calendarChipMain">{body}</span>
  return (
    <a className="calendarChipMain" href={url} target="_blank" rel="noreferrer">
      {body}
    </a>
  )
}

/** 締切入力の小型インラインエディタ（保存/キャンセルのみ）。 */
function DeadlineEditor({
  initialIso,
  submitLabel,
  onSave,
  onCancel,
}: {
  initialIso: string | null
  submitLabel: string
  onSave: (iso: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(toLocalInputValue(initialIso))
  return (
    <div className="calendarChipEditor">
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="締切日時"
      />
      <div className="calendarChipEditorActions">
        <button type="button" className="calendarChipBtn" onClick={onCancel}>
          キャンセル
        </button>
        <button
          type="button"
          className="calendarChipBtn primary"
          disabled={!value}
          onClick={() => {
            const parsed = new Date(value)
            if (Number.isNaN(parsed.getTime())) return
            onSave(parsed.toISOString())
          }}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}

function CalendarChip({
  item,
  withTime,
  onSetScanDeadline,
  onHideScanAssignment,
  onUpdateManualAssignment,
}: {
  item: TimelineItem
  withTime: boolean
} & Pick<Props, 'onSetScanDeadline' | 'onHideScanAssignment' | 'onUpdateManualAssignment'>) {
  const [editing, setEditing] = useState(false)
  const submitted = isTimelineItemSubmitted(item)
  const isManual = item.kind === 'manual'
  const isUndatedScan = item.kind === 'scan' && !item.assignment.deadline

  const className = `calendarChip${submitted ? ' submitted' : ''}${isManual ? ' manual' : ''}`

  return (
    <div className={className}>
      <ChipBody item={item} withTime={withTime} />

      {isManual && !editing && (
        <div className="calendarChipActions">
          <button
            type="button"
            className="calendarChipBtn"
            onClick={() =>
              onUpdateManualAssignment(item.assignment.id, { submitted: !submitted })
            }
          >
            {submitted ? '未提出に戻す' : '提出済みにする'}
          </button>
          <button type="button" className="calendarChipBtn" onClick={() => setEditing(true)}>
            ✎ 締切
          </button>
        </div>
      )}
      {isManual && editing && (
        <DeadlineEditor
          initialIso={item.assignment.deadline}
          submitLabel="変更"
          onCancel={() => setEditing(false)}
          onSave={(iso) => {
            onUpdateManualAssignment(item.assignment.id, { deadline: iso })
            setEditing(false)
          }}
        />
      )}

      {isUndatedScan && !editing && (
        <div className="calendarChipActions">
          <button type="button" className="calendarChipBtn" onClick={() => setEditing(true)}>
            ＋締切
          </button>
          <button
            type="button"
            className="calendarChipBtn"
            onClick={() => onHideScanAssignment(item.assignment.id)}
          >
            非表示
          </button>
        </div>
      )}
      {isUndatedScan && editing && (
        <DeadlineEditor
          initialIso={null}
          submitLabel="設定"
          onCancel={() => setEditing(false)}
          onSave={(iso) => {
            onSetScanDeadline(item.assignment.id, iso)
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}

export function WeeklyCalendarSection({
  items,
  onSetScanDeadline,
  onHideScanAssignment,
  onUpdateManualAssignment,
}: Props) {
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

  const chipHandlers = {
    onSetScanDeadline,
    onHideScanAssignment,
    onUpdateManualAssignment,
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
                    {...chipHandlers}
                  />
                ))
              )}
            </div>
          )
        })}
      </div>

      <UndatedArea items={week.undated} chipHandlers={chipHandlers} />
    </section>
  )
}

/**
 * 締切未設定リスト。提出済みは済んだものなので既定で畳んで格納し、
 * 未提出（＝締切を設定するか非表示にするか判断が要るもの）だけを見せる。
 */
function UndatedArea({
  items,
  chipHandlers,
}: {
  items: TimelineItem[]
  chipHandlers: Pick<
    Props,
    'onSetScanDeadline' | 'onHideScanAssignment' | 'onUpdateManualAssignment'
  >
}) {
  const [showSubmitted, setShowSubmitted] = useState(false)
  const active = items.filter((item) => !isTimelineItemSubmitted(item))
  const submitted = items.filter((item) => isTimelineItemSubmitted(item))

  if (items.length === 0) return null

  return (
    <div className="calendarUndated">
      <div className="calendarUndatedHead">
        <span className="calendarUndatedLabel">締切未設定</span>
        {submitted.length > 0 && (
          <button
            type="button"
            className="calendarChipBtn"
            onClick={() => setShowSubmitted((v) => !v)}
          >
            {showSubmitted
              ? '提出済みを隠す'
              : `提出済み ${submitted.length}件を表示`}
          </button>
        )}
      </div>
      {active.length === 0 && !showSubmitted && (
        <p className="calendarDayEmpty">未提出の締切未設定はありません。</p>
      )}
      <div className="calendarUndatedList">
        {active.map((item) => (
          <CalendarChip
            key={`${item.kind}-${item.assignment.id}`}
            item={item}
            withTime={false}
            {...chipHandlers}
          />
        ))}
        {showSubmitted &&
          submitted.map((item) => (
            <CalendarChip
              key={`${item.kind}-${item.assignment.id}`}
              item={item}
              withTime={false}
              {...chipHandlers}
            />
          ))}
      </div>
    </div>
  )
}
