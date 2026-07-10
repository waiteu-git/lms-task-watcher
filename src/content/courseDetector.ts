import type { Course } from '../core/types'
import { initManualTaskWidget } from './manualTaskWidget'

console.log('[LETUS Task Watcher] content script loaded')

// isConsented のロジックをインライン化している。
// ../legal/termsConsent を import すると、background からも import されている関係で
// Rollup が共有チャンクへ切り出し、出力に import 文が残って classic content script が
// SyntaxError で壊れる（実測済み。ビルド時のガードプラグインが検出して失敗する）。
// ロジック自体は src/legal/termsConsent.ts / termsVersion.ts と同じ内容を保つこと。
// TERMS_VERSION は vite.config.ts の define で src/legal/termsVersion.ts から
// ビルド時に注入される（__TERMS_VERSION__）。ここに数値リテラルを書き戻さないこと。
const TERMS_CONSENT_KEY = 'termsConsent'

function hasValidConsent(stored: unknown, version: number): boolean {
  if (typeof stored !== 'object' || stored === null) return false
  if (Array.isArray(stored)) return false
  if (!Object.hasOwn(stored, 'version')) return false
  if (!Object.hasOwn(stored, 'acceptedAt')) return false
  const c = stored as { version?: unknown; acceptedAt?: unknown }
  if (typeof c.version !== 'number') return false
  if (typeof c.acceptedAt !== 'string' || c.acceptedAt === '') return false
  return c.version === version
}

async function isConsented(): Promise<boolean> {
  try {
    const result = (await chrome.storage.local.get(TERMS_CONSENT_KEY)) as { termsConsent?: unknown }
    return hasValidConsent(result.termsConsent, __TERMS_VERSION__)
  } catch (err) {
    console.warn('[LETUS Task Watcher] failed to read consent:', err)
    return false
  }
}

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

    // ページ内アンカー（例: 「メインコンテンツへスキップする」等のアクセシビリティ用リンク）は
    // 現在のコースページ自身を指すフラグメント付きURLになりがちで、DOM順で先に見つかると
    // 本来のコース名を上書きしてしまうため除外する
    if (href.includes('#')) continue

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

  if (courses.length > 0) {
    console.log(`[LETUS Task Watcher] detected ${courses.length} courses`)

    chrome.runtime.sendMessage({ type: 'UPSERT_COURSES', courses }, (response: unknown) => {
      if (chrome.runtime.lastError) {
        console.warn('[LETUS Task Watcher] failed to send courses:', chrome.runtime.lastError.message)
        return
      }
      console.log('[LETUS Task Watcher] courses upserted:', response)
      // ストレージ書き込み完了後に再試行（初回訪問時の競合対策）
      void initManualTaskWidget()
    })
  }

  void initManualTaskWidget()
}

// 規約未同意のあいだは、コース検出も DOM 注入も行わない。
void isConsented()
  .then((consented) => {
    if (!consented) {
      console.log('[LETUS Task Watcher] terms not accepted; content script is inactive')
      return
    }
    run()
  })
  .catch((err) => {
    console.warn('[LETUS Task Watcher] consent check failed; content script is inactive:', err)
  })
