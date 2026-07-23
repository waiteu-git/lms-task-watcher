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
  /** スキャン課題にユーザー締切を設定/変更する */
  onSetScanDeadline: (assignmentId: string, deadlineIso: string) => void
  /** ユーザー締切を外して自動検出に戻す */
  onClearScanDeadline: (assignmentId: string) => void
  /** スキャン課題をリストから非表示にする */
  onHideScanAssignment: (assignmentId: string) => void
  /** 手動課題の部分更新（締切変更時の通知再アームは呼び出し側が持つ） */
  onUpdateManualAssignment: (id: string, patch: ManualAssignmentPatch) => void
}

type ChipHandlers = Pick<
  Props,
  | 'onSetScanDeadline'
  | 'onClearScanDeadline'
  | 'onHideScanAssignment'
  | 'onUpdateManualAssignment'
>

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

/** 締切入力の小型インラインエディタ。手動課題では提出状況も同時に編集できる。 */
function DeadlineEditor({
  initialIso,
  submitLabel,
  submittedInitial,
  onSave,
  onClear,
  onCancel,
}: {
  initialIso: string | null
  submitLabel: string
  /** undefined なら提出状況チェックを出さない（スキャン課題） */
  submittedInitial?: boolean
  onSave: (iso: string, submitted?: boolean) => void
  /** ユーザー締切のクリア（自動検出に戻す）。不要なら省略 */
  onClear?: () => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(toLocalInputValue(initialIso))
  const [submitted, setSubmitted] = useState(submittedInitial ?? false)
  return (
    <div className="calendarChipEditor">
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="締切日時"
      />
      {submittedInitial !== undefined && (
        <label className="calendarChipEditorCheck">
          <input
            type="checkbox"
            checked={submitted}
            onChange={(e) => setSubmitted(e.target.checked)}
          />
          提出済み
        </label>
      )}
      <div className="calendarChipEditorActions">
        {onClear && (
          <button type="button" className="calendarChipBtn danger" onClick={onClear}>
            クリア
          </button>
        )}
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
            onSave(parsed.toISOString(), submittedInitial !== undefined ? submitted : undefined)
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
  onClearScanDeadline,
  onHideScanAssignment,
  onUpdateManualAssignment,
}: {
  item: TimelineItem
  withTime: boolean
} & ChipHandlers) {
  const [editing, setEditing] = useState(false)
  const submitted = isTimelineItemSubmitted(item)
  const isManual = item.kind === 'manual'
  const isUserDeadlineScan =
    item.kind === 'scan' && item.assignment.deadlineSource === 'user'
  const isUndatedScan = item.kind === 'scan' && !item.assignment.deadline
  // 右上✎ = ユーザーが自分で入れたもの（手動課題・手動締切）だけ編集できる
  const editable = isManual || isUserDeadlineScan

  const iconCount = editing ? 0 : editable ? 1 : isUndatedScan ? 2 : 0
  const className = `calendarChip${submitted ? ' submitted' : ''}${isManual ? ' manual' : ''}${iconCount > 0 ? ` hasIcons${iconCount}` : ''}`

  return (
    <div className={className}>
      {editable && !editing && (
        <div className="calendarChipIcons">
          <button
            type="button"
            className="calendarChipIconBtn"
            title={isManual ? '手動課題を編集' : '手動設定した締切を編集'}
            aria-label={isManual ? '手動課題を編集' : '手動設定した締切を編集'}
            onClick={() => setEditing(true)}
          >
            ✎
          </button>
        </div>
      )}

      {isUndatedScan && !editing && (
        <div className="calendarChipIcons">
          <button
            type="button"
            className="calendarChipIconBtn"
            title="締切を設定"
            aria-label="締切を設定"
            onClick={() => setEditing(true)}
          >
            ＋
          </button>
          <button
            type="button"
            className="calendarChipIconBtn danger"
            title="この課題をリストから非表示にする"
            aria-label="この課題をリストから非表示にする"
            onClick={() => onHideScanAssignment(item.assignment.id)}
          >
            ×
          </button>
        </div>
      )}

      <ChipBody item={item} withTime={withTime} />

      {isManual && editing && (
        <DeadlineEditor
          initialIso={item.assignment.deadline}
          submitLabel="変更"
          submittedInitial={item.assignment.submitted}
          onCancel={() => setEditing(false)}
          onSave={(iso, nextSubmitted) => {
            onUpdateManualAssignment(item.assignment.id, {
              deadline: iso,
              ...(nextSubmitted !== undefined ? { submitted: nextSubmitted } : {}),
            })
            setEditing(false)
          }}
        />
      )}

      {isUserDeadlineScan && editing && (
        <DeadlineEditor
          initialIso={item.assignment.deadline}
          submitLabel="変更"
          onCancel={() => setEditing(false)}
          onClear={() => {
            onClearScanDeadline(item.assignment.id)
            setEditing(false)
          }}
          onSave={(iso) => {
            onSetScanDeadline(item.assignment.id, iso)
            setEditing(false)
          }}
        />
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
  onClearScanDeadline,
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

  const chipHandlers: ChipHandlers = {
    onSetScanDeadline,
    onClearScanDeadline,
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
  chipHandlers: ChipHandlers
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
