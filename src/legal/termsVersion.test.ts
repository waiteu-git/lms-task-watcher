import { describe, expect, it } from 'vitest'
import courseDetectorSource from '../content/courseDetector.ts?raw'
import classTimetableSource from '../content/classTimetable.ts?raw'

// content script (courseDetector.ts / classTimetable.ts) は classic script として実行されるため
// import 文を出力できず、TERMS_VERSION の値をビルド時定数 __TERMS_VERSION__ として
// src/legal/termsVersion.ts から注入している（vite.config.ts の define 参照）。
// このテストは、content script 側に TERMS_VERSION の数値リテラルが再び書き戻され、
// 単一正典からドリフトすることを防ぐ。DOM や chrome API には依存しない純粋なテキスト検証。
const NUMERIC_TERMS_VERSION_LITERAL = /const\s+TERMS_VERSION\s*=\s*\d+/

describe('TERMS_VERSION のドリフト防止', () => {
  it('courseDetector.ts に TERMS_VERSION の数値リテラル定義が存在しない', () => {
    expect(courseDetectorSource).not.toMatch(NUMERIC_TERMS_VERSION_LITERAL)
  })

  it('classTimetable.ts に TERMS_VERSION の数値リテラル定義が存在しない', () => {
    expect(classTimetableSource).not.toMatch(NUMERIC_TERMS_VERSION_LITERAL)
  })

  it('courseDetector.ts が __TERMS_VERSION__ を参照している', () => {
    expect(courseDetectorSource).toContain('__TERMS_VERSION__')
  })

  it('classTimetable.ts が __TERMS_VERSION__ を参照している', () => {
    expect(classTimetableSource).toContain('__TERMS_VERSION__')
  })
})
