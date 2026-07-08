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

const { getCapturedCourseCodes } = await import('./timetableView')

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
