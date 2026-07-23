import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import {
  extractDeadlineText,
  parseDeadline,
  parseDeadlineFromTitle,
  hasDeadlineKeyword,
} from './deadlineParser'

const jst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-04T00:00:00'))
})
afterAll(() => {
  vi.useRealTimers()
})

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

  it('ラベル値でない比率トークン(10/10問)は拾わずnull', () => {
    expect(parseDeadline('締切: 制限時間 10/10問 正解')).toBe(null)
  })

  it('区切りの無い文中の分数(3/4)は拾わずnull', () => {
    expect(parseDeadline('期限のヒント 3/4 の割合')).toBe(null)
  })
})

describe('④ タイトル締切フォールバック', () => {
  it('（締切：7月3日）を推定', () => {
    expect(jst(parseDeadlineFromTitle('第13回小テスト（締切：7月3日）'))).toBe('2026/7/3 23:59:00')
  })
  it('（提出締め切り5月18日）を推定', () => {
    expect(jst(parseDeadlineFromTitle('課題提出フォーム（提出締め切り5月18日）'))).toBe('2026/5/18 23:59:00')
  })
  it('締切（5/29 14:40) を推定', () => {
    expect(jst(parseDeadlineFromTitle('締切（5/29 14:40)'))).toBe('2026/5/29 14:40:00')
  })
  it('日付の無い曜日〆は null', () => {
    expect(parseDeadlineFromTitle('WK1 宿題窓口（金曜日〆）')).toBe(null)
  })
})

// システム時刻は beforeAll で 2026-07-04T00:00:00（ローカル）に固定済み
describe('⑤ 相対/human日付の副次認識器（絶対日付が無いときのみ）', () => {
  it('今日 → 当日23:59', () => {
    expect(jst(parseDeadline('締切: 今日'))).toBe('2026/7/4 23:59:00')
  })

  it('本日 → 当日23:59', () => {
    expect(jst(parseDeadline('期限: 本日'))).toBe('2026/7/4 23:59:00')
  })

  it('明日 → +1日23:59', () => {
    expect(jst(parseDeadline('締切: 明日'))).toBe('2026/7/5 23:59:00')
  })

  it('あと3日 → +3日23:59', () => {
    expect(jst(parseDeadline('締切: あと3日'))).toBe('2026/7/7 23:59:00')
  })

  it('あと0日（境界）→ 当日23:59', () => {
    expect(jst(parseDeadline('締切: あと 0 日'))).toBe('2026/7/4 23:59:00')
  })

  it('空白入り複数桁（あと 12 日）→ +12日', () => {
    expect(jst(parseDeadline('締切: あと 12 日'))).toBe('2026/7/16 23:59:00')
  })

  it('大きなN（あと365日）→ 翌年へ繰り上がる', () => {
    expect(jst(parseDeadline('締切: あと365日'))).toBe('2027/7/4 23:59:00')
  })

  it('TODAY（大文字）→ 当日', () => {
    expect(jst(parseDeadline('Due: TODAY'))).toBe('2026/7/4 23:59:00')
  })

  it('tomorrow（小文字）→ +1日', () => {
    expect(jst(parseDeadline('Closes: tomorrow'))).toBe('2026/7/5 23:59:00')
  })

  it('Tomorrow（先頭大文字）→ +1日', () => {
    expect(jst(parseDeadline('Due date: Tomorrow'))).toBe('2026/7/5 23:59:00')
  })

  it('in 5 days → +5日', () => {
    expect(jst(parseDeadline('Due date: in 5 days'))).toBe('2026/7/9 23:59:00')
  })

  it('in 1 day（単数形）→ +1日', () => {
    expect(jst(parseDeadline('Due: in 1 day'))).toBe('2026/7/5 23:59:00')
  })

  it('絶対日付があるときは相対語より絶対日付を優先する', () => {
    expect(jst(parseDeadline('期限: 2026年 6月 19日 23:59（あと3日）'))).toBe(
      '2026/6/19 23:59:00',
    )
  })

  it('now引数で決定的に評価できる（年跨ぎの繰り上がり）', () => {
    expect(jst(parseDeadline('締切: あと3日', new Date(2026, 11, 30)))).toBe(
      '2027/1/2 23:59:00',
    )
  })

  it('now引数で明日も決定的', () => {
    expect(jst(parseDeadline('締切: 明日', new Date(2026, 0, 31)))).toBe('2026/2/1 23:59:00')
  })

  it('複合語の「説明日」を明日と誤認しない', () => {
    expect(parseDeadline('締切: 課題の説明日程を参照')).toBe(null)
  })

  it('複数の相対語があるときはキーワードに近い方を採用', () => {
    expect(jst(parseDeadline('締切: 明日 23:59 今日中に準備すること'))).toBe(
      '2026/7/5 23:59:00',
    )
  })

  it('相対語が無ければ従来どおり null', () => {
    expect(parseDeadline('締切: 制限時間 10分')).toBe(null)
  })
})

