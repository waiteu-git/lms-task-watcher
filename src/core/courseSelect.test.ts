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
