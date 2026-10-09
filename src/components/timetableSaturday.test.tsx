// @vitest-environment jsdom
// 土曜に授業がある学生の時間割が表示されない不具合（2026-10-08・問い合わせで報告）の回帰テスト。
// 時間割グリッド（TimetableSection）とポップアップの「今日の時間割」（TodayTimetable）を、
// 実際のコンポーネントを描画して確かめる。保存先（chrome.storage）はメモリ上の偽物。
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TABLE_MINIMAL, TABLE_WITH_SATURDAY } from '../core/timetable.fixtures'

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
  tabs: { create: vi.fn() },
})
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { TimetableSection } = await import('./TimetableSection')
const { TodayTimetable } = await import('./TodayTimetable')

// 配列の同一性を保つ（props が毎回新しい配列だと、コンポーネントの読み込み用 effect が再実行され続ける）。
const NO_COURSES: never[] = []
const NO_CODES: string[] = []

const MONDAY = '2026-10-05'
const WEDNESDAY = '2026-10-07'
const SATURDAY = '2026-10-10'
const SUNDAY = '2026-10-11'

let root: Root | null = null
let container: HTMLElement | null = null

function seed(tableHtml: string) {
  // 2026-10-05 以降は後期。取り込み済みが後期だけでも、表示は取り込み済みの学期になる。
  store['timetable:2026:kouki'] = { rawTableHtml: tableHtml, jigenText: '', capturedAt: '2026-10-01T00:00:00.000Z' }
}

function setNow(day: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${day}T10:00:00+09:00`))
}

async function mount(ui: React.ReactElement): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(ui) })
  // 保存済みデータの非同期読み込みが終わるまで、effect とstate更新を流す。
  for (let i = 0; i < 40; i++) await act(async () => { await Promise.resolve() })
  return container
}

const texts = (el: HTMLElement, selector: string) => Array.from(el.querySelectorAll(selector)).map((e) => e.textContent)

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container?.remove()
  root = null
  container = null
  vi.useRealTimers()
})

describe('TimetableSection（ダッシュボードの時間割グリッド）', () => {
  it('土曜に授業があれば、土曜の列を足して授業を表示し、土曜当日は「今日」を強調する', async () => {
    seed(TABLE_WITH_SATURDAY)
    setNow(SATURDAY)
    const el = await mount(<TimetableSection courses={NO_COURSES} assignments={NO_COURSES} manualAssignments={NO_COURSES} newCodes={NO_CODES} />)

    expect(texts(el, '.timetableDayHead')).toEqual(['月', '火', '水', '木', '金', '土'])
    expect(el.querySelector('.timetableDayHead.today')?.textContent).toBe('土')
    // 土曜の授業が実際に描画される（以前はグリッドが月〜金の5列固定で、土曜の授業は描画されなかった）
    expect(texts(el, '.timetableCellName')).toContain('土曜の試験科目')
    expect(texts(el, '.timetableCellName')).toContain('月曜の試験科目')
    // 5行（1〜5限）×6列
    expect(el.querySelectorAll('.timetableCell')).toHaveLength(30)
  })

  it('負の対照: 土曜に授業が無い時間割では、従来どおり平日5列のまま（土曜の列を足さない）', async () => {
    seed(TABLE_MINIMAL)
    setNow(SATURDAY)
    const el = await mount(<TimetableSection courses={NO_COURSES} assignments={NO_COURSES} manualAssignments={NO_COURSES} newCodes={NO_CODES} />)

    expect(texts(el, '.timetableDayHead')).toEqual(['月', '火', '水', '木', '金'])
    expect(el.querySelector('.timetableDayHead.today')).toBeNull() // 土曜の列が無いので強調する列も無い
    expect(el.querySelectorAll('.timetableCell')).toHaveLength(25) // 5行×5列
  })

  it('土曜に授業がある時間割でも、平日の「今日」の強調は変わらない', async () => {
    seed(TABLE_WITH_SATURDAY)
    setNow(WEDNESDAY)
    const el = await mount(<TimetableSection courses={NO_COURSES} assignments={NO_COURSES} manualAssignments={NO_COURSES} newCodes={NO_CODES} />)

    expect(texts(el, '.timetableDayHead')).toEqual(['月', '火', '水', '木', '金', '土'])
    expect(el.querySelector('.timetableDayHead.today')?.textContent).toBe('水')
  })
})

describe('TodayTimetable（ポップアップの今日の時間割）', () => {
  it('土曜に授業があれば、土曜は「今日（土）」として土曜の授業を出す', async () => {
    seed(TABLE_WITH_SATURDAY)
    setNow(SATURDAY)
    const el = await mount(<TodayTimetable courses={NO_COURSES} assignments={NO_COURSES} manualAssignments={NO_COURSES} newCodes={NO_CODES} />)

    expect(el.querySelector('.todayTimetableHead')?.textContent).toBe('今日（土）の時間割')
    expect(texts(el, '.todayName')).toEqual(['土曜の試験科目']) // 月曜の授業は出ない
  })

  it('負の対照: 土曜に授業が無い人は、従来どおり土曜に翌月曜の授業を出す', async () => {
    seed(TABLE_MINIMAL)
    setNow(SATURDAY)
    const el = await mount(<TodayTimetable courses={NO_COURSES} assignments={NO_COURSES} manualAssignments={NO_COURSES} newCodes={NO_CODES} />)

    expect(el.querySelector('.todayTimetableHead')?.textContent).toBe('月曜（月）の時間割')
    expect(texts(el, '.todayName').join('')).toContain('基礎電気数学')
  })

  it('日曜は、土曜に授業があっても翌月曜の授業を出す', async () => {
    seed(TABLE_WITH_SATURDAY)
    setNow(SUNDAY)
    const el = await mount(<TodayTimetable courses={NO_COURSES} assignments={NO_COURSES} manualAssignments={NO_COURSES} newCodes={NO_CODES} />)

    expect(el.querySelector('.todayTimetableHead')?.textContent).toBe('月曜（月）の時間割')
    expect(texts(el, '.todayName')).toEqual(['月曜の試験科目'])
  })

  it('平日は、時間割に土曜があっても当日の授業を出す', async () => {
    seed(TABLE_WITH_SATURDAY)
    setNow(MONDAY)
    const el = await mount(<TodayTimetable courses={NO_COURSES} assignments={NO_COURSES} manualAssignments={NO_COURSES} newCodes={NO_CODES} />)

    expect(el.querySelector('.todayTimetableHead')?.textContent).toBe('今日（月）の時間割')
    expect(texts(el, '.todayName')).toEqual(['月曜の試験科目'])
  })
})
