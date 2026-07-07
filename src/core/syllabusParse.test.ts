import { describe, it, expect } from 'vitest'
import { parseSyllabus, japaneseLabel, type SyllabusDoc } from './syllabusParse'
import html9973344 from './syllabusFixtures/9973344.html?raw'
import html9973365 from './syllabusFixtures/9973365.html?raw'

function sectionValue(doc: SyllabusDoc, label: string): string | null {
  return doc.sections.find((s) => s.label === label)?.value ?? null
}

describe('japaneseLabel', () => {
  it('日英併記から日本語部分を取り出す', () => {
    expect(japaneseLabel('概要 Description')).toBe('概要')
    expect(japaneseLabel('教科書の使用有無（有=Y , 無=N） Textbook used(Y for yes, N for no)')).toBe(
      '教科書の使用有無（有=Y , 無=N）',
    )
  })
  it('日本語が無ければ原文を返す', () => {
    expect(japaneseLabel('Instructor')).toBe('Instructor')
  })
})

describe('parseSyllabus', () => {
  it('授業コードとタイトル（和文/英文）を取り出す', () => {
    const d = parseSyllabus(html9973344)
    expect(d.code).toBe('9973344')
    expect(d.titleJa).toBe('物理学実験Ａ')
    expect(d.titleEn).toBe('Experiments in PhysicsA')
  })
  it('別科目でもコード・和文タイトルを取り出す', () => {
    const d = parseSyllabus(html9973365)
    expect(d.code).toBe('9973365')
    expect(d.titleJa).toBe('基礎電気工学')
  })
  it('主要セクションが値付きで得られる', () => {
    const d = parseSyllabus(html9973344)
    expect(d.sections.length).toBeGreaterThanOrEqual(20)
    expect(sectionValue(d, '概要')).toContain('物理学実験')
    expect(sectionValue(d, '成績評価方法')).toContain('平常点')
    expect(sectionValue(d, '曜日時限')).toContain('火曜4限')
  })
  it('構造が壊れたHTMLでも例外を投げず空docを返す', () => {
    const d = parseSyllabus('<html><body>no rows</body></html>')
    expect(d.sections).toEqual([])
    expect(d.code).toBe('')
    expect(d.titleJa).toBe('')
  })
})
