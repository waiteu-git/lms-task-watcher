import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveTimetableCapture, getTimetableCapture, listCapturedSemesters, setOverride, getOverride, getOverrides, setPreferredView, getPreferredView, getCurrentQuarter, setCurrentQuarter } from './timetableStore'

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
      remove: (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys]
        for (const k of arr) delete store[k]
        return Promise.resolve()
      },
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
  it('表示選択に null を渡すと指定を解除する（自動に戻す）', async () => {
    await setPreferredView(2026, 'kouki')
    await setPreferredView(2026, null)
    expect(await getPreferredView()).toBeNull()
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

  it('setOverride は既存フィールドを消さずにマージする（教室編集で quarter が飛ばない）', async () => {
    await setOverride(2026, 'zenki', '9983343', { quarter: 'second' })
    await setOverride(2026, 'zenki', '9983343', { room: '別教室' })
    const got = await getOverride(2026, 'zenki', '9983343')
    expect(got).toEqual({ quarter: 'second', room: '別教室' })
  })

  it('setOverride は quarter 指定で既存 room を消さない（逆方向）', async () => {
    await setOverride(2026, 'zenki', '9983365', { room: 'E101教室' })
    await setOverride(2026, 'zenki', '9983365', { quarter: 'first' })
    expect(await getOverride(2026, 'zenki', '9983365')).toEqual({ room: 'E101教室', quarter: 'first' })
  })

  it('undefined を明示するとそのフィールドだけ消える', async () => {
    await setOverride(2026, 'zenki', '9983343', { room: 'X', quarter: 'first' })
    await setOverride(2026, 'zenki', '9983343', { quarter: undefined })
    expect(await getOverride(2026, 'zenki', '9983343')).toEqual({ room: 'X' })
  })

  it('全フィールドが消えたらキーごと削除する（ゴミを残さない）', async () => {
    await setOverride(2026, 'zenki', '9983343', { quarter: 'first' })
    await setOverride(2026, 'zenki', '9983343', { quarter: undefined })
    expect(await getOverride(2026, 'zenki', '9983343')).toBeNull()
    expect('timetableOverrides:2026:zenki:9983343' in store).toBe(false)
  })

  it('現在の半期トグルを保存・取得でき、null で未指定に戻せる', async () => {
    expect(await getCurrentQuarter(2026, 'zenki')).toBeNull()
    await setCurrentQuarter(2026, 'zenki', 'second')
    expect(await getCurrentQuarter(2026, 'zenki')).toBe('second')
    // 学期ごとに独立
    expect(await getCurrentQuarter(2026, 'kouki')).toBeNull()
    await setCurrentQuarter(2026, 'zenki', null)
    expect(await getCurrentQuarter(2026, 'zenki')).toBeNull()
  })
})
