/**
 * 週間カレンダー（v1.4.0）のICS書き出し。
 *
 * 生成は完全ローカル（文字列→Blobダウンロード）で、通信・追加権限なし。
 * 書き出し時点のスナップショットであり自動同期はしない（UI側で明記する）。
 * VALARMは意図的に入れない＝締切前通知は拡張本体の機能と重複するため。
 */
import type { TimelineItem } from '../utils/timeline'
import { timelineItemUrl } from './calendarView'

const CRLF = '\r\n'
const MAX_LINE_OCTETS = 75

/** RFC5545 3.3.11 TEXT のエスケープ。改行は \n リテラルへ。 */
export function escapeIcsText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\n')
}

/** ISO文字列 → UTCのICS日時（YYYYMMDDTHHMMSSZ）。 */
export function formatIcsUtc(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

const encoder = new TextEncoder()

/**
 * RFC5545 3.1 の行折り返し（75オクテット以内・継続行は先頭スペース）。
 * オクテット数で判定しつつ、マルチバイト文字の途中では切らない。
 */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line

  const parts: string[] = []
  let current = ''
  let currentOctets = 0

  for (const char of line) {
    const charOctets = encoder.encode(char).length
    // 継続行は先頭スペースの1オクテットを消費する
    const limit = parts.length === 0 ? MAX_LINE_OCTETS : MAX_LINE_OCTETS - 1
    if (currentOctets + charOctets > limit) {
      parts.push(current)
      current = char
      currentOctets = charOctets
    } else {
      current += char
      currentOctets += charOctets
    }
  }
  if (current) parts.push(current)

  return parts.map((part, i) => (i === 0 ? part : ` ${part}`)).join(CRLF)
}

function contentLine(name: string, value: string): string {
  return foldIcsLine(`${name}:${value}`)
}

/** 統合タイムラインの締切あり課題をVEVENT化したVCALENDAR文字列を返す。 */
export function buildCalendarIcs(items: TimelineItem[], now: Date): string {
  const dtstamp = formatIcsUtc(now.toISOString())
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LETUS Task Watcher//lms.waiteu.dev//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]

  for (const item of items) {
    const deadline = item.assignment.deadline
    if (!deadline) continue
    const deadlineDate = new Date(deadline)
    if (Number.isNaN(deadlineDate.getTime())) continue

    lines.push('BEGIN:VEVENT')
    lines.push(contentLine('UID', `ltw-${item.kind}-${item.assignment.id}@lms.waiteu.dev`))
    lines.push(contentLine('DTSTAMP', dtstamp))
    lines.push(contentLine('DTSTART', formatIcsUtc(deadline)))
    lines.push(contentLine('SUMMARY', escapeIcsText(item.assignment.title)))
    lines.push(contentLine('DESCRIPTION', escapeIcsText(item.assignment.courseName)))
    const url = timelineItemUrl(item)
    if (url) lines.push(contentLine('URL', url))
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return lines.join(CRLF) + CRLF
}

/** ローカル日付入りのダウンロードファイル名。 */
export function icsFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `ltw-assignments-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.ics`
}
