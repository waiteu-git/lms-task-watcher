import { parseSyllabus, type SyllabusDoc } from './syllabusParse'
import { buildSyllabusUrlByYear } from './syllabus'

export type SyllabusCache = { doc: SyllabusDoc; fetchedAt: string }

const syllabusKey = (year: number, code: string) => `syllabus:${year}:${code}`

export async function getCachedSyllabus(year: number, code: string): Promise<SyllabusCache | null> {
  const key = syllabusKey(year, code)
  const res = (await chrome.storage.local.get(key)) as Record<string, SyllabusCache | undefined>
  return res[key] ?? null
}

export async function fetchAndCacheSyllabus(year: number, code: string): Promise<SyllabusCache> {
  const res = await fetch(buildSyllabusUrlByYear(code, year))
  if (!res.ok) throw new Error(`syllabus fetch failed: ${res.status}`)
  const html = await res.text()
  const cache: SyllabusCache = { doc: parseSyllabus(html), fetchedAt: new Date().toISOString() }
  await chrome.storage.local.set({ [syllabusKey(year, code)]: cache })
  return cache
}
