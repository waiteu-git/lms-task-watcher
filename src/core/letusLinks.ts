import { stripTags, decodeHtmlEntities } from './htmlText'

export type CourseLink = { title: string; url: string }

/**
 * アンカーを抽出し baseUrl で絶対URL化、フラグメント除去、タイトル空は除外。
 * セキュリティ: baseUrl（取得元コースページ）と異なるホストのリンクは除外する。
 * ここで得たURLは後段で credentials:'include' の認証付きfetchに渡るため、course/assign
 * ページ本文に埋め込まれた任意ホスト（フォーラム投稿等の攻撃者制御リンク）への
 * 認証付きリクエストを防ぐ。取得元ホストは呼び出し側で検証済みのコースURL。
 */
export function extractLinksFromHtml(html: string, baseUrl: string): CourseLink[] {
  const links: CourseLink[] = []
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  let baseHost: string
  try {
    baseHost = new URL(baseUrl).hostname
  } catch {
    return links
  }

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1]
    const innerHtml = match[2]
    if (!href) continue
    try {
      const parsed = new URL(href, baseUrl)
      if (parsed.hostname !== baseHost) continue
      const url = parsed.toString().split('#')[0]
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
