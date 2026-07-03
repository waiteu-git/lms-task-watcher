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

  const slashDateMatch = text.match(
    /(?:(20\d{2})\/)?(\d{1,2})\/(\d{1,2})(?:\s*[(（][^)）]*[)）])?\s*(?:(\d{1,2})\s*[:：]\s*(\d{1,2}))?/,
  )
  if (slashDateMatch) {
    const month = Number(slashDateMatch[2])
    const day = Number(slashDateMatch[3])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = slashDateMatch[1] ?? String(new Date().getFullYear())
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

  return null
}
