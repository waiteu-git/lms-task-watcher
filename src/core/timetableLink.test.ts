import { describe, it, expect } from 'vitest'
import { extractCourseCode, extractCourseCodes, resolveSemester } from './timetableLink'
import { applyOverrides, linkAssignmentsToSlots } from './timetableLink'
import type { TimetableSlot } from './timetable'
import type { Course, Assignment } from './types'

function slot(day: TimetableSlot['day'], period: number, courseCode: string, room: string): TimetableSlot {
  return {
    day,
    period,
    classes: [{ courseCode, name: 'X', teachers: [], room, isRemote: room.includes('遠隔'), credits: null, badges: [] }],
  }
}

function course(id: string, name: string): Course {
  return { id, name, url: '', enabled: true, lmsType: 'letus', createdAt: '', updatedAt: '' }
}

function assignment(id: string, courseId: string): Assignment {
  return {
    id, courseId, courseName: '', title: '', url: '', deadline: null, deadlineText: '',
    deadlineSource: null, sourceText: '', submissionStatus: 'unknown', lifecycleStatus: 'active',
    detectedAt: '', firstSeenAt: '', lastSeenAt: '', lastCheckedAt: '',
  }
}

describe('extractCourseCodes', () => {
  it('コース名に埋め込まれた7桁コードを全て抽出する', () => {
    expect(extractCourseCodes('9973337 基礎電気数学及び演習')).toEqual(['9973337'])
    expect(extractCourseCodes('統合 9973337 / 9973344')).toEqual(['9973337', '9973344'])
  })
  it('7桁が無ければ空配列', () => {
    expect(extractCourseCodes('基礎電気数学及び演習')).toEqual([])
    expect(extractCourseCodes('99733370 号')).toEqual([]) // 8桁は取らない
  })
})

describe('extractCourseCode', () => {
  it('先頭の7桁コードを返す', () => {
    expect(extractCourseCode('9973337 基礎電気数学及び演習')).toBe('9973337')
    expect(extractCourseCode('基礎電気数学及び演習 [9973337]')).toBe('9973337')
  })
  it('7桁が無ければ null', () => {
    expect(extractCourseCode('基礎電気数学及び演習')).toBeNull()
    expect(extractCourseCode('99733370 号')).toBeNull()
  })
})

describe('resolveSemester', () => {
  it('取得済みがあれば capturedAt が最新の学期', () => {
    const captured = [
      { semester: 'zenki' as const, capturedAt: '2026-04-10T00:00:00Z' },
      { semester: 'kouki' as const, capturedAt: '2026-10-01T00:00:00Z' },
    ]
    expect(resolveSemester(new Date(2026, 6, 5), captured)).toBe('kouki')
  })
  it('取得済みが空なら日付で判定（4–9月=前期）', () => {
    expect(resolveSemester(new Date(2026, 3, 1), [])).toBe('zenki') // 4月
    expect(resolveSemester(new Date(2026, 8, 30), [])).toBe('zenki') // 9月
  })
  it('取得済みが空なら日付で判定（10–3月=後期）', () => {
    expect(resolveSemester(new Date(2026, 9, 1), [])).toBe('kouki') // 10月
    expect(resolveSemester(new Date(2026, 1, 15), [])).toBe('kouki') // 2月
  })
})

describe('applyOverrides', () => {
  it('courseCode 一致のコマの room を上書きし isRemote を再判定する', () => {
    const slots = [slot('mon', 1, '9973337', '445教室')]
    const result = applyOverrides(slots, { '9973337': { room: '遠隔（オンライン）' } })
    expect(result[0].classes[0].room).toBe('遠隔（オンライン）')
    expect(result[0].classes[0].isRemote).toBe(true)
  })
  it('オーバーライドが無いコマは変えない', () => {
    const slots = [slot('mon', 1, '9973337', '445教室')]
    const result = applyOverrides(slots, {})
    expect(result[0].classes[0].room).toBe('445教室')
  })
})

describe('linkAssignmentsToSlots', () => {
  it('7桁コードで課題をコマに紐づけ、件数を数える', () => {
    const slots = [slot('mon', 1, '9973337', '445教室')]
    const courses = [course('c1', '9973337 基礎電気数学')]
    const assignments = [assignment('a1', 'c1'), assignment('a2', 'c1')]
    const { assignmentInfo, courseCodeCounts } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1']).toEqual({ day: 'mon', period: 1, room: '445教室', isRemote: false, courseCode: '9973337' })
    expect(courseCodeCounts['9973337']).toBe(2)
  })
  it('コード抽出できないコースの課題は紐づかない', () => {
    const slots = [slot('mon', 1, '9973337', '445教室')]
    const courses = [course('c1', 'コード無しコース')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo, courseCodeCounts } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1']).toBeUndefined()
    expect(courseCodeCounts['9973337']).toBe(0)
  })
  it('統合コース（複数コード）は各コードのコマに件数が乗り、先頭一致コマにチップが付く', () => {
    const slots = [slot('mon', 1, '9973337', '445教室'), slot('tue', 4, '9973344', '444教室')]
    const courses = [course('c1', '統合 9973337 / 9973344')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo, courseCodeCounts } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(courseCodeCounts['9973337']).toBe(1)
    expect(courseCodeCounts['9973344']).toBe(1)
    expect(assignmentInfo['a1'].courseCode).toBe('9973337')
  })
  it('7桁コードの無いコマ(courseCode="")は突合キーにせず空文字で衝突させない', () => {
    const slots = [slot('mon', 1, '', 'A教室'), slot('tue', 2, '', 'B教室')]
    const courses = [course('c1', 'コード無しコース')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo, courseCodeCounts } = linkAssignmentsToSlots(slots, courses, assignments)
    expect('' in courseCodeCounts).toBe(false)
    expect(assignmentInfo['a1']).toBeUndefined()
  })
})
