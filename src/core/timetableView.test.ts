import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TABLE_MINIMAL, TABLE_STACKED_QUARTER, TABLE_WITH_SATURDAY } from './timetable.fixtures'
import { parseTimetable } from './timetable'
import type { DayOfWeek, TimetableSlot } from './timetable'

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

const { getCapturedCourseCodes, resolveDisplayDay, loadCourseOverrides, resolveViewSemester, dayOfWeekOf, hasSaturdayClasses, visibleDays } = await import('./timetableView')

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

// 日付はすべてJST（vitest.setup.ts が TZ を固定）。2026-07-06=月曜、07-11=土曜、07-12=日曜。
const at = (iso: string) => new Date(`${iso}T10:00:00+09:00`)
const weekdayClass = { courseCode: '9970001', name: '試験科目', teachers: [], room: '野：101教室', isRemote: false, credits: 2, badges: [] }
const slotOf = (day: DayOfWeek, period: number): TimetableSlot => ({ day, period, classes: [weekdayClass] })

describe('dayOfWeekOf', () => {
  it('月〜土を時間割の曜日へ対応づける', () => {
    expect(dayOfWeekOf(at('2026-07-06'))).toBe('mon')
    expect(dayOfWeekOf(at('2026-07-07'))).toBe('tue')
    expect(dayOfWeekOf(at('2026-07-08'))).toBe('wed')
    expect(dayOfWeekOf(at('2026-07-09'))).toBe('thu')
    expect(dayOfWeekOf(at('2026-07-10'))).toBe('fri')
    expect(dayOfWeekOf(at('2026-07-11'))).toBe('sat')
  })
  it('日曜は授業が無いので undefined', () => {
    expect(dayOfWeekOf(at('2026-07-12'))).toBeUndefined()
  })
})

describe('hasSaturdayClasses / visibleDays（土曜の授業があるときだけ6列目を足す）', () => {
  it('土曜の授業が無ければ平日5列のまま（授業が無い人の見た目は変えない）', () => {
    const slots = [slotOf('mon', 1), slotOf('tue', 4)]
    expect(hasSaturdayClasses(slots)).toBe(false)
    expect(visibleDays(slots)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
  })
  it('時間割が空でも平日5列', () => {
    expect(visibleDays([])).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
  })
  it('土曜に授業が1件でもあれば土曜を6列目に足す', () => {
    const slots = [slotOf('mon', 1), slotOf('sat', 2)]
    expect(hasSaturdayClasses(slots)).toBe(true)
    expect(visibleDays(slots)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
  })
  it('土曜の授業が空配列のコマ（授業なしセル）は数えない', () => {
    const slots: TimetableSlot[] = [{ day: 'sat', period: 3, classes: [] }]
    expect(hasSaturdayClasses(slots)).toBe(false)
  })
  it('実CLASS構造の時間割（土曜に授業あり）を解析した結果から土曜を検出する', () => {
    const slots = parseTimetable(TABLE_WITH_SATURDAY)
    expect(slots.find((s) => s.day === 'sat' && s.period === 2)?.classes[0].name).toBe('土曜の試験科目')
    expect(hasSaturdayClasses(slots)).toBe(true)
  })
  it('負の対照: 平日だけの実CLASS時間割（土曜は全て授業なし）では土曜を足さない', () => {
    const slots = parseTimetable(TABLE_MINIMAL)
    expect(slots.length).toBeGreaterThan(0)
    expect(hasSaturdayClasses(slots)).toBe(false)
    expect(visibleDays(slots)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri'])
  })
})

describe('resolveDisplayDay（土曜に授業がある場合）', () => {
  const withSaturday = [slotOf('mon', 1), slotOf('sat', 2)]
  const weekdaysOnly = [slotOf('mon', 1), slotOf('tue', 4)]

  it('土曜に授業があれば、土曜は当日（今日）を出す', () => {
    expect(resolveDisplayDay(at('2026-07-11'), withSaturday)).toEqual({ day: 'sat', label: '今日' })
  })
  it('土曜でも授業が無い人は、従来どおり翌月曜を出す（変えない）', () => {
    expect(resolveDisplayDay(at('2026-07-11'), weekdaysOnly)).toEqual({ day: 'mon', label: '月曜' })
    expect(resolveDisplayDay(at('2026-07-11'), [])).toEqual({ day: 'mon', label: '月曜' })
  })
  it('日曜は土曜に授業があっても翌月曜（土曜は過ぎている）', () => {
    expect(resolveDisplayDay(at('2026-07-12'), withSaturday)).toEqual({ day: 'mon', label: '月曜' })
  })
  it('平日は時間割に土曜があっても当日', () => {
    expect(resolveDisplayDay(at('2026-07-08'), withSaturday)).toEqual({ day: 'wed', label: '今日' })
    expect(resolveDisplayDay(at('2026-07-10'), withSaturday)).toEqual({ day: 'fri', label: '今日' })
  })
})
