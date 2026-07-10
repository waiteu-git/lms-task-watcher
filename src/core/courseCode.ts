/**
 * TUSの科目ID（コース番号）。7文字で、先頭4桁が数字・続く3文字は数字または英大文字。
 * 例: 9973337 / 9960757（数字のみ）, 9975A06（機械航空宇宙力学1）, 9960E09（言語と異文化1）,
 *     9960S01（創域特別講義）のように**英字を含むコードがある**。
 *
 * 旧実装は `\d{7}` 固定で英字入りコードを取りこぼし、当該コースが時間割の科目コード集合から
 * 消えていた（時間割からのコース自動選択が効かない・課題とコマの突合が外れる）。
 *
 * 前後の英数字は境界として弾く（8桁の数字や `A9975A06` のような文字列を誤って拾わないため）。
 */
const EXACT_RE = /^\d{4}[0-9A-Z]{3}$/
const SCAN_RE = /(?<![0-9A-Z])\d{4}[0-9A-Z]{3}(?![0-9A-Z])/g

/** 文字列がちょうど科目IDか。 */
export function isCourseCode(text: string): boolean {
  return EXACT_RE.test(text)
}

/** 文中の全科目IDを返す（統合コースは複数、重複排除）。 */
export function extractCourseCodes(text: string): string[] {
  const matches = text.match(SCAN_RE)
  return matches ? Array.from(new Set(matches)) : []
}

/** 文中の最初の科目ID。無ければ null。 */
export function firstCourseCode(text: string): string | null {
  return extractCourseCodes(text)[0] ?? null
}

/**
 * 境界チェックをせずに最初の科目IDらしき7文字を返す。
 * DOMの innerText は要素間に区切りが入らず `9973337` の直後に `2.0単位` が連結されるため、
 * 境界付きの `firstCourseCode` では拾えない。要素単位で特定できない場合のフォールバック専用。
 */
export function firstCourseCodeLoose(text: string): string | null {
  const m = text.match(/\d{4}[0-9A-Z]{3}/)
  return m ? m[0] : null
}
