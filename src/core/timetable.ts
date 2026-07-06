import { parse, type HTMLElement } from 'node-html-parser'

export type TimetableClass = {
  courseCode: string
  name: string
  teachers: string[]
  room: string
  isRemote: boolean
  credits: number | null
  badges: string[]
}
export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
export type TimetableSlot = { day: DayOfWeek; period: number; classes: TimetableClass[] }
export type PeriodTime = { period: number; start: string; end: string }
export type CampusPeriodTimes = { campus: string; periods: PeriodTime[] }

export function parseClassCell(cellHtml: string): TimetableClass | null {
  const root = parse(cellHtml)
  const cell = root.querySelector('.jugyo-info') ?? root
  if (cell.classList.contains('noClass')) return null

  const nameEl = cell.querySelector('.fontB')
  if (!nameEl) return null
  const name = nameEl.text.trim()
  if (!name) return null

  const codeMatch = cell.text.match(/\d{7}/)
  const courseCode = codeMatch ? codeMatch[0] : ''

  const roomEl = cell.querySelector('span')
  const room = roomEl ? roomEl.text.trim() : ''
  const isRemote = room.includes('遠隔')

  const taniEl = cell.querySelector('.taniSu')
  let credits: number | null = null
  if (taniEl) {
    const m = taniEl.text.match(/([\d.]+)\s*単位/)
    if (m) credits = Number(m[1])
  }

  const badges = cell
    .querySelectorAll('.signClass')
    .map((b: HTMLElement) => b.text.trim())
    .filter((t: string) => t.length > 0)

  const teachers = extractTeachers(cell, name, courseCode)

  return { courseCode, name, teachers, room, isRemote, credits, badges }
}

function extractTeachers(cell: HTMLElement, name: string, courseCode: string): string[] {
  const divs = cell.querySelectorAll('div')
  for (const d of divs) {
    if (d.classList.contains('fontB')) continue
    if (d.classList.contains('taniSu')) continue
    if (d.classList.contains('sign')) continue
    if (d.querySelector('span')) continue
    if (d.querySelector('button')) continue
    if (d.querySelector('div')) continue
    const t = d.text.trim()
    if (!t) continue
    if (t === name) continue
    if (t === courseCode) continue
    if (/^\d{7}$/.test(t)) continue
    if (/単位/.test(t)) continue
    if (t.includes('ui-button')) continue
    return t.split('／').map((x) => x.trim()).filter((x) => x.length > 0)
  }
  return []
}

export function parsePeriodTimes(jigenText: string): CampusPeriodTimes | null {
  const text = jigenText.trim()
  if (!text) return null

  const campusMatch = text.match(/^([^（(]+)[（(]/)
  const campus = campusMatch ? campusMatch[1].trim() : ''

  const periods: PeriodTime[] = []
  const re = /(\d+)\s*限\s*(\d{1,2}:\d{2})\s*[～~]\s*(\d{1,2}:\d{2})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    periods.push({ period: Number(m[1]), start: normalizeTime(m[2]), end: normalizeTime(m[3]) })
  }

  if (periods.length === 0) return null
  return { campus, periods }
}

function normalizeTime(t: string): string {
  const [h, min] = t.split(':')
  return `${h.padStart(2, '0')}:${min}`
}

const DAY_ORDER: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function parseTimetable(tableHtml: string): TimetableSlot[] {
  const root = parse(tableHtml)
  const table = root.querySelector('table.classTable') ?? root.querySelector('table')
  if (!table) return []

  const slots: TimetableSlot[] = []
  for (const row of table.querySelectorAll('tr')) {
    if (row.querySelector('th.headerYobi')) continue

    const jigenCell = row.querySelector('td.colJigen')
    const periodText = jigenCell ? jigenCell.text.trim() : ''
    const period = Number(periodText)
    if (!periodText || Number.isNaN(period)) continue

    row.querySelectorAll('td.colYobi').forEach((cell: HTMLElement, index: number) => {
      const day = DAY_ORDER[index]
      if (!day) return
      const classes = cell
        .querySelectorAll('.jugyo-info')
        .map((el: HTMLElement) => parseClassCell(el.outerHTML))
        .filter((c): c is NonNullable<typeof c> => c !== null)
      if (classes.length > 0) slots.push({ day, period, classes })
    })
  }

  return slots
}
