// 締切テキスト抽出・日付パース（純粋関数・単体テスト可能）

function normalizeText(text: unknown): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ')
}

export function toIsoStringFromParts(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
): string | null {
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  )
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

const DEADLINE_KEYWORDS = [
  '提出期限', '提出締切', '締切日時', '締切', '期限', '終了予定', '終了済み', '終了日時',
  '利用終了日時', '受験終了', '回答終了',
  'Due date', 'Closing date', 'Close date', 'Closes', 'Due', 'Close',
]

const START_KEYWORDS = [
  '開始予定', '開始日時', '開始済み', '開始', '利用開始日時', '受験開始', '公開日時', '公開',
  'Open date', 'Opened', 'Available from',
]

export function extractDeadlineText(plainText: string): string {
  const text = normalizeText(plainText)
  const lowerText = text.toLowerCase()
  let bestColonIndex = -1
  let bestBareIndex = -1

  for (const keyword of DEADLINE_KEYWORDS) {
    const lowerKeyword = keyword.toLowerCase()
    let from = 0
    let index: number
    while ((index = lowerText.indexOf(lowerKeyword, from)) >= 0) {
      if (bestBareIndex === -1 || index < bestBareIndex) bestBareIndex = index
      // キーワード直後（空白を挟んで）が : or ： なら実フィールドとみなす
      const after = text.slice(index + keyword.length, index + keyword.length + 3)
      if (/^\s*[:：]/.test(after)) {
        if (bestColonIndex === -1 || index < bestColonIndex) bestColonIndex = index
      }
      from = index + keyword.length
    }
  }

  const chosen = bestColonIndex >= 0 ? bestColonIndex : bestBareIndex
  if (chosen >= 0) {
    return text.slice(chosen, Math.min(text.length, chosen + 320))
  }

  const hasStartOnlyKeyword = START_KEYWORDS.some((keyword) =>
    lowerText.includes(keyword.toLowerCase()),
  )
  if (hasStartOnlyKeyword) return ''
  return ''
}

/**
 * 締切キーワードの存在判定のみを行う軽量プローブ（extractDeadlineText の既存APIは不変）。
 * 自己診断（DEADLINE_KEYWORD_NO_DATE: キーワード有るのに日付null）の入力に使う。
 * extractDeadlineText と同じ DEADLINE_KEYWORDS を共有し、判定基準がズレないようにする。
 */
export function hasDeadlineKeyword(plainText: string): boolean {
  const lowerText = normalizeText(plainText).toLowerCase()
  return DEADLINE_KEYWORDS.some((keyword) => lowerText.includes(keyword.toLowerCase()))
}

/**
 * 相対/human日付の副次認識器（spec§3原則4）。
 * Moodle の relative dates mode 等で「今日/明日/あとN日/Today/Tomorrow/in N days」が
 * 出た場合の補完で、絶対日付が1つも取れなかったときだけ parseDeadline から呼ばれる。
 * 時刻は仕様どおり一律 23:59（基準日 now のローカル日付起点）。
 * 誤検知防止は呼び出し構造で担保する: 実スキャン経路（background/index.ts）は
 * extractDeadlineText が締切キーワードを見つけた時のみ parseDeadline を呼ぶため、
 * 無関係本文の「今日/明日」には反応しない（deadlineParser.test.ts ⑤-2 で裏取り）。
 */
function parseRelativeDeadline(text: string, now: Date): string | null {
  const candidates: Array<{ index: number; days: number }> = []
  const add = (index: number, days: number) => {
    if (index >= 0) candidates.push({ index, days })
  }

  // 「説明日/発明日/判明日/表明日/証明日」等の複合語に含まれる「明日」を誤認しない
  add(text.search(/(?<![説発判表証])明日/), 1)
  add(text.search(/今日|本日/), 0)
  const remainJa = /あと\s*(\d+)\s*日/.exec(text)
  if (remainJa) add(remainJa.index, Number(remainJa[1]))
  add(text.search(/\btoday\b/i), 0)
  add(text.search(/\btomorrow\b/i), 1)
  const inDaysEn = /\bin\s+(\d+)\s+days?\b/i.exec(text)
  if (inDaysEn) add(inDaysEn.index, Number(inDaysEn[1]))

  if (candidates.length === 0) return null
  // 抽出窓の先頭＝締切キーワードに最も近い表現を採用する
  candidates.sort((a, b) => a.index - b.index)
  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + candidates[0].days,
    23,
    59,
    0,
    0,
  )
  if (Number.isNaN(target.getTime())) return null
  return target.toISOString()
}

export function parseDeadline(deadlineText: string, now: Date = new Date()): string | null {
  const text = normalizeText(deadlineText)

  const japaneseDateMatch = text.match(
    /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[(（][^)）]*[)）])?\s*(?:(\d{1,2})\s*(?:時|:|：)\s*(\d{1,2})?\s*分?)?/,
  )
  if (japaneseDateMatch) {
    const hasHour = japaneseDateMatch[4] !== undefined
    return toIsoStringFromParts(
      japaneseDateMatch[1],
      japaneseDateMatch[2],
      japaneseDateMatch[3],
      hasHour ? japaneseDateMatch[4] : '23',
      hasHour ? (japaneseDateMatch[5] ?? '00') : '59',
    )
  }

  const noYearJapaneseDateMatch = text.match(
    /(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[(（][^)）]*[)）])?\s*(?:(\d{1,2})\s*(?:時|:|：)\s*(\d{1,2})?\s*分?)?/,
  )
  if (noYearJapaneseDateMatch) {
    const currentYear = String(now.getFullYear())
    const hasHour = noYearJapaneseDateMatch[3] !== undefined
    return toIsoStringFromParts(
      currentYear,
      noYearJapaneseDateMatch[1],
      noYearJapaneseDateMatch[2],
      hasHour ? noYearJapaneseDateMatch[3] : '23',
      hasHour ? (noYearJapaneseDateMatch[4] ?? '00') : '59',
    )
  }

  const slashDateMatch = text.match(
    /(?:^\s*|[：:（(]\s*)(?:(20\d{2})\/)?(\d{1,2})\/(\d{1,2})(?:\s*[(（][^)）]*[)）])?\s*(?:(\d{1,2})\s*[:：]\s*(\d{1,2}))?/,
  )
  if (slashDateMatch) {
    const month = Number(slashDateMatch[2])
    const day = Number(slashDateMatch[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = slashDateMatch[1] ?? String(now.getFullYear())
      const hasHour = slashDateMatch[4] !== undefined
      return toIsoStringFromParts(
        year,
        slashDateMatch[2],
        slashDateMatch[3],
        hasHour ? slashDateMatch[4] : '23',
        hasHour ? (slashDateMatch[5] ?? '00') : '59',
      )
    }
  }

  // 絶対日付にマッチしなかった場合のみ、相対/human日付の副次認識器へフォールバック
  return parseRelativeDeadline(text, now)
}

export function parseDeadlineFromTitle(title: string): string | null {
  const text = normalizeText(title)
  // 締切を示す語が含まれるときのみ推定する（無関係な数字の誤検知を防ぐ）
  if (!/(締切|締め切り|〆|期限|due|close)/i.test(text)) return null
  return parseDeadline(text)
}
