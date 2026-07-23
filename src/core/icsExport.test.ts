import { describe, it, expect } from 'vitest'
import type { Assignment } from './types'
import type { ManualAssignment } from './manualAssignment'
import type { TimelineItem } from '../utils/timeline'
import {
  escapeIcsText,
  formatIcsUtc,
  foldIcsLine,
  buildCalendarIcs,
  icsFileName,
} from './icsExport'

function scanned(over: Partial<Assignment> = {}): TimelineItem {
  return {
    kind: 'scan',
    assignment: {
      id: 'a1',
      courseId: 'c1',
      courseName: '電気数学',
      title: 'レポート1',
      url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=123',
      deadline: '2026-07-22T14:59:00.000Z',
      deadlineText: '',
      deadlineSource: null,
      sourceText: '',
      submissionStatus: 'not_submitted',
      lifecycleStatus: 'active',
      detectedAt: '',
      firstSeenAt: '',
      lastSeenAt: '',
      lastCheckedAt: '',
      ...over,
    },
  }
}

function manual(over: Partial<ManualAssignment> = {}): TimelineItem {
  return {
    kind: 'manual',
    assignment: {
      id: 'm1',
      courseId: 'c1',
      courseName: '電気数学',
      title: '自主ゼミ資料',
      letusUrl: null,
      deadline: '2026-07-23T03:00:00.000Z',
      memo: '',
      submitted: false,
      createdAt: '2026-07-01T00:00:00.000Z',
      ...over,
    },
  }
}

const NOW = new Date('2026-07-23T12:00:00.000Z')

describe('escapeIcsText', () => {
  it('RFC5545のTEXTエスケープを行う', () => {
    expect(escapeIcsText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d')
    expect(escapeIcsText('1行目\n2行目')).toBe('1行目\\n2行目')
    expect(escapeIcsText('CRLF\r\n改行')).toBe('CRLF\\n改行')
  })
})

describe('formatIcsUtc', () => {
  it('ISO文字列をUTCのICS日時形式にする', () => {
    expect(formatIcsUtc('2026-07-22T14:59:00.000Z')).toBe('20260722T145900Z')
  })
})

describe('foldIcsLine', () => {
  it('75オクテット以下の行はそのまま', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short')
  })

  it('長い行はCRLF+スペースで折り返し、各行が75オクテット以下になる', () => {
    const folded = foldIcsLine(`SUMMARY:${'x'.repeat(200)}`)
    const lines = folded.split('\r\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
    expect(lines.slice(1).every((l) => l.startsWith(' '))).toBe(true)
    // 折り返しを除去すると元に戻る
    expect(folded.replaceAll('\r\n ', '')).toBe(`SUMMARY:${'x'.repeat(200)}`)
  })

  it('マルチバイト文字の途中で切らない', () => {
    const folded = foldIcsLine(`SUMMARY:${'課題'.repeat(60)}`)
    const restored = folded.replaceAll('\r\n ', '')
    expect(restored).toBe(`SUMMARY:${'課題'.repeat(60)}`)
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
      // 各行が正しいUTF-8文字列として往復できる（サロゲート断片が無い）
      expect(line).toBe(new TextDecoder().decode(new TextEncoder().encode(line)))
    }
  })
})

describe('buildCalendarIcs', () => {
  it('締切あり課題だけをVEVENT化し、必須プロパティを含む', () => {
    const ics = buildCalendarIcs([scanned(), manual(), scanned({ id: 'nd', deadline: null })], NOW)

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('VERSION:2.0')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('UID:ltw-scan-a1@lms.waiteu.dev')
    expect(ics).toContain('UID:ltw-manual-m1@lms.waiteu.dev')
    expect(ics).toContain('DTSTART:20260722T145900Z')
    expect(ics).toContain('DTSTAMP:20260723T120000Z')
    expect(ics).toContain('SUMMARY:レポート1')
    expect(ics).toContain('URL:https://letus.ed.tus.ac.jp/mod/assign/view.php?id=123')
  })

  it('コース名をDESCRIPTIONに入れ、URLなしの手動課題はURL行を出さない', () => {
    const ics = buildCalendarIcs([manual()], NOW)
    expect(ics).toContain('DESCRIPTION:電気数学')
    expect(ics).not.toContain('URL:')
  })

  it('タイトル中の特殊文字はエスケープされる', () => {
    const ics = buildCalendarIcs([scanned({ title: 'A,B;C' })], NOW)
    expect(ics).toContain('SUMMARY:A\\,B\\;C')
  })

  it('全行が75オクテット以下でCRLF区切り', () => {
    const ics = buildCalendarIcs(
      [scanned({ title: '長いタイトル'.repeat(30), courseName: '長いコース名'.repeat(20) })],
      NOW,
    )
    expect(ics.includes('\n') && !ics.includes('\r\n')).toBe(false)
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
  })

  it('通知(VALARM)は含めない', () => {
    const ics = buildCalendarIcs([scanned()], NOW)
    expect(ics).not.toContain('VALARM')
  })
})

describe('icsFileName', () => {
  it('ローカル日付入りのファイル名を返す', () => {
    // NOW = UTC 12:00 = JST 21:00 同日
    expect(icsFileName(NOW)).toBe('ltw-assignments-20260723.ics')
  })
})
