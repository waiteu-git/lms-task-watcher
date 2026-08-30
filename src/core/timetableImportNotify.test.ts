import { describe, it, expect } from 'vitest'
import {
  parseTimetableKey,
  pickTimetableImportNotification,
  timetableNotifyKey,
  buildFirstImportNotification,
} from './timetableImportNotify'

describe('parseTimetableKey', () => {
  it('timetable:YYYY:zenki/kouki を解析する', () => {
    expect(parseTimetableKey('timetable:2026:zenki')).toEqual({ year: 2026, semester: 'zenki' })
    expect(parseTimetableKey('timetable:2025:kouki')).toEqual({ year: 2025, semester: 'kouki' })
  })

  it('overrides/view/他キー/不正学期/2桁年は誤検知しない', () => {
    expect(parseTimetableKey('timetableOverrides:2026:zenki:1234567')).toBeNull()
    expect(parseTimetableKey('timetableView')).toBeNull()
    expect(parseTimetableKey('manualAssignments')).toBeNull()
    expect(parseTimetableKey('timetable:2026:haru')).toBeNull()
    expect(parseTimetableKey('timetable:26:zenki')).toBeNull()
  })
})

describe('timetableNotifyKey', () => {
  it('year:semester 形式の複合キーを作る', () => {
    expect(timetableNotifyKey(2026, 'zenki')).toBe('2026:zenki')
    expect(timetableNotifyKey(2026, 'kouki')).toBe('2026:kouki')
  })
})

describe('pickTimetableImportNotification', () => {
  it('その学期を通知済みなら null', () => {
    expect(
      pickTimetableImportNotification(['timetable:2026:zenki'], new Set(['2026:zenki'])),
    ).toBeNull()
  })

  it('該当キーがなければ null', () => {
    expect(
      pickTimetableImportNotification(['timetableView', 'manualAssignments'], new Set()),
    ).toBeNull()
  })

  it('最初に一致した未通知の timetable キーを返す', () => {
    expect(
      pickTimetableImportNotification(['manualAssignments', 'timetable:2026:kouki'], new Set()),
    ).toEqual({ year: 2026, semester: 'kouki' })
  })

  it('前期を通知済みでも後期は通知できる（旧: 一度通知したら永久に止まる問題の修正）', () => {
    expect(
      pickTimetableImportNotification(['timetable:2026:kouki'], new Set(['2026:zenki'])),
    ).toEqual({ year: 2026, semester: 'kouki' })
  })
})

describe('buildFirstImportNotification', () => {
  it('title は固定、message に year と学期ラベルを含む', () => {
    const zenki = buildFirstImportNotification(2026, 'zenki')
    expect(zenki.title).toBe('時間割を取り込みました')
    expect(zenki.message).toContain('2026')
    expect(zenki.message).toContain('前期')
    expect(buildFirstImportNotification(2026, 'kouki').message).toContain('後期')
  })
})
