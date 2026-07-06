/** CLASSシラバス（静的HTML）のURLを科目コード＋年度から生成する。収集不要・直リンク可。 */

/** 日本の学年暦。ローカル月が4月(index 3)以降なら当年、1〜3月は前年。 */
export function academicYear(now: Date): number {
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
}

export function buildSyllabusUrl(courseCode: string, now: Date): string {
  const y = academicYear(now)
  return `https://class.admin.tus.ac.jp/slResult/${y}/japanese/syllabusHtml/SyllabusHtml.${y}.${courseCode}.html`
}
