import type { Semester } from './timetableLink'

const TIMETABLE_KEY_RE = /^timetable:(\d{4}):(zenki|kouki)$/

/** `timetable:2026:zenki` 形式のストレージキーだけを厳密一致で解析する。
 * `timetableOverrides:...` や `timetableView` は一致しない（アンカー必須）。 */
export function parseTimetableKey(key: string): { year: number; semester: Semester } | null {
  const m = TIMETABLE_KEY_RE.exec(key)
  if (!m) return null
  return { year: Number(m[1]), semester: m[2] as Semester }
}

/** `timetableImportNotified` に積む重複排除キー（`{year}:{semester}`形式）。notifiedDeadlineKeysと同じ発想。 */
export function timetableNotifyKey(year: number, semester: Semester): string {
  return `${year}:${semester}`
}

/** 変更のあった（セットされた）キー群のうち、学期ごとにまだ通知していない最初の時間割キーを返す。
 * 前期を通知済みでも後期は別途通知できる（旧: 一度でも通知したら永久に止まる仕様の修正。
 * 2026-07-15設計の非目標「学期別の初回通知はYAGNI」を撤回：後期開始のタイミングで
 * 「後期未取込」UIナッジ→ユーザーが取り込む→無反応、という非対称なUXになるため）。 */
export function pickTimetableImportNotification(
  setKeys: string[],
  notifiedKeys: Set<string>,
): { year: number; semester: Semester } | null {
  for (const key of setKeys) {
    const parsed = parseTimetableKey(key)
    if (parsed && !notifiedKeys.has(timetableNotifyKey(parsed.year, parsed.semester))) return parsed
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
