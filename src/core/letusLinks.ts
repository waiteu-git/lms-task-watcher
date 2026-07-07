import { stripTags, decodeHtmlEntities } from './htmlText'

export type CourseLink = { title: string; url: string }

/** アンカーを抽出し baseUrl で絶対URL化、フラグメント除去、タイトル空は除外。 */
export function extractLinksFromHtml(html: string, baseUrl: string): CourseLink[] {
  const links: CourseLink[] = []
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1]
    const innerHtml = match[2]
    if (!href) continue
    try {
      const url = new URL(href, baseUrl).toString().split('#')[0]
      const title = decodeHtmlEntities(stripTags(innerHtml))
      if (title.length > 0) {
        links.push({ title, url })
      }
    } catch {
      // URL変換失敗は無視
    }
  }

  return links
}
