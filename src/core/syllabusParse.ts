import { parse, type HTMLElement } from 'node-html-parser'

export type SyllabusSection = { label: string; value: string }
export type SyllabusDoc = {
  code: string
  titleJa: string
  titleEn: string
  sections: SyllabusSection[]
}

// ひらがな・カタカナ・漢字・全角記号（全角括弧等）の範囲。
const JP_RANGE = '　-〿぀-ヿ一-鿿＀-￯'
const LABEL_JP_RE = new RegExp(`^.*[${JP_RANGE}]`)
// ノーブレークスペース(U+00A0)・ゼロ幅スペース(U+200B)を通常空白/除去に正規化。
const NBSP_RE = / /g
const ZWSP_RE = /​/g

/** 日英併記ラベルから日本語部分（末尾の日本語文字まで）を取り出す。日本語が無ければ原文。 */
export function japaneseLabel(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  const m = t.match(LABEL_JP_RE)
  return m ? m[0].trim() : t
}

function valueCells(row: HTMLElement): HTMLElement[] {
  return row.querySelectorAll('.colStyle').filter((c: HTMLElement) => !c.classList.contains('colHeader'))
}

/** 値セル群のテキスト。<br>は改行に、各行はトリムして空行を除き、複数セルは改行連結。 */
function cellsText(cells: HTMLElement[]): string {
  const parts: string[] = []
  for (const cell of cells) {
    const withBreaks = cell.innerHTML.replace(/<br\s*\/?>/gi, '\n')
    const text = parse(`<x>${withBreaks}</x>`).text.replace(NBSP_RE, ' ').replace(ZWSP_RE, '')
    const lines = text.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)
    if (lines.length > 0) parts.push(lines.join('\n'))
  }
  return parts.join('\n')
}

export function parseSyllabus(html: string): SyllabusDoc {
  const root = parse(html)
  const rows = root.querySelectorAll('.rowStyle')

  const sections: SyllabusSection[] = []
  for (const row of rows) {
    const header = row.querySelector('.colHeader')
    if (!header) continue
    const label = japaneseLabel(header.text)
    const value = cellsText(valueCells(row))
    if (!label && !value) continue
    sections.push({ label, value })
  }

  const firstValue = (jpPrefix: string): string => {
    for (const row of rows) {
      const header = row.querySelector('.colHeader')
      if (!header) continue
      if (header.text.replace(/\s+/g, ' ').trim().startsWith(jpPrefix)) {
        return valueCells(row)[0]?.text.replace(/\s+/g, ' ').trim() ?? ''
      }
    }
    return ''
  }

  return {
    code: firstValue('授業コード'),
    titleJa: firstValue('科目授業名称（和文）'),
    titleEn: firstValue('科目授業名称（英文）'),
    sections,
  }
}
