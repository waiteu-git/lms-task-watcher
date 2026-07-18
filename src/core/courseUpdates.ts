import { extractLinksFromHtml, type CourseLink } from './letusLinks'
import { extractBodyClasses } from './moodleFingerprint'

const MOD_VIEW = /\/mod\/[^/]+\/view\.php/

export type UnreadUpdate = { url: string; title: string; detectedAt: string }

/**
 * 診断入力（spec§4 skipSave明示化）: computeCourseUpdate が黙ってスキップしていた
 * 「シグネチャが prev>0 から 0 に潰れた」事象を、配線側（background）が
 * diagnoseCoursePage へそのまま流せる形で戻り値に浮上させる。純粋層のまま
 * chrome.* / fetch には触れない（永続・UI反映は配線側の責務）。
 */
export interface CourseUpdateDiagnostic {
  /** 今回スクレイプで実測した mod-anchor（/mod/<type>/view.php）数 */
  modAnchorCount: number
  /** 前回シグネチャ件数。初回スキャン（prev無し）は null */
  prevSignatureLen: number | null
  /** ページがコースページとして認識できるマーカー（format-* 等のbodyクラス）を持つか */
  hasCourseMarker: boolean
  /** シグネチャが prev>0 から 0 に潰れて保存をスキップした（last-good保持）ことの明示 */
  skipped: boolean
}

/**
 * course/view.php のbodyクラスに現れるコースページマーカーか。
 * format-*（コースフォーマット）は 4.x/5.x を通じて安定（spec§3原則3の安定フック）。
 * path-course-view / pagelayout-course はレイアウト側の補助マーカー。
 */
function isCourseMarkerClass(cls: string): boolean {
  return cls.startsWith('format-') || cls === 'path-course-view' || cls === 'pagelayout-course'
}

/**
 * HTMLがコースページとして認識できるマーカーを持つか（純関数）。
 * 「0 mod-anchor」がページ破損（マーカーごと消失）か内容消失（マーカーは残存）かを
 * 区別する診断入力。ログインページ・メンテページ・非HTML応答では false になる。
 */
export function hasCourseMarker(html: string): boolean {
  return extractBodyClasses(html).some(isCourseMarkerClass)
}

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

/**
 * 前回シグネチャと今回HTMLから、新シグネチャ・追加項目・保存要否・診断入力を求める。
 * skipSave=true（prev>0 なのに今回0件）は last-good 保持のため保存をスキップする既存挙動を
 * 維持しつつ、diagnostic.skipped で「スキップが起きた」ことを明示的に返す（spec§4）。
 */
export function computeCourseUpdate(
  prevSignature: CourseLink[] | null,
  html: string,
  baseUrl: string,
  now: string,
): {
  signature: CourseLink[]
  added: UnreadUpdate[]
  skipSave: boolean
  diagnostic: CourseUpdateDiagnostic
} {
  const signature = computeCourseSignature(html, baseUrl)
  const diagnostic: CourseUpdateDiagnostic = {
    modAnchorCount: signature.length,
    prevSignatureLen: prevSignature === null ? null : prevSignature.length,
    hasCourseMarker: hasCourseMarker(html),
    skipped: false,
  }
  if (prevSignature === null) {
    return { signature, added: [], skipSave: false, diagnostic }
  }
  if (signature.length === 0 && prevSignature.length > 0) {
    return { signature: [], added: [], skipSave: true, diagnostic: { ...diagnostic, skipped: true } }
  }
  const added = diffCourseSignature(prevSignature, signature).added.map((l) => ({
    url: l.url,
    title: l.title,
    detectedAt: now,
  }))
  return { signature, added, skipSave: false, diagnostic }
}
