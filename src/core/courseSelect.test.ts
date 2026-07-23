import { describe, it, expect } from 'vitest'
import { selectCoursesByTimetable } from './courseSelect'
import type { Course } from './types'

function course(over: Partial<Course>): Course {
  return { id: 'c', name: '', url: '', enabled: false, lmsType: 'letus', createdAt: '', updatedAt: '', ...over }
}
const NOW = '2026-07-08T00:00:00.000Z'

describe('selectCoursesByTimetable', () => {
  it('時間割にコードが一致する未操作コースを自動ONする', () => {
    const courses = [course({ id: 'a', name: '9973337 電気数学', enabled: false })]
    const out = selectCoursesByTimetable(courses, new Set(['9973337']), NOW)
    expect(out[0].enabled).toBe(true)
    expect(out[0].updatedAt).toBe(NOW)
  })
  it('科目IDに英字を含むコースも自動ONする', () => {
    const courses = [course({ id: 'a', name: '9975A06 機械航空宇宙力学1', enabled: false })]
    const out = selectCoursesByTimetable(courses, new Set(['9975A06']), NOW)
    expect(out[0].enabled).toBe(true)
  })
  it('クォーター積みペアは両方の科目コードで各LETUSコースを独立に自動ONする', () => {
    // 同一コマの2科目(有機化学・基礎/微生物学)は別々の7桁コードを持つ。時間割コード集合には
    // 両方が入る(getCapturedCourseCodesが全科目を拾う)ので、対応するLETUSコースは両方ONになる。
    const courses = [
      course({ id: 'a', name: '9983343 有機化学・基礎', enabled: false }),
      course({ id: 'b', name: '9983365 微生物学', enabled: false }),
    ]
    const out = selectCoursesByTimetable(courses, new Set(['9983343', '9983365']), NOW)
    expect(out.find((c) => c.id === 'a')!.enabled).toBe(true)
    expect(out.find((c) => c.id === 'b')!.enabled).toBe(true)
  })

  it('統合コースは片方一致でON', () => {
    const courses = [course({ id: 'a', name: '統合 1111111 / 9973337', enabled: false })]
    const out = selectCoursesByTimetable(courses, new Set(['9973337']), NOW)
    expect(out[0].enabled).toBe(true)
  })
  it('userToggled が立ったコースは触らない', () => {
    const courses = [course({ id: 'a', name: '9973337 電気数学', enabled: false, userToggled: true })]
    const out = selectCoursesByTimetable(courses, new Set(['9973337']), NOW)
    expect(out).toBe(courses)
  })
  it('時間割に無いコードは変更しない', () => {
    const courses = [course({ id: 'a', name: '0000000 他学期', enabled: false })]
    const out = selectCoursesByTimetable(courses, new Set(['9973337']), NOW)
    expect(out).toBe(courses)
  })
  it('既にON・空集合は変更しない（同一参照）', () => {
    const on = [course({ id: 'a', name: '9973337 電気数学', enabled: true })]
    expect(selectCoursesByTimetable(on, new Set(['9973337']), NOW)).toBe(on)
    const c = [course({ id: 'a', name: '9973337 電気数学', enabled: false })]
    expect(selectCoursesByTimetable(c, new Set(), NOW)).toBe(c)
  })
})
