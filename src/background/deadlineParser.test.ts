import { describe, it, expect } from 'vitest'
import { extractDeadlineText, parseDeadline } from './deadlineParser'

const jst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null

describe('extractDeadlineText + parseDeadline (実データ回帰)', () => {
  it('終了済みの閉じた小テストを拾う', () => {
    const text = '創域特別講義: 小試験 開始済み: 2026年 06月 08日(月曜日) 00:00 終了済み: 2026年 06月 19日(金曜日) 23:59 受験可能期間：6月8日'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/6/19 23:59:00')
  })

  it('期限:フィールドの課題を拾う', () => {
    const text = '期限: 2026年 05月 18日(月曜日) 23:59 1回目のグループワークの提出フォームです。'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/5/18 23:59:00')
  })

  it('終了予定の受付中小テストを拾う', () => {
    const text = '終了予定: 2026年 07月 10日(金曜日) 00:00 制限時間は10分間'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/7/10 0:00:00')
  })

  it('締切なし(開始日時のみ)は null', () => {
    const text = '正誤問題 開始日時: 2026年 04月 21日(月曜日) 00:00 制限時間なし'
    expect(parseDeadline(extractDeadlineText(text))).toBe(null)
  })
})

describe('② コロン付きラベル優先', () => {
  it('タイトルの締切(パレン)を無視し本文の期限:を優先', () => {
    const text = '締切（5/29 14:40) | LETUS 2026 ナビ 期限: 2026年 05月 29日(金曜日) 14:40 以下について取り組み'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/5/29 14:40:00')
  })

  it('ナビの締切：7月3日より本文の終了済み:を優先', () => {
    const text = '創域特別講義: 小試験 終了済み: 2026年 06月 19日(金曜日) 23:59 ……ナビ…… 第13回小テスト（締切：7月3日） 履修方法'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/6/19 23:59:00')
  })

  it('コロン付きが無ければ従来どおり最早キーワードにフォールバック', () => {
    const text = '締切 2026年 06月 01日(月曜日) 23:59'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/6/1 23:59:00')
  })
})

describe('③ スラッシュ日付', () => {
  it('M/D HH:MM を解析', () => {
    const text = '締切: 5/29 14:40 まで'
    expect(jst(parseDeadline(text))).toBe('2026/5/29 14:40:00')
  })

  it('YYYY/M/D を解析(時刻なし→23:59)', () => {
    const text = '締切: 2026/6/1 提出のこと'
    expect(jst(parseDeadline(text))).toBe('2026/6/1 23:59:00')
  })

  it('不正な月日(13/40)は不採用でnull', () => {
    const text = '締切: 13/40'
    expect(parseDeadline(text)).toBe(null)
  })

  it('日本語日付が優先される(スラッシュより先)', () => {
    const text = '期限: 2026年 06月 19日 23:59 (7/3更新)'
    expect(jst(parseDeadline(text))).toBe('2026/6/19 23:59:00')
  })
})
