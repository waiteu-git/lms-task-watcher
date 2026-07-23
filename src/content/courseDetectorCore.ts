import type { Course } from '../core/types'

/**
 * courseDetector（LETUS content script）の純ロジック層（spec§6 T4）。
 *
 * content script 制約（最重要）:
 * - このモジュールを import してよいのは content エントリ（src/content/courseDetector.ts）
 *   と vitest だけ。background/popup から import すると Rollup が共有チャンクへ切り出し、
 *   dist/content.js に import 文が残って classic script が SyntaxError で全機能死する
 *   （vite.config.ts の assert プラグインがビルド時に検出して失敗する）。
 * - 逆方向も同じ理由で、src/core/ 等 background/popup と共有される実行時モジュールを
 *   ここから import しない。型のみの import type はビルドで消えるため可。
 *
 * 切り出しの目的: 従来 courseDetector.ts に同居していた検出ロジックを chrome.* 非依存の
 * 純関数＋DOM関数に分離し、jsdom（@vitest-environment jsdom）で直接テスト可能にする。
 * courseDetector.ts は同意ゲートと sendMessage の配線だけを持つ。
 */

/** コース検出リトライの debounce（DOM変化が落ち着いてから再スキャンするまでの猶予） */
export const COURSE_WATCH_DEBOUNCE_MS = 300

/** コース検出リトライの総予算。経過したら必ず MutationObserver を disconnect する */
export const COURSE_WATCH_BUDGET_MS = 3000

/** コース面（Dashboard/マイコース一覧）のパスか。0コース能動報告はこの面に限定する */
export function isDashboardPath(pathname: string): boolean {
  return (
    pathname === '/my' ||
    pathname === '/my/' ||
    pathname === '/my/index.php' ||
    pathname === '/my/courses.php'
  )
}

export function createCourseId(url: string): string {
  return btoa(unescape(encodeURIComponent(url)))
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

export function normalizeText(text: string | null | undefined): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ')
}

export function isCourseUrl(url: string): boolean {
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

/**
 * 視覚的に隠されたアクセシビリティ用テキストのセレクタ。
 * BS4世代（現行4.5.8）は .sr-only / Moodle独自 .accesshide、
 * BS5世代（5.0〜5.3）は .visually-hidden。両世代に同時対応する。
 */
const HIDDEN_TEXT_SELECTOR = '.visually-hidden, .accesshide, .sr-only'

/**
 * リンク内のタイトルノード候補。Moodle のコースカード（block_myoverview）は
 * アンカー内に視覚隠しプレフィックス（「コース名」等）とタイトル span を同居させるため、
 * これらがあればリンク全文でなくタイトルノードを優先して読む。
 */
const TITLE_NODE_SELECTOR = '.coursename, .multiline'

/**
 * コースリンクから表示名を抽出する。
 * 1. リンク内にタイトルノード（.coursename / .multiline・視覚隠しでないもの）があれば優先。
 * 2. 抽出元の複製から視覚隠し子要素（.visually-hidden / .accesshide / .sr-only）を
 *    除去してから textContent を読む（「コース名」プレフィックスや進捗%の読み上げ文が
 *    表示名に混入するのを防ぐ）。複製に対して行うため実DOMは変更しない。
 */
export function extractCourseName(link: HTMLAnchorElement): string {
  const titleNode =
    Array.from(link.querySelectorAll(TITLE_NODE_SELECTOR)).find(
      (node) => !node.matches(HIDDEN_TEXT_SELECTOR),
    ) ?? null
  const source = (titleNode ?? link).cloneNode(true) as Element
  for (const hidden of Array.from(source.querySelectorAll(HIDDEN_TEXT_SELECTOR))) {
    hidden.remove()
  }
  return normalizeText(source.textContent)
}

/**
 * ドキュメント内の全アンカーから LETUS コースを検出する（単発スキャン・純DOM関数）。
 * URL方式（/course/view.php?id=）にのみ依存し、CSSクラスには依存しない（spec§3原則1）。
 */
export function detectCourses(doc: Document): Course[] {
  const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))
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
      url = new URL(href, doc.baseURI).toString().split('#')[0]
    } catch {
      continue
    }

    if (!isCourseUrl(url)) continue

    const name = extractCourseName(link)
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

export interface CourseWatchHandlers {
  /** コースが見つかった（初回スキャン即時 or 遅延ハイドレーション捕捉）。高々1回だけ呼ばれる */
  onCoursesFound: (courses: Course[]) => void
  /** 予算切れまで0件のままだった。高々1回だけ呼ばれる（onCoursesFound と排他） */
  onEmpty: () => void
}

export interface CourseWatchOptions {
  debounceMs?: number
  budgetMs?: number
}

/**
 * ハイドレーション耐性つきコース検出（spec§6 T4）。
 *
 * 既存の単発スキャン挙動は不変: 初回スキャンでコース>0なら即 onCoursesFound を呼び、
 * MutationObserver は一切使わない。0件のときだけ有界の MutationObserver で DOM 追加を監視し、
 * debounce（既定300ms）付きで再スキャンする。BS5世代 Dashboard（block_myoverview）は
 * コースカードを非同期XHRで描画するため、document_idle 時点の単発スキャンでは
 * 0件になりうる（Mount Orange 5.2 実測: 生HTMLにコースアンカー0件）。
 *
 * 有界性の保証:
 * - コースを見つけたら即 disconnect。
 * - 総予算（既定3000ms）経過で必ず disconnect。切る直前に最後の1回だけ再スキャンし
 *   （debounce 待ちのまま予算が尽きた挿入の取りこぼし防止）、それでも0件なら onEmpty。
 *
 * @returns dispose 関数。呼ぶと監視を即時停止し、以後どのハンドラも呼ばれない。
 */
export function watchCoursesWithRetry(
  doc: Document,
  handlers: CourseWatchHandlers,
  options: CourseWatchOptions = {},
): () => void {
  const debounceMs = options.debounceMs ?? COURSE_WATCH_DEBOUNCE_MS
  const budgetMs = options.budgetMs ?? COURSE_WATCH_BUDGET_MS

  const initial = detectCourses(doc)
  if (initial.length > 0) {
    handlers.onCoursesFound(initial)
    return () => {}
  }

  let done = false
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const dispose = (): void => {
    if (done) return
    done = true
    observer.disconnect()
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    clearTimeout(budgetTimer)
  }

  const rescan = (): void => {
    if (done) return
    const courses = detectCourses(doc)
    if (courses.length === 0) return
    dispose()
    handlers.onCoursesFound(courses)
  }

  const observer = new MutationObserver(() => {
    if (done) return
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(rescan, debounceMs)
  })

  const budgetTimer = setTimeout(() => {
    if (done) return
    const courses = detectCourses(doc)
    dispose()
    if (courses.length > 0) {
      handlers.onCoursesFound(courses)
    } else {
      handlers.onEmpty()
    }
  }, budgetMs)

  observer.observe(doc.documentElement ?? doc, { childList: true, subtree: true })
  return dispose
}
