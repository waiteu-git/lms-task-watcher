import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TABLE_MINIMAL } from './timetable.fixtures'

const store: Record<string, unknown> = {}
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const result: Record<string, unknown> = {}
        for (const k of Array.isArray(keys) ? keys : [keys]) result[k] = store[k]
        return result
      }),
      set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj) }),
    },
  },
})

const { getCapturedCourseCodes, resolveDisplayDay, loadCourseOverrides } = await import('./timetableView')

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('getCapturedCourseCodes', () => {
  it('未取得なら空配列', async () => {
    expect(await getCapturedCourseCodes(2026, 'zenki')).toEqual([])
  })
  it('キャプチャHTMLから7桁コードを抽出する', async () => {
    store['timetable:2026:zenki'] = { rawTableHtml: TABLE_MINIMAL, jigenText: '', capturedAt: '2026-07-08T00:00:00.000Z' }
    const codes = await getCapturedCourseCodes(2026, 'zenki')
    expect(codes).toContain('9973337')
  })
})

describe('loadCourseOverrides', () => {
  it('LETUSコースに無くても、時間割にある科目のオーバーライドを読む（未追跡のクォーター科目対策）', async () => {
    store['timetable:2026:zenki'] = { rawTableHtml: TABLE_MINIMAL, jigenText: '', capturedAt: '2026-07-08T00:00:00.000Z' }
    store['timetableOverrides:2026:zenki:9973337'] = { quarter: 'second' }
    // courses は空＝LETUS側に該当コースが無い状況
    const got = await loadCourseOverrides(2026, 'zenki', [])
    expect(got['9973337']).toEqual({ quarter: 'second' })
  })

  it('LETUSコース名由来のコードも従来どおり読む', async () => {
    store['timetableOverrides:2026:zenki:9973337'] = { room: 'X教室' }
    const got = await loadCourseOverrides(2026, 'zenki', [
      { id: '1', name: '9973337 電気数学', url: '' } as never,
    ])
    expect(got['9973337']).toEqual({ room: 'X教室' })
  })
})

describe('resolveDisplayDay', () => {
  it('平日は当日', () => {
    expect(resolveDisplayDay(new Date('2026-07-08T10:00:00+09:00')).day).toBe('wed') // 水曜
    expect(resolveDisplayDay(new Date('2026-07-08T10:00:00+09:00')).label).toBe('今日')
  })
  it('土日は翌月曜', () => {
    expect(resolveDisplayDay(new Date('2026-07-11T10:00:00+09:00')).day).toBe('mon') // 土曜
    expect(resolveDisplayDay(new Date('2026-07-12T10:00:00+09:00')).day).toBe('mon') // 日曜
    expect(resolveDisplayDay(new Date('2026-07-12T10:00:00+09:00')).label).toBe('月曜')
  })
})
