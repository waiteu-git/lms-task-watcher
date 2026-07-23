import type { Course } from '../core/types'
import { initManualTaskWidget } from './manualTaskWidget'
import { isDashboardPath, watchCoursesWithRetry } from './courseDetectorCore'

console.log('[LETUS Task Watcher] content script loaded')

// isConsented のロジックをインライン化している。
// ../legal/termsConsent を import すると、background からも import されている関係で
// Rollup が共有チャンクへ切り出し、出力に import 文が残って classic content script が
// SyntaxError で壊れる（実測済み。ビルド時のガードプラグインが検出して失敗する）。
// ロジック自体は src/legal/termsConsent.ts / termsVersion.ts と同じ内容を保つこと。
// TERMS_VERSION は vite.config.ts の define で src/legal/termsVersion.ts から
// ビルド時に注入される（__TERMS_VERSION__）。ここに数値リテラルを書き戻さないこと。
// ※検出ロジック本体は courseDetectorCore.ts（content 専用モジュール＝Rollup が
//   content.js へインライン化する）に分離済み。core側は background から import 禁止。
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

function sendDetectedCourses(courses: Course[]): void {
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

/**
 * 0コース能動報告（spec§6 T4）: コース面（Dashboard/マイコース一覧）で予算切れまで
 * コースが1件も見つからなかった場合だけ、背景の自己診断集約へ報告する。
 * コース面以外の0件は正常（課題ページ等）なのでノイズ防止のため送らない。
 * この関数は同意済みの run() 経由でしか呼ばれない（未同意で送信しない）。
 */
function reportEmptyCourseFace(): void {
  if (!isDashboardPath(location.pathname)) return

  console.log('[LETUS Task Watcher] no courses found on course-listing page; reporting to background')
  chrome.runtime.sendMessage({ type: 'COURSE_DETECTION_EMPTY', path: location.pathname }, () => {
    if (chrome.runtime.lastError) {
      console.warn(
        '[LETUS Task Watcher] failed to report empty detection:',
        chrome.runtime.lastError.message,
      )
    }
  })
}

function run(): void {
  // コース検出はコース面（Dashboard/マイコース一覧）でのみ行う。
  // セキュリティ: 任意ページの全アンカーを走査すると、フォーラム等のユーザー投稿に
  // 埋め込まれた悪意あるコースリンク（表示名に <img onerror> 等）を拾い、サーバ経由で
  // マイページ描画時に反射しうる（stored XSS 経路）。コース面は本人のダッシュボードのみで
  // 他人が投稿を差し込めないため、検出面を限定することで注入源を断つ。
  // 初回スキャンで見つかれば従来どおり即送信（observer 不使用）。
  // 0件のときだけ有界 MutationObserver（debounce 300ms・総予算 3000ms）で
  // 遅延ハイドレーションされたコースカードを追跡する（BS5世代 Dashboard 対策）。
  if (isDashboardPath(location.pathname)) {
    watchCoursesWithRetry(document, {
      onCoursesFound: sendDetectedCourses,
      onEmpty: reportEmptyCourseFace,
    })
  }

  // 手動タスクウィジェットはコース/課題ページでも動く必要があるため面を限定しない。
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
