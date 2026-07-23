import { describe, it, expect } from 'vitest'
import {
  parseTimetableKey,
  pickFirstImportNotification,
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

describe('pickFirstImportNotification', () => {
  it('通知済みなら null', () => {
    expect(pickFirstImportNotification(['timetable:2026:zenki'], true)).toBeNull()
  })

  it('該当キーがなければ null', () => {
    expect(pickFirstImportNotification(['timetableView', 'manualAssignments'], false)).toBeNull()
  })

  it('最初に一致した timetable キーを返す', () => {
    expect(
      pickFirstImportNotification(['manualAssignments', 'timetable:2026:kouki'], false),
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
