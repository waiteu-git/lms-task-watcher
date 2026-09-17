import { describe, it, expect } from 'vitest'
import { extractCourseCode, extractCourseCodes, resolveSemester, findMissingCurrentSemester, findStaleDisplayedSemester } from './timetableLink'
import { applyOverrides, linkAssignmentsToSlots, isQuarterSlot, defaultCurrentQuarter, resolveCurrentQuarter, isDimmedForCurrentQuarter } from './timetableLink'
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
  it('取得済みが空なら日付で判定（確定年度は後期開始日の実日付・2026年度は9/11）', () => {
    expect(resolveSemester(new Date(2026, 3, 1), [])).toBe('zenki') // 4月
    expect(resolveSemester(new Date(2026, 8, 10), [])).toBe('zenki') // 9/10＝前期最終日
    expect(resolveSemester(new Date(2026, 8, 11), [])).toBe('kouki') // 9/11＝後期開始日
    expect(resolveSemester(new Date(2026, 8, 30), [])).toBe('kouki') // 9月末
  })
  it('取得済みが空なら日付で判定（10–3月=後期）', () => {
    expect(resolveSemester(new Date(2026, 9, 1), [])).toBe('kouki') // 10月
    expect(resolveSemester(new Date(2026, 1, 15), [])).toBe('kouki') // 2月
  })
  it('後期開始日が未確定の年度は旧来の月境界（4-9月=前期）にフォールバックする', () => {
    expect(resolveSemester(new Date(2027, 8, 15), [])).toBe('zenki') // 2027年度9月＝未登録
    expect(resolveSemester(new Date(2027, 9, 1), [])).toBe('kouki') // 2027年度10月
  })
})

describe('findMissingCurrentSemester', () => {
  it('取得済みが空なら判定しない（別の空状態UIの対象）', () => {
    expect(findMissingCurrentSemester(new Date(2026, 8, 20), [])).toBeNull()
  })
  it('あるべき学期(後期)が未取得なら後期を返す', () => {
    const captured = [{ semester: 'zenki' as const, capturedAt: '2026-04-10T00:00:00Z' }]
    expect(findMissingCurrentSemester(new Date(2026, 8, 20), captured)).toBe('kouki') // 9/20=後期
  })
  it('あるべき学期が取得済みなら null', () => {
    const captured = [
      { semester: 'zenki' as const, capturedAt: '2026-04-10T00:00:00Z' },
      { semester: 'kouki' as const, capturedAt: '2026-09-15T00:00:00Z' },
    ]
    expect(findMissingCurrentSemester(new Date(2026, 8, 20), captured)).toBeNull()
  })
  it('逆方向（前期が未取得）でも検出する', () => {
    const captured = [{ semester: 'kouki' as const, capturedAt: '2026-01-10T00:00:00Z' }]
    expect(findMissingCurrentSemester(new Date(2026, 4, 1), captured)).toBe('zenki') // 5月=前期
  })
})

