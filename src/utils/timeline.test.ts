import { describe, it, expect } from 'vitest'
import type { Assignment } from '../core/types'
import type { ManualAssignment } from '../core/manualAssignment'
import { mergeTimeline } from './timeline'

function makeAssignment(overrides?: Partial<Assignment>): Assignment {
  return {
    id: 'scan-1',
    courseId: 'course-abc',
    courseName: '数理統計学',
    title: 'スキャン課題',
    url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1',
    deadline: '2026-07-05T12:00:00.000Z',
    deadlineText: '',
    sourceText: '',
    submissionStatus: 'not_submitted',
    lifecycleStatus: 'active',
    detectedAt: '2026-06-01T00:00:00.000Z',
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-01T00:00:00.000Z',
    lastCheckedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeManual(overrides?: Partial<ManualAssignment>): ManualAssignment {
  return {
    id: 'manual-1',
    courseId: 'course-abc',
    courseName: '数理統計学',
    title: '手動課題',
    letusUrl: null,
    deadline: '2026-07-05T06:00:00.000Z',
    memo: '',
    submitted: false,
    createdAt: '2026-06-28T00:00:00.000Z',
    ...overrides,
  }
}

describe('mergeTimeline', () => {
  it('締切が早い順に scan/manual を混在させる', () => {
    const scan = makeAssignment({ id: 'scan-1', deadline: '2026-07-05T12:00:00.000Z' })
    const manual = makeManual({ id: 'manual-1', deadline: '2026-07-05T06:00:00.000Z' })
    const result = mergeTimeline([scan], [manual])
    expect(result.map((item) => item.assignment.id)).toEqual(['manual-1', 'scan-1'])
    expect(result.map((item) => item.kind)).toEqual(['manual', 'scan'])
  })

  it('空配列同士でも壊れない', () => {
    expect(mergeTimeline([], [])).toEqual([])
  })

  it('scan のみでも manual のみでも動く', () => {
    const scan = makeAssignment()
    expect(mergeTimeline([scan], [])).toHaveLength(1)
    const manual = makeManual()
    expect(mergeTimeline([], [manual])).toHaveLength(1)
  })

  it('締切がnullのscan課題は末尾にソートされる', () => {
    const withDeadline = makeAssignment({ id: 'with-deadline', deadline: '2026-07-05T12:00:00.000Z' })
    const noDeadline = makeAssignment({ id: 'no-deadline', deadline: null })
    const manual = makeManual({ id: 'manual-1', deadline: '2026-07-06T00:00:00.000Z' })
    const result = mergeTimeline([withDeadline, noDeadline], [manual])
    expect(result.map((item) => item.assignment.id)).toEqual(['with-deadline', 'manual-1', 'no-deadline'])
  })
})
