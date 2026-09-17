import { describe, it, expect } from 'vitest'
import type { Assignment } from './types'
import type { ManualAssignment } from './manualAssignment'
import type { TimelineItem } from '../utils/timeline'
import {
  startOfCalendarWeek,
  addDays,
  calendarDateKey,
  buildCalendarWeek,
  isTimelineItemSubmitted,
  formatWeekRangeLabel,
  formatDayLabel,
  timelineItemUrl,
  groupUndatedItems,
} from './calendarView'

function scanned(over: Partial<Assignment> = {}): TimelineItem {
  return {
    kind: 'scan',
    assignment: {
      id: 'a1',
      courseId: 'c1',
      courseName: '電気数学',
      title: 'レポート1',
      url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=123',
      deadline: '2026-07-22T14:59:00.000Z', // JST 2026-07-22 23:59
      deadlineText: '',
      deadlineSource: null,
      sourceText: '',
      submissionStatus: 'not_submitted',
      lifecycleStatus: 'active',
      detectedAt: '',
      firstSeenAt: '',
      lastSeenAt: '',
      lastCheckedAt: '',
      ...over,
    },
  }
}

function manual(over: Partial<ManualAssignment> = {}): TimelineItem {
  return {
    kind: 'manual',
    assignment: {
      id: 'm1',
      courseId: 'c1',
      courseName: '電気数学',
      title: '自主ゼミ資料',
      letusUrl: null,
      deadline: '2026-07-23T03:00:00.000Z', // JST 2026-07-23 12:00
      memo: '',
      submitted: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      ...over,
    },
  }
}

describe('startOfCalendarWeek', () => {
  it('水曜日を渡すと同じ週の月曜0時(ローカル)を返す', () => {
    // 2026-07-22 は水曜日
    const start = startOfCalendarWeek(new Date(2026, 6, 22, 15, 30))
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(6)
    expect(start.getDate()).toBe(20) // 月曜
    expect(start.getDay()).toBe(1)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
  })

  it('月曜日はその日自身の0時を返す', () => {
    const start = startOfCalendarWeek(new Date(2026, 6, 20, 9, 0))
    expect(start.getDate()).toBe(20)
    expect(start.getDay()).toBe(1)
  })

  it('日曜日は前の月曜へ戻る（週の末尾扱い）', () => {
    // 2026-07-26 は日曜日
    const start = startOfCalendarWeek(new Date(2026, 6, 26, 23, 0))
    expect(start.getDate()).toBe(20)
    expect(start.getDay()).toBe(1)
  })
})

describe('addDays / calendarDateKey', () => {
  it('日付を跨いだ加算とローカル日付キーが一致する', () => {
    const monday = new Date(2026, 6, 20)
    expect(calendarDateKey(addDays(monday, 6))).toBe('2026-07-26')
    expect(calendarDateKey(addDays(monday, 12))).toBe('2026-08-01')
  })

  it('月初の1桁日もゼロ埋めされる', () => {
    expect(calendarDateKey(new Date(2026, 7, 3))).toBe('2026-08-03')
  })
})

describe('buildCalendarWeek', () => {
  it('週内の課題を締切のローカル日付ごとにまとめる', () => {
    const items = [scanned(), manual()]
    const week = buildCalendarWeek(items, new Date(2026, 6, 22))

    expect(week.days).toHaveLength(7)
    expect(calendarDateKey(week.weekStart)).toBe('2026-07-20')
    expect(week.byDay.get('2026-07-22')).toHaveLength(1)
    expect(week.byDay.get('2026-07-23')).toHaveLength(1)
    expect(week.undated).toHaveLength(0)
  })

  it('週外の課題は日別バケツに入らない', () => {
    const nextWeek = scanned({ id: 'a2', deadline: '2026-07-29T14:59:00.000Z' })
    const week = buildCalendarWeek([nextWeek], new Date(2026, 6, 22))
    expect([...week.byDay.values()].flat()).toHaveLength(0)
  })

  it('締切なしの課題は undated に入り、週を切り替えても残る', () => {
    const noDeadline = scanned({ id: 'a3', deadline: null })
    const week1 = buildCalendarWeek([noDeadline], new Date(2026, 6, 22))
    const week2 = buildCalendarWeek([noDeadline], new Date(2026, 6, 29))
    expect(week1.undated).toHaveLength(1)
    expect(week2.undated).toHaveLength(1)
  })

  it('同日の課題は締切時刻の昇順で並ぶ', () => {
    const late = scanned({ id: 'late', deadline: '2026-07-22T14:59:00.000Z' })
    const early = scanned({ id: 'early', deadline: '2026-07-22T00:00:00.000Z' })
    const week = buildCalendarWeek([late, early], new Date(2026, 6, 22))
    const day = week.byDay.get('2026-07-22')!
    expect(day.map((i) => i.assignment.id)).toEqual(['early', 'late'])
  })

  it('JSTの日付境界（UTC 15時）で正しい日に入る', () => {
    // UTC 2026-07-22T15:00 = JST 2026-07-23 00:00
    const boundary = scanned({ id: 'b', deadline: '2026-07-22T15:00:00.000Z' })
    const week = buildCalendarWeek([boundary], new Date(2026, 6, 22))
    expect(week.byDay.get('2026-07-23')?.map((i) => i.assignment.id)).toEqual(['b'])
    expect(week.byDay.get('2026-07-22') ?? []).toHaveLength(0)
  })
})

