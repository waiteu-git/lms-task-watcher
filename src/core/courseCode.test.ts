import { describe, it, expect } from 'vitest'
import { isCourseCode, firstCourseCode, firstCourseCodeLoose, extractCourseCodes } from './courseCode'

describe('isCourseCode', () => {
  it('数字のみ7桁は科目ID', () => {
    expect(isCourseCode('9973337')).toBe(true)
  })
  it('先頭4桁が数字で続く3文字が英大文字混在なら科目ID', () => {
    expect(isCourseCode('9975A06')).toBe(true) // 機械航空宇宙力学1
    expect(isCourseCode('9960S01')).toBe(true) // 創域特別講義
    expect(isCourseCode('9960E09')).toBe(true) // 言語と異文化1
  })
  it('桁数違い・英小文字・先頭に英字は科目IDでない', () => {
    expect(isCourseCode('997333')).toBe(false)
    expect(isCourseCode('99733370')).toBe(false)
    expect(isCourseCode('9975a06')).toBe(false)
    expect(isCourseCode('997A337')).toBe(false)
  })
})

describe('extractCourseCodes', () => {
  it('文中の科目IDを全て抽出する（統合コースは複数）', () => {
    expect(extractCourseCodes('9973337 基礎電気数学及び演習')).toEqual(['9973337'])
    expect(extractCourseCodes('統合 9973337 / 9973344')).toEqual(['9973337', '9973344'])
  })
  it('英字を含む科目IDを抽出する', () => {
    expect(extractCourseCodes('9975A06 機械航空宇宙力学1')).toEqual(['9975A06'])
    expect(extractCourseCodes('9960E09 言語と異文化1')).toEqual(['9960E09'])
    expect(extractCourseCodes('9975A06 / 9960S01')).toEqual(['9975A06', '9960S01'])
  })
  it('重複は排除する', () => {
    expect(extractCourseCodes('9975A06 と 9975A06')).toEqual(['9975A06'])
  })
  it('科目IDが無ければ空配列', () => {
    expect(extractCourseCodes('基礎電気数学及び演習')).toEqual([])
  })
  it('前後に英数字が続く場合は科目IDとみなさない', () => {
    expect(extractCourseCodes('99733370 号')).toEqual([]) // 8桁
    expect(extractCourseCodes('19973337')).toEqual([]) // 先頭に数字
    expect(extractCourseCodes('9975A06X')).toEqual([]) // 直後に英大文字
    expect(extractCourseCodes('A9975A06')).toEqual([]) // 直前に英大文字
  })
  it('英小文字・日本語は境界として扱う', () => {
    expect(extractCourseCodes('（9975A06）機械航空宇宙力学1')).toEqual(['9975A06'])
    expect(extractCourseCodes('9973337-a')).toEqual(['9973337'])
  })
})

describe('firstCourseCodeLoose', () => {
  it('区切り無しで連結されたDOMテキストからも拾う', () => {
    expect(firstCourseCodeLoose('野：445教室99733372.0単位')).toBe('9973337')
    expect(firstCourseCodeLoose('野：K404教室9975A062.0単位')).toBe('9975A06')
  })
  it('無ければ null', () => {
    expect(firstCourseCodeLoose('基礎電気数学')).toBeNull()
  })
})

describe('firstCourseCode', () => {
  it('文中の最初の科目IDを返す', () => {
    expect(firstCourseCode('統合 9973337 / 9975A06')).toBe('9973337')
  })
  it('無ければ null', () => {
    expect(firstCourseCode('基礎電気数学')).toBeNull()
  })
})
