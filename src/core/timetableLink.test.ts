import { describe, it, expect } from 'vitest'
import { extractCourseCode, extractCourseCodes, resolveSemester } from './timetableLink'
import { applyOverrides, linkAssignmentsToSlots } from './timetableLink'
import type { TimetableSlot } from './timetable'
import type { Course, Assignment } from './types'
import type { ManualAssignment } from './manualAssignment'

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
  it('英字を含む科目ID（9975A06 等）も抽出する', () => {
    expect(extractCourseCodes('9975A06 機械航空宇宙力学1')).toEqual(['9975A06'])
    expect(extractCourseCodes('統合 9960E09 / 9960S01')).toEqual(['9960E09', '9960S01'])
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
  it('7桁コードで課題をコマに紐づける', () => {
    const slots = [slot('mon', 1, '9973337', '445教室')]
    const courses = [course('c1', '9973337 基礎電気数学')]
    const assignments = [assignment('a1', 'c1'), assignment('a2', 'c1')]
    const { assignmentInfo } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1']).toEqual({ day: 'mon', period: 1, room: '445教室', isRemote: false, courseCode: '9973337' })
  })
  it('コード抽出できないコースの課題は紐づかない', () => {
    const slots = [slot('mon', 1, '9973337', '445教室')]
    const courses = [course('c1', 'コード無しコース')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1']).toBeUndefined()
  })
  it('統合コース（複数コード）は先頭一致コマにチップが付く', () => {
    const slots = [slot('mon', 1, '9973337', '445教室'), slot('tue', 4, '9973344', '444教室')]
    const courses = [course('c1', '統合 9973337 / 9973344')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1'].courseCode).toBe('9973337')
  })
  it('7桁コードの無いコマ(courseCode="")は突合キーにせず空文字で衝突させない', () => {
    const slots = [slot('mon', 1, '', 'A教室'), slot('tue', 2, '', 'B教室')]
    const courses = [course('c1', 'コード無しコース')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1']).toBeUndefined()
  })
})

function assignmentWith(id: string, courseId: string, deadline: string | null, over: Partial<Assignment> = {}): Assignment {
  return { ...assignment(id, courseId), deadline, ...over }
}
function manual(courseName: string, deadline: string, submitted = false): ManualAssignment {
  return { id: 'm' + courseName, courseId: '', courseName, title: '', letusUrl: null, deadline, memo: '', submitted, createdAt: '' }
}

describe('linkAssignmentsToSlots 緊急度', () => {
  const NOW = new Date('2026-07-08T10:00:00+09:00')
  const slots = [slot('mon', 1, '9973337', '445')]
  const courses = [course('a', '9973337 電気数学')]

  it('当日締切の未提出は today', () => {
    const a = [assignmentWith('1', 'a', '2026-07-08T23:00:00+09:00', { submissionStatus: 'not_submitted' })]
    const { courseCodeUrgency } = linkAssignmentsToSlots(slots, courses, a, [], NOW)
    expect(courseCodeUrgency['9973337']).toBe('today')
  })
  it('提出済み・期限切れは除外', () => {
    const a = [
      assignmentWith('1', 'a', '2026-07-08T23:00:00+09:00', { submissionStatus: 'submitted' }),
      assignmentWith('2', 'a', '2026-07-08T23:00:00+09:00', { lifecycleStatus: 'passed' }),
    ]
    const { courseCodeUrgency } = linkAssignmentsToSlots(slots, courses, a, [], NOW)
    expect(courseCodeUrgency['9973337'] ?? 'none').toBe('none')
  })
  it('手動課題(未提出・締切あり)も対象に含める', () => {
    const m = [manual('9973337 電気数学', '2026-07-10T09:00:00+09:00')]
    const { courseCodeUrgency } = linkAssignmentsToSlots(slots, courses, [], m, NOW)
    expect(courseCodeUrgency['9973337']).toBe('week')
  })
  it('today と week が混在したら today を採る', () => {
    const a = [assignmentWith('1', 'a', '2026-07-12T09:00:00+09:00', { submissionStatus: 'not_submitted' })]
    const m = [manual('9973337 電気数学', '2026-07-08T20:00:00+09:00')]
    const { courseCodeUrgency } = linkAssignmentsToSlots(slots, courses, a, m, NOW)
    expect(courseCodeUrgency['9973337']).toBe('today')
  })
})