describe('isTimelineItemSubmitted', () => {
  it('スキャン課題は submissionStatus / lifecycleStatus から判定する', () => {
    expect(isTimelineItemSubmitted(scanned())).toBe(false)
    expect(isTimelineItemSubmitted(scanned({ submissionStatus: 'submitted' }))).toBe(true)
    expect(isTimelineItemSubmitted(scanned({ submissionStatus: 'completed' }))).toBe(true)
    expect(isTimelineItemSubmitted(scanned({ lifecycleStatus: 'submitted' }))).toBe(true)
  })

  it('手動課題は submitted フラグで判定する', () => {
    expect(isTimelineItemSubmitted(manual())).toBe(false)
    expect(isTimelineItemSubmitted(manual({ submitted: true }))).toBe(true)
  })
})

describe('timelineItemUrl', () => {
  it('スキャン課題は url、手動課題は letusUrl を返す', () => {
    expect(timelineItemUrl(scanned())).toBe(
      'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=123',
    )
    expect(timelineItemUrl(manual())).toBeNull()
    expect(
      timelineItemUrl(manual({ letusUrl: 'https://letus.ed.tus.ac.jp/course/view.php?id=1' })),
    ).toBe('https://letus.ed.tus.ac.jp/course/view.php?id=1')
  })
})

describe('ラベル整形', () => {
  it('週範囲ラベルは月曜〜日曜を M/D 形式で示す', () => {
    expect(formatWeekRangeLabel(new Date(2026, 6, 20))).toBe('7/20（月）〜 7/26（日）')
  })

  it('月跨ぎの週も両端の月を表示する', () => {
    expect(formatWeekRangeLabel(new Date(2026, 6, 27))).toBe('7/27（月）〜 8/2（日）')
  })

  it('日ラベルは M/D（曜）形式', () => {
    expect(formatDayLabel(new Date(2026, 6, 22))).toBe('7/22（水）')
  })
})

describe('groupUndatedItems', () => {
  it('同一コースが3件以上ならグループにまとまる', () => {
    const items = [
      scanned({ id: 'a1', courseId: 'c1', courseName: 'ドイツ語A', deadline: null }),
      scanned({ id: 'a2', courseId: 'c1', courseName: 'ドイツ語A', deadline: null }),
      scanned({ id: 'a3', courseId: 'c1', courseName: 'ドイツ語A', deadline: null }),
    ]
    const { groups, singles } = groupUndatedItems(items)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toEqual({ courseId: 'c1', courseName: 'ドイツ語A', items })
    expect(singles).toHaveLength(0)
  })

  it('同一コースが2件以下なら singles に残る（グループ化しない）', () => {
    const items = [
      scanned({ id: 'a1', courseId: 'c2', courseName: '基礎情報工学A', deadline: null }),
      scanned({ id: 'a2', courseId: 'c2', courseName: '基礎情報工学A', deadline: null }),
    ]
    const { groups, singles } = groupUndatedItems(items)
    expect(groups).toHaveLength(0)
    expect(singles).toEqual(items)
  })

  it('件数がちょうど閾値(3)のコースはグループ化される境界確認', () => {
    const items = [
      scanned({ id: 'a1', courseId: 'c3', deadline: null }),
      scanned({ id: 'a2', courseId: 'c3', deadline: null }),
      scanned({ id: 'a3', courseId: 'c3', deadline: null }),
    ]
    expect(groupUndatedItems(items, 3).groups).toHaveLength(1)
    expect(groupUndatedItems(items, 4).groups).toHaveLength(0)
  })

  it('グループは件数降順で並ぶ', () => {
    const items = [
      scanned({ id: 'b1', courseId: 'small', deadline: null }),
      scanned({ id: 'b2', courseId: 'small', deadline: null }),
      scanned({ id: 'b3', courseId: 'small', deadline: null }),
      scanned({ id: 'l1', courseId: 'large', deadline: null }),
      scanned({ id: 'l2', courseId: 'large', deadline: null }),
      scanned({ id: 'l3', courseId: 'large', deadline: null }),
      scanned({ id: 'l4', courseId: 'large', deadline: null }),
      scanned({ id: 'l5', courseId: 'large', deadline: null }),
    ]
    const { groups } = groupUndatedItems(items)
    expect(groups.map((g) => g.courseId)).toEqual(['large', 'small'])
    expect(groups.map((g) => g.items.length)).toEqual([5, 3])
  })

  it('空配列は空のgroups/singlesを返す', () => {
    expect(groupUndatedItems([])).toEqual({ groups: [], singles: [] })
  })

  it('scan由来とmanual由来が同一courseIdなら1グループにまとまる', () => {
    const items = [
      scanned({ id: 'a1', courseId: 'c4', courseName: '化学A', deadline: null }),
      manual({ id: 'm1', courseId: 'c4', courseName: '化学A' }),
      scanned({ id: 'a2', courseId: 'c4', courseName: '化学A', deadline: null }),
    ]
    const { groups } = groupUndatedItems(items)
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.assignment.id)).toEqual(['a1', 'm1', 'a2'])
  })
})
