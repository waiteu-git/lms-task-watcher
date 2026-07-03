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
