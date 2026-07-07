export function normalizeText(text: unknown): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ')
}

export function stripTags(html: string): string {
  return normalizeText(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' '),
  )
}

export function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  }
  return String(text).replace(
    /&(amp|lt|gt|quot|#39|nbsp);/g,
    (match) => entities[match] ?? match,
  )
}
