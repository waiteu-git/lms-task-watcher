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
  let bestIndex = -1

  for (const keyword of DEADLINE_KEYWORDS) {
    const index = lowerText.indexOf(keyword.toLowerCase())
    if (index >= 0 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index
    }
  }

  if (bestIndex >= 0) {
    return text.slice(bestIndex, Math.min(text.length, bestIndex + 320))
  }

  const hasStartOnlyKeyword = START_KEYWORDS.some((keyword) =>
    lowerText.includes(keyword.toLowerCase()),
  )
  if (hasStartOnlyKeyword) return ''
  return ''
}

export function parseDeadline(deadlineText: string): string | null {
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
    const currentYear = String(new Date().getFullYear())
    const hasHour = noYearJapaneseDateMatch[3] !== undefined
    return toIsoStringFromParts(
      currentYear,
      noYearJapaneseDateMatch[1],
      noYearJapaneseDateMatch[2],
      hasHour ? noYearJapaneseDateMatch[3] : '23',
      hasHour ? (noYearJapaneseDateMatch[4] ?? '00') : '59',
    )
  }

  return null
}