describe('⑤-2 相対語は締切キーワード文脈でのみ効く（呼び出し構造の裏取り）', () => {
  // 実スキャン経路（background/index.ts）は extractDeadlineText が空文字なら
  // parseDeadline を呼ばない。キーワード無し本文の相対語が拾われないことを固定する。
  it('キーワード無し本文の「明日/今日」は extractDeadlineText が空を返す', () => {
    const text = '明日の授業は休講です。今日の小テストはありません。'
    expect(extractDeadlineText(text)).toBe('')
    expect(parseDeadline(extractDeadlineText(text))).toBe(null)
  })

  it('キーワードがあれば抽出窓を経由して相対語が解決される', () => {
    const text = '小テスト 終了予定: 明日 制限時間は10分間'
    expect(jst(parseDeadline(extractDeadlineText(text)))).toBe('2026/7/5 23:59:00')
  })
})

describe('⑤-3 散文中の相対語を締切に昇格させない（ラベル-値形式アンカー）', () => {
  // 抽出窓は締切キーワードから始まる320文字＝キーワードから離れた散文の
  // 「今日/明日」も窓内に入る。相対語は「ラベル[:：] 値」のラベル直後のみ採用し、
  // 期限未設定の説明文から幻の締切（スキャン時刻基準で日々ドリフト）を作らない。
  it('散文の「今日」（〜が期限です。今日から…）は昇格しない', () => {
    const text = '毎週の課題は翌週月曜が期限です。今日から取り組みましょう'
    expect(parseDeadline(extractDeadlineText(text))).toBe(null)
  })

  it('散文の「明日」（締切は口頭で…。明日の授業で…）は昇格しない', () => {
    const text = '締切は口頭で伝えます。明日の授業で説明します'
    expect(parseDeadline(extractDeadlineText(text))).toBe(null)
  })

  it('ラベル直後でない相対語は parseDeadline 直呼びでも棄却', () => {
    expect(parseDeadline('期限です。今日から取り組みましょう')).toBe(null)
  })

  it('ラベル値スロットが別トークンで占有されていれば後方の相対語は棄却', () => {
    expect(parseDeadline('締切: 13/40 明日')).toBe(null)
  })

  it('タイトル経路は相対語を解決しない（英語・静的テキストのため）', () => {
    expect(parseDeadlineFromTitle("Close Reading: today's exercise")).toBe(null)
  })

  it('タイトル経路はラベル形式の相対語でも解決しない', () => {
    expect(parseDeadlineFromTitle('締切: 明日')).toBe(null)
  })

  it('タイトル経路の絶対日付は引き続き有効', () => {
    expect(jst(parseDeadlineFromTitle('第13回小テスト（締切：7月3日）'))).toBe('2026/7/3 23:59:00')
  })
})

describe('⑤-4 「無期限」内の部分文字列キーワードから相対語を捏造しない（コロン必須アンカー）', () => {
  // 抽出窓は「無期限」内の部分文字列「期限」からも始まる（窓「期限 今日から…」）。
  // 相対アンカーのコロンが任意だと素のキーワード＋空白で成立し、締切なし課題の
  // 説明文から偽の「本日締切」通知を作る。コロン必須化の回帰ガード。
  it('「提出は無期限 今日から利用可能です」を本日締切に捏造しない', () => {
    expect(parseDeadline(extractDeadlineText('提出は無期限 今日から利用可能です'))).toBe(null)
  })

  it('「無期限 明日から公開されます」を明日締切に捏造しない', () => {
    expect(parseDeadline(extractDeadlineText('無期限 明日から公開されます'))).toBe(null)
  })

  it('素のキーワード直後の相対語はコロンが無ければ採用しない（parseDeadline直呼び）', () => {
    expect(parseDeadline('期限 今日')).toBe(null)
  })

  it('コロン付きラベルの相対語は引き続き解決される', () => {
    expect(jst(parseDeadline('期限: 今日'))).toBe('2026/7/4 23:59:00')
  })

  it('全角コロン＋空白のラベルも解決される', () => {
    expect(jst(parseDeadline('締切　：　明日'))).toBe('2026/7/5 23:59:00')
  })
})

describe('⑥ hasDeadlineKeyword（存在判定のみ）', () => {
  it('日本語キーワードを含めば true', () => {
    expect(hasDeadlineKeyword('第10回 レポート課題 終了日時: 明日')).toBe(true)
  })

  it('英語キーワードは大文字小文字を無視して true', () => {
    expect(hasDeadlineKeyword('DUE DATE: Tomorrow')).toBe(true)
  })

  it('開始系キーワードのみは false', () => {
    expect(hasDeadlineKeyword('開始日時: 2026年 04月 21日(月曜日) 00:00 制限時間なし')).toBe(
      false,
    )
  })

  it('無関係な本文は false', () => {
    expect(hasDeadlineKeyword('明日の授業は休講です')).toBe(false)
  })

  it('空文字は false', () => {
    expect(hasDeadlineKeyword('')).toBe(false)
  })
})
