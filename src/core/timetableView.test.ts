import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TABLE_MINIMAL, TABLE_STACKED_QUARTER } from './timetable.fixtures'

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

const { getCapturedCourseCodes, resolveDisplayDay, loadCourseOverrides, resolveViewSemester } = await import('./timetableView')

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('resolveViewSemester', () => {
  it('別年度のprefは無視し、取得済みが無ければ日付から解決する', async () => {
    store['timetableView'] = { year: 2025, semester: 'kouki' }
    const now = new Date('2026-07-08T10:00:00+09:00') // 日付判定なら zenki の時期
    expect(await resolveViewSemester(2026, now)).toBe('zenki')
  })

  it('別年度のprefは無視し、取得済みがあればそれを使う', async () => {
    store['timetableView'] = { year: 2025, semester: 'zenki' } // pref の値をそのまま採用すると誤って zenki になる
    store['timetable:2026:kouki'] = { rawTableHtml: TABLE_MINIMAL, jigenText: '', capturedAt: '2026-07-01T00:00:00.000Z' }
    const now = new Date('2026-07-08T10:00:00+09:00')
    expect(await resolveViewSemester(2026, now)).toBe('kouki')
  })

  it('同年度のprefはそのまま採用する', async () => {
    store['timetableView'] = { year: 2026, semester: 'kouki' }
    const now = new Date('2026-07-08T10:00:00+09:00') // 日付判定なら zenki の時期でも pref を優先すべき
    expect(await resolveViewSemester(2026, now)).toBe('kouki')
  })

  it('保存済み設定が無ければ、後期開始日(2026-09-11)当日は kouki と判定する', async () => {
    const now = new Date('2026-09-11T09:00:00+09:00')
    expect(await resolveViewSemester(2026, now)).toBe('kouki')
  })

  it('保存済み設定が無ければ、後期開始前日(2026-09-10)は zenki のまま', async () => {
    const now = new Date('2026-09-10T23:59:00+09:00')
    expect(await resolveViewSemester(2026, now)).toBe('zenki')
  })

  it('保存済み設定が無く前期のみ取得済みなら、9/11以降も取得済み最新の zenki を返す', async () => {
    // 「取得済み最新 > 日付判定」は年ガード導入後も不変（後期未取込の案内は
    // findMissingCurrentSemester が別途出す＝表示学期を勝手に動かさない）。
    store['timetable:2026:zenki'] = { rawTableHtml: TABLE_MINIMAL, jigenText: '', capturedAt: '2026-04-10T00:00:00.000Z' }
    const now = new Date('2026-09-11T09:00:00+09:00')
    expect(await resolveViewSemester(2026, now)).toBe('zenki')
  })

  it('同年度の pref=zenki は 9/11 以降も維持する（表示選択が最優先）', async () => {
    // 年ガードは「別年度の pref を捨てる」だけで、同年度の明示選択は後期開始後も尊重する。
    store['timetableView'] = { year: 2026, semester: 'zenki' }
    store['timetable:2026:kouki'] = { rawTableHtml: TABLE_MINIMAL, jigenText: '', capturedAt: '2026-09-11T00:00:00.000Z' }
    const now = new Date('2026-09-20T09:00:00+09:00')
    expect(await resolveViewSemester(2026, now)).toBe('zenki')
  })

  it('年をまたいでも年度が同じなら pref を採用する（2027-01 は2026年度）', async () => {
    // 呼び出し側は全て academicYear(now) を渡す＝1〜3月は前年。西暦で比較していないことを固定する。
    store['timetableView'] = { year: 2026, semester: 'kouki' }
    const now = new Date('2027-01-15T09:00:00+09:00')
    expect(await resolveViewSemester(2026, now)).toBe('kouki')
  })
})

describe('getCapturedCourseCodes', () => {
  it('未取得なら空配列', async () => {
    expect(await getCapturedCourseCodes(2026, 'zenki')).toEqual([])
  })
  it('キャプチャHTMLから7桁コードを抽出する', async () => {
    store['timetable:2026:zenki'] = { rawTableHtml: TABLE_MINIMAL, jigenText: '', capturedAt: '2026-07-08T00:00:00.000Z' }
    const codes = await getCapturedCourseCodes(2026, 'zenki')
    expect(codes).toContain('9973337')
  })

  it('積みコマ(クォーター科目)は両科目のコードを返す（LETUS自動選択がどちらにも効く土台・表示バグの影響外）', async () => {
    store['timetable:2026:zenki'] = { rawTableHtml: TABLE_STACKED_QUARTER, jigenText: '', capturedAt: '2026-07-08T00:00:00.000Z' }
    const codes = await getCapturedCourseCodes(2026, 'zenki')
    expect(codes).toContain('9983343') // 有機化学・基礎(前半/後半のどちらか)
    expect(codes).toContain('9983365') // 微生物学(もう一方)
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
