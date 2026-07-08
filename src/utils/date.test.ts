import { describe, it, expect } from 'vitest'
import { deadlineTier } from './date'

const now = new Date('2026-07-08T10:00:00+09:00')

describe('deadlineTier', () => {
  it('当日中の締切は today', () => {
    expect(deadlineTier('2026-07-08T23:59:00+09:00', now)).toBe('today')
    expect(deadlineTier('2026-07-08T10:30:00+09:00', now)).toBe('today')
  })
  it('翌日〜7日以内は week', () => {
    expect(deadlineTier('2026-07-09T09:00:00+09:00', now)).toBe('week')
    expect(deadlineTier('2026-07-15T09:00:00+09:00', now)).toBe('week')
  })
  it('7日より先は none', () => {
    expect(deadlineTier('2026-07-16T09:00:00+09:00', now)).toBe('none')
  })
  it('過去・null・不正は none', () => {
    expect(deadlineTier('2026-07-07T09:00:00+09:00', now)).toBe('none')
    expect(deadlineTier(null, now)).toBe('none')
    expect(deadlineTier('not-a-date', now)).toBe('none')
  })
  it('7日境界は開いた時刻でぶれない（カレンダー基準）', () => {
    // ローカル日付コンストラクタで組み、テストランナーのTZに依存させない
    const earlyMorning = new Date(2026, 6, 8, 0, 5) // 7/8 00:05
    const day7Night = new Date(2026, 6, 15, 23, 59).toISOString() // 7日後
    const day8 = new Date(2026, 6, 16, 0, 5).toISOString() // 8日後
    expect(deadlineTier(day7Night, earlyMorning)).toBe('week')
    expect(deadlineTier(day8, earlyMorning)).toBe('none')
  })
})
