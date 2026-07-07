import { extractLinksFromHtml, type CourseLink } from './letusLinks'

const MOD_VIEW = /\/mod\/[^/]+\/view\.php/

export type UnreadUpdate = { url: string; title: string; detectedAt: string }

/** コースHTMLから mod view.php（教材/課題/アクティビティ）リンクを url 重複排除・url 昇順で返す（シグネチャ）。 */
export function computeCourseSignature(html: string, baseUrl: string): CourseLink[] {
  const links = extractLinksFromHtml(html, baseUrl)
  const seen = new Set<string>()
  const out: CourseLink[] = []
  for (const l of links) {
    if (!MOD_VIEW.test(l.url)) continue
    if (seen.has(l.url)) continue
    seen.add(l.url)
    out.push(l)
  }
  out.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
  return out
}

/** 前回→今回の url 集合差分。 */
export function diffCourseSignature(
  prev: CourseLink[],
  next: CourseLink[],
): { added: CourseLink[]; removed: CourseLink[] } {
  const prevUrls = new Set(prev.map((a) => a.url))
  const nextUrls = new Set(next.map((a) => a.url))
  return {
    added: next.filter((a) => !prevUrls.has(a.url)),
    removed: prev.filter((a) => !nextUrls.has(a.url)),
  }
}

/** 前回シグネチャと今回HTMLから、新シグネチャ・追加項目・保存要否を求める。 */
export function computeCourseUpdate(
  prevSignature: CourseLink[] | null,
  html: string,
  baseUrl: string,
  now: string,
): { signature: CourseLink[]; added: UnreadUpdate[]; skipSave: boolean } {
  const signature = computeCourseSignature(html, baseUrl)
  if (prevSignature === null) {
    return { signature, added: [], skipSave: false }
  }
  if (signature.length === 0 && prevSignature.length > 0) {
    return { signature: [], added: [], skipSave: true }
  }
  const added = diffCourseSignature(prevSignature, signature).added.map((l) => ({
    url: l.url,
    title: l.title,
    detectedAt: now,
  }))
  return { signature, added, skipSave: false }
}
