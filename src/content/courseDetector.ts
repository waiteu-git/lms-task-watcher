import type { Course } from '../core/types'

console.log('[LETUS Task Watcher] content script loaded')

function createCourseId(url: string): string {
  return btoa(unescape(encodeURIComponent(url)))
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

function normalizeText(text: string | null | undefined): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ')
}

function isCourseUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.hostname === 'letus.ed.tus.ac.jp' &&
      parsed.pathname.includes('/course/view.php') &&
      parsed.searchParams.has('id')
    )
  } catch {
    return false
  }
}

function detectCourses(): Course[] {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
  const courseMap = new Map<string, Course>()
  const now = new Date().toISOString()

  for (const link of links) {
    const href = link.getAttribute('href') ?? ''

    let url: string
    try {
      url = new URL(href, location.href).toString().split('#')[0]
    } catch {
      continue
    }

    if (!isCourseUrl(url)) continue

    const name = normalizeText(link.textContent)
    if (name.length < 2 || name.length > 200) continue

    const id = createCourseId(url)

    if (!courseMap.has(id)) {
      courseMap.set(id, {
        id,
        name,
        url,
        enabled: false,
        lmsType: 'letus',
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return Array.from(courseMap.values())
}

function run(): void {
  const courses = detectCourses()

  if (courses.length === 0) return

  console.log(`[LETUS Task Watcher] detected ${courses.length} courses`)

  chrome.runtime.sendMessage({ type: 'UPSERT_COURSES', courses }, (response: unknown) => {
    if (chrome.runtime.lastError) {
      console.warn('[LETUS Task Watcher] failed to send courses:', chrome.runtime.lastError.message)
      return
    }
    console.log('[LETUS Task Watcher] courses upserted:', response)
  })
}

run()
