import { describe, it, expect } from 'vitest'
import type { ManualAssignment } from '../core/manualAssignment'
import {
  sortManualByDeadline,
  getManualUrgent,
  getManualTomorrow,
  getManualThisWeek,
  getManualLater,
  getManualSubmitted,
} from './manualAssignment'

function makeAssignment(overrides?: Partial<ManualAssignment>): ManualAssignment {
  return {
    id: 'm-1',
    courseId: 'course-abc',
    courseName: '数理統計学',
    title: '手動課題',
    letusUrl: null,
    deadline: new Date(Date.now() + 60_000).toISOString(),
    memo: '',
    submitted: false,
    createdAt: '2026-06-28T00:00:00.000Z',
    ...overrides,
  }
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

describe('sortManualByDeadline', () => {
  it('締切が早い順に並ぶ', () => {
    const a = makeAssignment({ id: 'a', deadline: hoursFromNow(5) })
    const b = makeAssignment({ id: 'b', deadline: hoursFromNow(1) })
    const sorted = [a, b].sort(sortManualByDeadline)
    expect(sorted.map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('getManualUrgent', () => {
  it('24時間以内かつ未提出のみ含む', () => {
    const within = makeAssignment({ id: 'within', deadline: hoursFromNow(2) })
    const outside = makeAssignment({ id: 'outside', deadline: hoursFromNow(48) })
    const submitted = makeAssignment({ id: 'submitted', deadline: hoursFromNow(2), submitted: true })
    const result = getManualUrgent([within, outside, submitted])
    expect(result.map((x) => x.id)).toEqual(['within'])
  })
})

describe('getManualTomorrow', () => {
  it('24時間より後〜明日いっぱいの未提出課題を含む', () => {
    const item = makeAssignment({ id: 'tomorrow', deadline: hoursFromNow(30) })
    const tooFar = makeAssignment({ id: 'far', deadline: hoursFromNow(24 * 10) })
    const result = getManualTomorrow([item, tooFar])
    expect(result.map((x) => x.id)).toEqual(['tomorrow'])
  })
})

describe('getManualThisWeek', () => {
  it('明日より後〜7日以内の未提出課題を含む', () => {
    const item = makeAssignment({ id: 'thisweek', deadline: hoursFromNow(24 * 5) })
    const result = getManualThisWeek([item])
    expect(result.map((x) => x.id)).toEqual(['thisweek'])
  })
})

describe('getManualLater', () => {
  it('7日より後の未提出課題を含む', () => {
    const item = makeAssignment({ id: 'later', deadline: hoursFromNow(24 * 10) })
    const result = getManualLater([item])
    expect(result.map((x) => x.id)).toEqual(['later'])
  })
})

describe('getManualSubmitted', () => {
  it('submitted が true の課題のみ含む', () => {
    const submitted = makeAssignment({ id: 'done', submitted: true, deadline: hoursFromNow(-5) })
    const notSubmitted = makeAssignment({ id: 'pending', submitted: false })
    const result = getManualSubmitted([submitted, notSubmitted])
    expect(result.map((x) => x.id)).toEqual(['done'])
  })
})
