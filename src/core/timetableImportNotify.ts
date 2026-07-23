import type { Semester } from './timetableLink'

const TIMETABLE_KEY_RE = /^timetable:(\d{4}):(zenki|kouki)$/

/** `timetable:2026:zenki` 形式のストレージキーだけを厳密一致で解析する。
 * `timetableOverrides:...` や `timetableView` は一致しない（アンカー必須）。 */
export function parseTimetableKey(key: string): { year: number; semester: Semester } | null {
  const m = TIMETABLE_KEY_RE.exec(key)
  if (!m) return null
  return { year: Number(m[1]), semester: m[2] as Semester }
}

/** 変更のあった（セットされた）キー群のうち、まだ通知していなければ最初の時間割キーを返す。
 * 初回取込のみ通知するための判定。 */
export function pickFirstImportNotification(
  setKeys: string[],
  alreadyNotified: boolean,
): { year: number; semester: Semester } | null {
  if (alreadyNotified) return null
  for (const key of setKeys) {
    const parsed = parseTimetableKey(key)
    if (parsed) return parsed
  }
  return null
}

export function buildFirstImportNotification(
  year: number,
  semester: Semester,
): { title: string; message: string } {
  const label = semester === 'zenki' ? '前期' : '後期'
  return {
    title: '時間割を取り込みました',
    message: `${year}年度${label}の時間割を登録しました。ダッシュボードで確認できます。`,
  }
}
