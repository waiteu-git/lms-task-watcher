import { describe, it, expect } from 'vitest'
import { academicYear, buildSyllabusUrl, buildSyllabusUrlByYear } from './syllabus'

describe('academicYear', () => {
  it('4月以降は当年', () => {
    expect(academicYear(new Date(2026, 3, 1))).toBe(2026) // 4月
    expect(academicYear(new Date(2026, 6, 5))).toBe(2026) // 7月
    expect(academicYear(new Date(2026, 11, 31))).toBe(2026)
  })
  it('1〜3月は前年', () => {
    expect(academicYear(new Date(2026, 0, 15))).toBe(2025) // 1月
    expect(academicYear(new Date(2026, 2, 31))).toBe(2025) // 3月
  })
})

describe('buildSyllabusUrl', () => {
  it('科目コードと年度でURLを組む', () => {
    expect(buildSyllabusUrl('9973365', new Date(2026, 6, 5))).toBe(
      'https://class.admin.tus.ac.jp/slResult/2026/japanese/syllabusHtml/SyllabusHtml.2026.9973365.html',
    )
  })
})

describe('buildSyllabusUrlByYear', () => {
  it('年度を直接指定してURLを生成する', () => {
    expect(buildSyllabusUrlByYear('9973344', 2026)).toBe(
      'https://class.admin.tus.ac.jp/slResult/2026/japanese/syllabusHtml/SyllabusHtml.2026.9973344.html',
    )
  })
})
