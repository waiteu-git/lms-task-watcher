import { describe, it, expect } from 'vitest'
import { computeDeadlineNotifications, type DeadlineTarget } from './deadlineNotify'
import type { NotificationRules } from '../background/notificationRules'

const HOUR = 60 * 60 * 1000
const NOW = 1_000_000_000_000

function at(hoursFromNow: number): string {
  return new Date(NOW + hoursFromNow * HOUR).toISOString()
}

const rules: NotificationRules = {
  version: 1,
  defaultThresholds: [1, 3, 24],
  courseOverrides: {
    'c-muted': { muted: true, thresholds: [1] },
    'c-custom': { muted: false, thresholds: [48, 72] },
  },
}

function target(over: Partial<DeadlineTarget> = {}): DeadlineTarget {
  return { id: 'a1', courseId: 'c-none', title: '課題', courseName: '講義', deadline: at(2), ...over }
}

describe('computeDeadlineNotifications', () => {
  it('しきい値内で最小の未通知しきい値を発火（既定1/3/24h）', () => {
    const out = computeDeadlineNotifications([target({ deadline: at(2) })], rules, new Set(), NOW)
    expect(out).toHaveLength(1)
    expect(out[0].notifyKey).toBe('a1:3h')
    expect(out[0].title).toBe('締切まで3時間以内')
    expect(out[0].message).toBe('課題\n講義')
    expect(out[0].notificationId).toBe('task-watcher-deadline-3h-a1')
  })

  it('ミュート済みコースは発火しない', () => {
    const out = computeDeadlineNotifications(
      [target({ id: 'm1', courseId: 'c-muted', deadline: at(0.5) })],
      rules,
      new Set(),
      NOW,
    )
    expect(out).toEqual([])
  })

  it('カスタムしきい値のコースはその値で発火（既定では鳴らない48h帯）', () => {
    const out = computeDeadlineNotifications(
      [target({ id: 'x1', courseId: 'c-custom', deadline: at(40) })],
      rules,
      new Set(),
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0].notifyKey).toBe('x1:48h')
    expect(out[0].title).toBe('締切まで48時間以内')
  })

  it('通知済みキーは抑制し、次のしきい値へ', () => {
    const out = computeDeadlineNotifications(
      [target({ deadline: at(2) })],
      rules,
      new Set(['a1:3h']),
      NOW,
    )
    expect(out[0].notifyKey).toBe('a1:24h')
  })

  it('締切超過（diff<=0）は無視', () => {
    const out = computeDeadlineNotifications([target({ deadline: at(-1) })], rules, new Set(), NOW)
    expect(out).toEqual([])
  })

  it('courseId 無し（手動課題）は default しきい値で発火・ミュート非適用', () => {
    const out = computeDeadlineNotifications(
      [{ id: 'man1', title: '手動', courseName: '手動講義', deadline: at(2) }],
      rules,
      new Set(),
      NOW,
    )
    expect(out).toHaveLength(1)
    expect(out[0].notifyKey).toBe('man1:3h')
  })

  it('rules=null でも default で発火', () => {
    const out = computeDeadlineNotifications([target({ deadline: at(0.5) })], null, new Set(), NOW)
    expect(out[0].notifyKey).toBe('a1:1h')
  })
})
