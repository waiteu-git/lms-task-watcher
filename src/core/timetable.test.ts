import { describe, it, expect } from 'vitest'
import { parseClassCell, parsePeriodTimes, parseTimetable } from './timetable'
import {
  CELL_FILLED,
  CELL_REMOTE,
  CELL_ALNUM_CODE,
  CELL_EMPTY,
  JIGEN_AREA_NODA,
  TABLE_MINIMAL,
  TABLE_STACKED_QUARTER,
} from './timetable.fixtures'

describe('parseClassCell', () => {
  it('対面授業セルを構造化する', () => {
    const c = parseClassCell(CELL_FILLED)
    expect(c).not.toBeNull()
    expect(c!.name).toBe('基礎電気数学及び演習 （１組）')
    expect(c!.teachers).toEqual(['王　宇凱'])
    expect(c!.room).toBe('野：445教室')
    expect(c!.isRemote).toBe(false)
    expect(c!.courseCode).toBe('9973337')
    expect(c!.credits).toBe(2.0)
    expect(c!.badges).toEqual(['複数回'])
  })

  it('遠隔授業を isRemote=true にし、バッジなしは空配列', () => {
    const c = parseClassCell(CELL_REMOTE)
    expect(c).not.toBeNull()
    expect(c!.name).toBe('データサイエンス・ＡＩ概論 （前期）')
    expect(c!.courseCode).toBe('9960219')
    expect(c!.room).toBe('遠隔（オンライン）')
    expect(c!.isRemote).toBe(true)
    expect(c!.badges).toEqual([])
  })

  it('英字を含む科目ID（9975A06）を拾い、教員名に混入させない', () => {
    const c = parseClassCell(CELL_ALNUM_CODE)
    expect(c).not.toBeNull()
    expect(c!.courseCode).toBe('9975A06')
    expect(c!.name).toBe('機械航空宇宙力学1')
    expect(c!.teachers).toEqual(['山本　誠'])
  })

  it('ui-button ノイズを混入させない', () => {
    const c = parseClassCell(CELL_FILLED)
    expect(JSON.stringify(c)).not.toContain('ui-button')
  })

  it('空きコマ（noClass）は null', () => {
    expect(parseClassCell(CELL_EMPTY)).toBeNull()
  })
})

describe('parsePeriodTimes', () => {
  it('野田キャンパスの時限時刻を全7限パースする', () => {
    const r = parsePeriodTimes(JIGEN_AREA_NODA)
    expect(r).not.toBeNull()
    expect(r!.campus).toBe('野田')
    expect(r!.periods).toHaveLength(7)
    expect(r!.periods[0]).toEqual({ period: 1, start: '08:50', end: '10:20' })
    expect(r!.periods[6]).toEqual({ period: 7, start: '19:50', end: '21:20' })
  })

  it('全角チルダ ～ と半角 ~ の両方を許容する', () => {
    const r = parsePeriodTimes('神楽坂（1限 09:00~10:30）')
    expect(r).not.toBeNull()
    expect(r!.campus).toBe('神楽坂')
    expect(r!.periods[0]).toEqual({ period: 1, start: '09:00', end: '10:30' })
  })

  it('パースできない入力は null', () => {
    expect(parsePeriodTimes('')).toBeNull()
    expect(parsePeriodTimes('時間割情報なし')).toBeNull()
  })
})

describe('parseTimetable', () => {
  it('授業のあるスロットだけを返す（昼休み・空きコマは除外）', () => {
    expect(parseTimetable(TABLE_MINIMAL)).toHaveLength(2)
  })

  it('月1に基礎電気数学を配置する', () => {
    const slots = parseTimetable(TABLE_MINIMAL)
    const mon1 = slots.find((s) => s.day === 'mon' && s.period === 1)
    expect(mon1).toBeDefined()
    expect(mon1!.classes[0].name).toBe('基礎電気数学及び演習 （１組）')
    expect(mon1!.classes[0].courseCode).toBe('9973337')
  })

  it('火4に物理学実験を配置する（昼休み行を挟んでも時限を取り違えない）', () => {
    const slots = parseTimetable(TABLE_MINIMAL)
    const tue4 = slots.find((s) => s.day === 'tue' && s.period === 4)
    expect(tue4).toBeDefined()
    expect(tue4!.classes[0].name).toBe('物理学実験Ａ')
    expect(tue4!.classes[0].courseCode).toBe('9973344')
  })

  it('クォーター科目: 同一コマの2科目を両方返す（実データ構造・以前UIが片方を捨てていた）', () => {
    const slots = parseTimetable(TABLE_STACKED_QUARTER)
    const tue1 = slots.find((s) => s.day === 'tue' && s.period === 1)
    expect(tue1).toBeDefined()
    expect(tue1!.classes).toHaveLength(2)
    expect(tue1!.classes.map((c) => c.courseCode)).toEqual(['9983343', '9983365'])
    expect(tue1!.classes.map((c) => c.name)).toEqual(['有機化学・基礎 （旧：有機化学２）', '微生物学 （旧：微生物学）'])
    // パース時点では 1Q/2Q の区別情報はどこにも無い＝両方 undefined
    expect(tue1!.classes.every((c) => c.quarter === undefined)).toBe(true)
  })
})
