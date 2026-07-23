import { describe, expect, it } from 'vitest'
import courseDetectorSource from '../content/courseDetector.ts?raw'
import classTimetableSource from '../content/classTimetable.ts?raw'

// content script (courseDetector.ts / classTimetable.ts) は classic script として実行されるため
// import 文を出力できず、TERMS_VERSION の値をビルド時定数 __TERMS_VERSION__ として
// src/legal/termsVersion.ts から注入している（vite.config.ts の define 参照）。
// このテストは、content script 側に TERMS_VERSION の数値リテラルが再び書き戻され、
// 単一正典からドリフトすることを防ぐ。DOM や chrome API には依存しない純粋なテキスト検証。
//
// コメント（特にヘッダコメントの「__TERMS_VERSION__ を注入している」という説明文）は
// 検証対象のソースにそのまま残ってしまい、「__TERMS_VERSION__ という文字列を含むか」だけを
// 見る検証だとコメントの存在だけで常に真になってしまう。そのため、検証前に必ず
// 行コメント・ブロックコメントを取り除き、実コードの記述のみを対象にする。
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

// hasValidConsent の第2引数を検証する。__TERMS_VERSION__ 参照はここに残ることを要求し、
// TERMS_VERSION（または別名）のローカル定義や数値リテラルの直書きはここで弾く。
// `function hasValidConsent(stored: unknown, version: number)` という関数定義自体も
// 同じ形（識別子 + 括弧 + カンマ区切り引数）にマッチしてしまうため、負の後読みで
// 直前が "function " である呼び出し（＝定義そのもの）を除外し、実際の呼び出し箇所のみを見る。
const HAS_VALID_CONSENT_CALL = /(?<!function\s)hasValidConsent\(\s*[^,()]+,\s*([^)]+?)\s*\)/
const LOCAL_TERMS_VERSION_DECLARATION = /\b(?:const|let|var)\s+TERMS_VERSION\b/
const NUMERIC_SECOND_ARG = /(?<!function\s)hasValidConsent\(\s*[^,()]+,\s*\d+\s*\)/

describe.each([
  ['courseDetector.ts', courseDetectorSource],
  ['classTimetable.ts', classTimetableSource],
])('TERMS_VERSION のドリフト防止 (%s)', (_name, rawSource) => {
  const stripped = stripComments(rawSource)

  it('hasValidConsent の第2引数として __TERMS_VERSION__ を渡している', () => {
    const match = stripped.match(HAS_VALID_CONSENT_CALL)
    expect(match).not.toBeNull()
    expect(match![1].trim()).toBe('__TERMS_VERSION__')
  })

  it('コメントを除いたソースに TERMS_VERSION という識別子のローカル定義が存在しない（const/let/var いずれも）', () => {
    expect(stripped).not.toMatch(LOCAL_TERMS_VERSION_DECLARATION)
  })

  it('コメントを除いたソースで hasValidConsent の第2引数に数値リテラルが直書きされていない', () => {
    expect(stripped).not.toMatch(NUMERIC_SECOND_ARG)
  })
})
