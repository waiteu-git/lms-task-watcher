import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THRESHOLDS,
  resolveThresholds,
  pickThresholdToNotify,
  type NotificationRules,
} from './notificationRules'

const rules: NotificationRules = {
  version: 1,
  defaultThresholds: [1, 3, 24],
  courseOverrides: {
    'course-early': { muted: false, thresholds: [24, 48, 72] },
    'course-muted': { muted: true, thresholds: [1] },
  },
}

describe('resolveThresholds', () => {
  it('サブスク非activeなら常にデフォルト', () => {
    expect(resolveThresholds(rules, 'course-early', false)).toEqual(DEFAULT_THRESHOLDS)
  })
  it('activeでルール無しならデフォルト', () => {
    expect(resolveThresholds(null, 'course-x', true)).toEqual(DEFAULT_THRESHOLDS)
  })
  it('activeで上書きありならその値', () => {
    expect(resolveThresholds(rules, 'course-early', true)).toEqual([24, 48, 72])
  })
  it('activeでミュートならnull', () => {
    expect(resolveThresholds(rules, 'course-muted', true)).toBeNull()
  })
  it('activeで当該コースに上書き無しならdefaultThresholds', () => {
    expect(resolveThresholds(rules, 'course-none', true)).toEqual([1, 3, 24])
  })
})

describe('pickThresholdToNotify', () => {
  const HOUR = 60 * 60 * 1000
  it('diff内の最小の未通知しきい値を返す', () => {
    const r = pickThresholdToNotify(2 * HOUR, [1, 3, 24], 'a1', new Set())
    expect(r).toEqual({ thresholdHours: 3, notifyKey: 'a1:3h' })
  })
  it('最小しきい値が通知済みなら次を返す', () => {
    const r = pickThresholdToNotify(2 * HOUR, [1, 3, 24], 'a1', new Set(['a1:3h']))
    expect(r).toEqual({ thresholdHours: 24, notifyKey: 'a1:24h' })
  })
  it('全て通知済みならnull', () => {
    const r = pickThresholdToNotify(2 * HOUR, [1, 3, 24], 'a1', new Set(['a1:3h', 'a1:24h']))
    expect(r).toBeNull()
  })
  it('どのしきい値にも入らなければnull', () => {
    const r = pickThresholdToNotify(100 * HOUR, [1, 3, 24], 'a1', new Set())
    expect(r).toBeNull()
  })
  it('空しきい値配列ならnull', () => {
    const r = pickThresholdToNotify(HOUR, [], 'a1', new Set())
    expect(r).toBeNull()
  })
})
