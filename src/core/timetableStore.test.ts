import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveTimetableCapture, getTimetableCapture, listCapturedSemesters, setOverride, getOverride, getOverrides, setPreferredView, getPreferredView } from './timetableStore'

const store: Record<string, unknown> = {}
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys]
        const out: Record<string, unknown> = {}
        for (const k of arr) if (k in store) out[k] = store[k]
        return Promise.resolve(out)
      },
      set: (obj: Record<string, unknown>) => { Object.assign(store, obj); return Promise.resolve() },
    },
  },
})

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('timetableStore', () => {
  it('capture を保存・取得できる', async () => {
    await saveTimetableCapture(2026, 'zenki', { rawTableHtml: '<table></table>', jigenText: '野田', capturedAt: '2026-04-10T00:00:00Z' })
    const got = await getTimetableCapture(2026, 'zenki')
    expect(got?.jigenText).toBe('野田')
    expect(await getTimetableCapture(2026, 'kouki')).toBeNull()
  })
  it('取得済み学期を列挙する', async () => {
    await saveTimetableCapture(2026, 'zenki', { rawTableHtml: '', jigenText: '', capturedAt: '2026-04-10T00:00:00Z' })
    await saveTimetableCapture(2026, 'kouki', { rawTableHtml: '', jigenText: '', capturedAt: '2026-10-01T00:00:00Z' })
    const list = await listCapturedSemesters(2026)
    expect(list.map((c) => c.semester).sort()).toEqual(['kouki', 'zenki'])
  })
  it('オーバーライドを保存・取得できる', async () => {
    await setOverride(2026, 'zenki', '9973337', { room: '別教室' })
    expect((await getOverride(2026, 'zenki', '9973337'))?.room).toBe('別教室')
    expect(await getOverride(2026, 'zenki', '0000000')).toBeNull()
  })
  it('表示選択を保存・取得できる', async () => {
    await setPreferredView(2026, 'kouki')
    expect(await getPreferredView()).toEqual({ year: 2026, semester: 'kouki' })
  })
  it('複数コードのオーバーライドをバッチ取得する（存在分のみ返す）', async () => {
    await setOverride(2026, 'zenki', '9973337', { room: 'X教室' })
    await setOverride(2026, 'zenki', '9973344', { room: 'Y教室' })
    const got = await getOverrides(2026, 'zenki', ['9973337', '9973344', '0000000'])
    expect(got['9973337']?.room).toBe('X教室')
    expect(got['9973344']?.room).toBe('Y教室')
    expect('0000000' in got).toBe(false)
    expect(await getOverrides(2026, 'zenki', [])).toEqual({})
  })
})