describe('findStaleDisplayedSemester', () => {
  it('表示学期が未確定(null)なら判定しない', () => {
    const captured = [{ semester: 'kouki' as const, capturedAt: '2026-09-15T00:00:00Z' }]
    expect(findStaleDisplayedSemester(new Date(2026, 8, 20), captured, null)).toBeNull()
  })
  it('表示が既にあるべき学期と一致していれば null', () => {
    const captured = [{ semester: 'kouki' as const, capturedAt: '2026-09-15T00:00:00Z' }]
    expect(findStaleDisplayedSemester(new Date(2026, 8, 20), captured, 'kouki')).toBeNull()
  })
  it('あるべき学期(後期)が未取得なら null（findMissingCurrentSemester の対象であってこちらではない）', () => {
    const captured = [{ semester: 'zenki' as const, capturedAt: '2026-04-10T00:00:00Z' }]
    expect(findStaleDisplayedSemester(new Date(2026, 8, 20), captured, 'zenki')).toBeNull()
  })
  it('後期は取得済みなのに表示が前期のまま（pref残留）なら後期を返す', () => {
    const captured = [
      { semester: 'zenki' as const, capturedAt: '2026-04-10T00:00:00Z' },
      { semester: 'kouki' as const, capturedAt: '2026-09-15T00:00:00Z' },
    ]
    expect(findStaleDisplayedSemester(new Date(2026, 8, 20), captured, 'zenki')).toBe('kouki')
  })
  it('逆方向（前期は取得済みなのに表示が後期のまま）でも検出する', () => {
    const captured = [
      { semester: 'kouki' as const, capturedAt: '2026-01-10T00:00:00Z' },
      { semester: 'zenki' as const, capturedAt: '2026-04-10T00:00:00Z' },
    ]
    expect(findStaleDisplayedSemester(new Date(2026, 4, 1), captured, 'kouki')).toBe('zenki') // 5月=前期
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
    expect(assignmentInfo['a1']).toEqual({
      day: 'mon', period: 1, room: '445教室', isRemote: false, courseCode: '9973337',
      occurrences: [{ day: 'mon', period: 1 }],
    })
  })
  it('同一コースが週複数コマなら occurrences に全コマを入れる', () => {
    const slots = [slot('mon', 1, '9973337', '445教室'), slot('thu', 3, '9973337', '445教室')]
    const courses = [course('c1', '9973337 基礎電気数学')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1'].occurrences).toEqual([
      { day: 'mon', period: 1 }, { day: 'thu', period: 3 },
    ])
  })
  it('連続コマ(同日同コード複数)も occurrences に全て入れ、代表は先頭コマ', () => {
    const slots = [slot('tue', 3, '9973344', '444教室'), slot('tue', 4, '9973344', '444教室')]
    const courses = [course('c1', '9973344 物理学実験')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1'].period).toBe(3)
    expect(assignmentInfo['a1'].occurrences).toEqual([
      { day: 'tue', period: 3 }, { day: 'tue', period: 4 },
    ])
  })
  it('統合コースは全コードのコマを occurrences に集約する', () => {
    const slots = [slot('mon', 1, '9973337', '445教室'), slot('tue', 4, '9973344', '444教室')]
    const courses = [course('c1', '統合 9973337 / 9973344')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1'].occurrences).toEqual([
      { day: 'mon', period: 1 }, { day: 'tue', period: 4 },
    ])
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

describe('クォーター（半期）科目', () => {
  /** 実データ: 火1限に 有機化学・基礎(9983343) と 微生物学(9983365) が各1.0単位で積まれている */
  function stacked(): TimetableSlot {
    return {
      day: 'tue',
      period: 1,
      classes: [
        { courseCode: '9983343', name: '有機化学・基礎', teachers: [], room: 'E304教室', isRemote: false, credits: 1, badges: [] },
        { courseCode: '9983365', name: '微生物学', teachers: [], room: 'E101教室', isRemote: false, credits: 1, badges: [] },
      ],
    }
  }

  it('isQuarterSlot: 同一コマ2科目以上を半期科目のコマとみなす', () => {
    expect(isQuarterSlot(stacked())).toBe(true)
    expect(isQuarterSlot(slot('mon', 1, '9973337', '445教室'))).toBe(false)
  })

  it('applyOverrides: room 指定が無くても quarter だけを適用できる', () => {
    const result = applyOverrides([stacked()], { '9983343': { quarter: 'second' } })
    expect(result[0].classes[0].quarter).toBe('second')
    expect(result[0].classes[0].room).toBe('E304教室')
    expect(result[0].classes[1].quarter).toBeUndefined()
  })

  it('applyOverrides: room と quarter を同時に適用できる', () => {
    const result = applyOverrides([stacked()], { '9983365': { room: '遠隔（オンライン）', quarter: 'first' } })
    expect(result[0].classes[1].quarter).toBe('first')
    expect(result[0].classes[1].room).toBe('遠隔（オンライン）')
    expect(result[0].classes[1].isRemote).toBe(true)
  })

  it('applyOverrides: 指定が無ければ quarter は undefined のまま（CLASSは1Q/2Qを公開しない）', () => {
    const result = applyOverrides([stacked()], {})
    expect(result[0].classes[0].quarter).toBeUndefined()
    expect(result[0].classes[1].quarter).toBeUndefined()
  })

  it('defaultCurrentQuarter: 前期は4-5月が前半、6-9月が後半', () => {
    expect(defaultCurrentQuarter(new Date(2026, 3, 15), 'zenki')).toBe('first')
    expect(defaultCurrentQuarter(new Date(2026, 4, 31), 'zenki')).toBe('first')
    expect(defaultCurrentQuarter(new Date(2026, 5, 1), 'zenki')).toBe('second')
    expect(defaultCurrentQuarter(new Date(2026, 7, 1), 'zenki')).toBe('second')
  })

  it('defaultCurrentQuarter: 後期は10-11月が前半、12-3月が後半', () => {
    expect(defaultCurrentQuarter(new Date(2026, 9, 1), 'kouki')).toBe('first')
    expect(defaultCurrentQuarter(new Date(2026, 10, 30), 'kouki')).toBe('first')
    expect(defaultCurrentQuarter(new Date(2026, 11, 1), 'kouki')).toBe('second')
    expect(defaultCurrentQuarter(new Date(2027, 1, 1), 'kouki')).toBe('second')
  })

  it('resolveCurrentQuarter: 手動指定を最優先、無ければ日付既定、学期未確定は first', () => {
    const now = new Date(2026, 4, 1) // 5月＝前期前半
    expect(resolveCurrentQuarter('second', now, 'zenki')).toBe('second') // pref優先
    expect(resolveCurrentQuarter(null, now, 'zenki')).toBe('first') // 日付既定
    expect(resolveCurrentQuarter(null, now, null)).toBe('first') // 学期未確定
  })

  it('isDimmedForCurrentQuarter: 指定済みで現在と異なる積み科目だけ薄くする', () => {
    expect(isDimmedForCurrentQuarter('first', 'second', true)).toBe(true) // 前半科目・今後半
    expect(isDimmedForCurrentQuarter('second', 'second', true)).toBe(false) // 一致
    expect(isDimmedForCurrentQuarter(undefined, 'first', true)).toBe(false) // 未指定は薄くしない
    expect(isDimmedForCurrentQuarter('first', 'second', false)).toBe(false) // 非積みは薄くしない
  })
})
