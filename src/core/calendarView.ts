/**
 * 週間カレンダービュー（v1.4.0）の純関数層。
 *
 * データは popup/dashboard が既に持つ統合タイムライン（TimelineItem =
 * スキャン課題＋手動課題・締切オーバーライド適用済み）をそのまま受け取り、
 * 週単位のバケツ詰めだけを行う。新しい収集・通信は一切持たない。
 *
 * 日付は全てユーザーのローカル時刻（JST前提・vitest.setup.ts でTZ固定）で扱う。
 */
import type { TimelineItem } from '../utils/timeline'
import { isSubmittedAssignment } from '../utils/assignment'

const DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 参照日を含む週の月曜0時（ローカル）。日曜は週の末尾として前の月曜へ戻る。 */
export function startOfCalendarWeek(reference: Date): Date {
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  const day = start.getDay()
  const diffToMonday = day === 0 ? 6 : day - 1
  start.setDate(start.getDate() - diffToMonday)
  return start
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** ローカル日付キー（YYYY-MM-DD）。UTCではなくユーザーの体感日付で揃える。 */
export function calendarDateKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

export type CalendarWeek = {
  weekStart: Date
  /** 月曜〜日曜の7日 */
  days: Date[]
  /** ローカル日付キー → その日が締切の課題（時刻昇順） */
  byDay: Map<string, TimelineItem[]>
  /** 締切未設定の課題（週に依存しない） */
  undated: TimelineItem[]
}

function deadlineTime(item: TimelineItem): number {
  const deadline = item.assignment.deadline
  return deadline ? new Date(deadline).getTime() : Number.POSITIVE_INFINITY
}

export function buildCalendarWeek(items: TimelineItem[], reference: Date): CalendarWeek {
  const weekStart = startOfCalendarWeek(reference)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekEnd = addDays(weekStart, 7)

  const byDay = new Map<string, TimelineItem[]>()
  const undated: TimelineItem[] = []

  for (const item of items) {
    const iso = item.assignment.deadline
    if (!iso) {
      undated.push(item)
      continue
    }
    const deadline = new Date(iso)
    if (Number.isNaN(deadline.getTime())) {
      undated.push(item)
      continue
    }
    if (deadline < weekStart || deadline >= weekEnd) continue

    const key = calendarDateKey(deadline)
    const bucket = byDay.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      byDay.set(key, [item])
    }
  }

  for (const bucket of byDay.values()) {
    bucket.sort((a, b) => deadlineTime(a) - deadlineTime(b))
  }

  return { weekStart, days, byDay, undated }
}

/** 提出済み判定。スキャン課題は既存の isSubmittedAssignment と同一基準。 */
export function isTimelineItemSubmitted(item: TimelineItem): boolean {
  if (item.kind === 'manual') return item.assignment.submitted
  return isSubmittedAssignment(item.assignment)
}

/** カード押下で開くURL。手動課題はURL未設定がありうる。 */
export function timelineItemUrl(item: TimelineItem): string | null {
  if (item.kind === 'manual') return item.assignment.letusUrl
  return item.assignment.url
}

export function formatDayLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}（${DAY_LABELS[date.getDay()]}）`
}

export function formatWeekRangeLabel(weekStart: Date): string {
  return `${formatDayLabel(weekStart)}〜 ${formatDayLabel(addDays(weekStart, 6))}`
}

export type UndatedGroup = { courseId: string; courseName: string; items: TimelineItem[] }

/**
 * 締切未設定リストをコースごとにグループ化する。
 * 同一コースの課題が threshold 件以上あれば折りたたみ対象の groups へ、
 * それ未満（既定: 1〜2件）は単発カードのまま見せる singles へ分ける。
 * groups は件数の多い順。singles はコースの初出順を保ったまま、
 * 同一コースの1〜2件は隣接して並ぶ（安定した groupby の副作用）。
 */
export function groupUndatedItems(
  items: TimelineItem[],
  threshold = 3,
): { groups: UndatedGroup[]; singles: TimelineItem[] } {
  const byCourse = new Map<string, TimelineItem[]>()
  for (const item of items) {
    const courseId = item.assignment.courseId
    const bucket = byCourse.get(courseId)
    if (bucket) bucket.push(item)
    else byCourse.set(courseId, [item])
  }

  const groups: UndatedGroup[] = []
  const singles: TimelineItem[] = []
  for (const [courseId, courseItems] of byCourse) {
    if (courseItems.length >= threshold) {
      groups.push({ courseId, courseName: courseItems[0].assignment.courseName, items: courseItems })
    } else {
      singles.push(...courseItems)
    }
  }
  groups.sort((a, b) => b.items.length - a.items.length)

  return { groups, singles }
}
