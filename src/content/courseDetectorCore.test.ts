// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://letus.ed.tus.ac.jp/my/" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Course } from '../core/types'
import {
  COURSE_WATCH_BUDGET_MS,
  COURSE_WATCH_DEBOUNCE_MS,
  detectCourses,
  extractCourseName,
  isDashboardPath,
  watchCoursesWithRetry,
} from './courseDetectorCore'

const COURSE_URL = 'https://letus.ed.tus.ac.jp/course/view.php?id=62'

function makeAnchor(html: string): HTMLAnchorElement {
  const container = document.createElement('div')
  container.innerHTML = html
  const link = container.querySelector('a')
  if (!link) throw new Error('test markup has no anchor')
  return link
}

function appendCourseAnchor(name = '電気数学', url = COURSE_URL): void {
  const a = document.createElement('a')
  a.href = url
  a.textContent = name
  document.body.appendChild(a)
}

/**
 * jsdom の MutationObserver 配送は microtask 経由。fake timer を進める前に
 * 数回 microtask を流して observer コールバック（= debounce タイマの登録）を確定させる。
 */
async function flushMutationDelivery(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('isDashboardPath', () => {
  it.each(['/my', '/my/', '/my/index.php', '/my/courses.php'])('コース面 %s は true', (path) => {
    expect(isDashboardPath(path)).toBe(true)
  })

  it.each(['/course/view.php', '/mod/assign/view.php', '/my/preferences.php', '/login/index.php', ''])(
    'コース面でない %s は false',
    (path) => {
      expect(isDashboardPath(path)).toBe(false)
    },
  )
})

describe('extractCourseName', () => {
  it('従来の素朴なアンカーからそのまま名前を取る', () => {
    const link = makeAnchor(`<a href="${COURSE_URL}">電気数学</a>`)
    expect(extractCourseName(link)).toBe('電気数学')
  })

  it('5.2風カード（visually-hidden プレフィックス＋multiline＋進捗%）からタイトルだけを取る', () => {
    // Mount Orange 5.2 の block_myoverview カード構造に基づく（BS5 は sr-only → visually-hidden）
    const link = makeAnchor(
      `<a href="${COURSE_URL}" class="aalink coursename">` +
        '<span class="visually-hidden">コース名</span>' +
        '<span class="multiline">Psychology in Cinema' +
        '<span class="visually-hidden">進捗: 33%</span></span>' +
        '</a>',
    )
    expect(extractCourseName(link)).toBe('Psychology in Cinema')
  })

  it('4.x風カード（accesshide / sr-only）でも視覚隠しテキストを除去する', () => {
    const link = makeAnchor(
      `<a href="${COURSE_URL}">` +
        '<span class="accesshide">コース名</span>' +
        '<span class="sr-only">33% 完了</span>' +
        '電気数学</a>',
    )
    expect(extractCourseName(link)).toBe('電気数学')
  })

  it('ネストされたタイトルノード（.coursename）を装飾テキストより優先する', () => {
    const link = makeAnchor(
      `<a href="${COURSE_URL}"><span class="badge">NEW</span><span class="coursename">量子力学</span></a>`,
    )
    expect(extractCourseName(link)).toBe('量子力学')
  })

  it('タイトルノード自体が視覚隠しの場合は無視してリンク全文から取る', () => {
    const link = makeAnchor(
      `<a href="${COURSE_URL}"><span class="coursename visually-hidden">コース名</span>統計学</a>`,
    )
    expect(extractCourseName(link)).toBe('統計学')
  })

  it('元のDOMを変更しない（複製に対して除去する）', () => {
    const link = makeAnchor(
      `<a href="${COURSE_URL}"><span class="visually-hidden">コース名</span>電気数学</a>`,
    )
    extractCourseName(link)
    expect(link.querySelector('.visually-hidden')).not.toBeNull()
  })
})

describe('detectCourses', () => {
  it('素朴なコースアンカーを検出する', () => {
    document.body.innerHTML = `<a href="${COURSE_URL}">電気数学</a>`
    const courses = detectCourses(document)
    expect(courses).toHaveLength(1)
    expect(courses[0].name).toBe('電気数学')
    expect(courses[0].url).toBe(COURSE_URL)
    expect(courses[0].enabled).toBe(false)
    expect(courses[0].lmsType).toBe('letus')
  })

  it('相対URLはドキュメントURL基準で絶対化する', () => {
    document.body.innerHTML = '<a href="/course/view.php?id=7">統計学入門</a>'
    const courses = detectCourses(document)
    expect(courses).toHaveLength(1)
    expect(courses[0].url).toBe('https://letus.ed.tus.ac.jp/course/view.php?id=7')
  })

  it('5.2風カードから正しい名前で検出する', () => {
    document.body.innerHTML =
      `<div class="card"><a href="${COURSE_URL}" class="aalink coursename">` +
      '<span class="visually-hidden">コース名</span>' +
      '<span class="multiline">Psychology in Cinema</span></a></div>'
    const courses = detectCourses(document)
    expect(courses).toHaveLength(1)
    expect(courses[0].name).toBe('Psychology in Cinema')
  })

  it('フラグメント付き・非コースURL・letus外ホストは除外する', () => {
    document.body.innerHTML =
      `<a href="${COURSE_URL}#section-1">アンカー付き</a>` +
      '<a href="https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1">課題</a>' +
      '<a href="https://example.com/course/view.php?id=1">外部</a>'
    expect(detectCourses(document)).toHaveLength(0)
  })

  it('視覚隠し除去後の名前に 2..200 文字ゲートを適用する', () => {
    document.body.innerHTML =
      `<a href="${COURSE_URL}"><span class="visually-hidden">コース名</span>あ</a>` +
      `<a href="https://letus.ed.tus.ac.jp/course/view.php?id=99">${'あ'.repeat(201)}</a>`
    expect(detectCourses(document)).toHaveLength(0)
  })

  it('同一コースの重複アンカーは最初の1件に統合する', () => {
    document.body.innerHTML =
      `<a href="${COURSE_URL}">電気数学</a><a href="${COURSE_URL}">電気数学（別リンク）</a>`
    const courses = detectCourses(document)
    expect(courses).toHaveLength(1)
    expect(courses[0].name).toBe('電気数学')
  })
})

describe('watchCoursesWithRetry', () => {
  let onCoursesFound: ReturnType<typeof vi.fn<(courses: Course[]) => void>>
  let onEmpty: ReturnType<typeof vi.fn<() => void>>

  beforeEach(() => {
    vi.useFakeTimers()
    onCoursesFound = vi.fn()
    onEmpty = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function startWatch(): () => void {
    return watchCoursesWithRetry(document, { onCoursesFound, onEmpty })
  }

  it('即時検出: 初回スキャンで見つかれば同期的に報告し、observer を使わない', async () => {
    appendCourseAnchor()
    startWatch()

    expect(onCoursesFound).toHaveBeenCalledTimes(1)
    expect(onCoursesFound.mock.calls[0][0][0].name).toBe('電気数学')

    // 以後の DOM 追加や予算経過で再報告・EMPTY 報告は起きない（監視していない）
    appendCourseAnchor('第二コース', 'https://letus.ed.tus.ac.jp/course/view.php?id=2')
    await flushMutationDelivery()
    await vi.advanceTimersByTimeAsync(COURSE_WATCH_BUDGET_MS + COURSE_WATCH_DEBOUNCE_MS)
    expect(onCoursesFound).toHaveBeenCalledTimes(1)
    expect(onEmpty).not.toHaveBeenCalled()
  })

  it('遅延挿入: 後からハイドレートされたアンカーを debounce 後に検出する', async () => {
    startWatch()
    expect(onCoursesFound).not.toHaveBeenCalled()

    // ハイドレーションのシミュレーション: 500ms 後にカードが挿入される
    setTimeout(() => appendCourseAnchor('Psychology in Cinema'), 500)
    await vi.advanceTimersByTimeAsync(500)
    await flushMutationDelivery()

    // debounce 未満では未報告 → debounce 経過で検出
    expect(onCoursesFound).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(COURSE_WATCH_DEBOUNCE_MS)
    expect(onCoursesFound).toHaveBeenCalledTimes(1)
    expect(onCoursesFound.mock.calls[0][0][0].name).toBe('Psychology in Cinema')

    // 検出後は disconnect 済み: 予算切れの EMPTY も二重報告も起きない
    await vi.advanceTimersByTimeAsync(COURSE_WATCH_BUDGET_MS)
    expect(onCoursesFound).toHaveBeenCalledTimes(1)
    expect(onEmpty).not.toHaveBeenCalled()
  })

  it('予算切れ: 0件のままなら budget 経過で onEmpty を1回だけ呼ぶ', async () => {
    startWatch()

    await vi.advanceTimersByTimeAsync(COURSE_WATCH_BUDGET_MS - 1)
    expect(onEmpty).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(onEmpty).toHaveBeenCalledTimes(1)
    expect(onCoursesFound).not.toHaveBeenCalled()

    // 予算切れ後の DOM 追加には反応しない（disconnect 済みの確認）
    appendCourseAnchor()
    await flushMutationDelivery()
    await vi.advanceTimersByTimeAsync(COURSE_WATCH_BUDGET_MS)
    expect(onCoursesFound).not.toHaveBeenCalled()
    expect(onEmpty).toHaveBeenCalledTimes(1)
  })

  it('debounce 待ちのまま予算が尽きても、最後の再スキャンで取りこぼさない', async () => {
    startWatch()

    // 予算ギリギリ（残り debounce 未満）で挿入 → debounce タイマは予算内に発火しない
    setTimeout(() => appendCourseAnchor(), COURSE_WATCH_BUDGET_MS - 100)
    await vi.advanceTimersByTimeAsync(COURSE_WATCH_BUDGET_MS - 100)
    await flushMutationDelivery()

    await vi.advanceTimersByTimeAsync(100)
    expect(onCoursesFound).toHaveBeenCalledTimes(1)
    expect(onEmpty).not.toHaveBeenCalled()
  })

  it('コース以外の DOM 変化では報告せず、監視は予算まで継続する', async () => {
    startWatch()

    document.body.appendChild(document.createElement('div'))
    await flushMutationDelivery()
    await vi.advanceTimersByTimeAsync(COURSE_WATCH_DEBOUNCE_MS)
    expect(onCoursesFound).not.toHaveBeenCalled()
    expect(onEmpty).not.toHaveBeenCalled()

    // その後のハイドレーションはまだ拾える
    appendCourseAnchor()
    await flushMutationDelivery()
    await vi.advanceTimersByTimeAsync(COURSE_WATCH_DEBOUNCE_MS)
    expect(onCoursesFound).toHaveBeenCalledTimes(1)
  })

  it('dispose を呼ぶと以後どのハンドラも呼ばれない', async () => {
    const dispose = startWatch()
    dispose()

    appendCourseAnchor()
    await flushMutationDelivery()
    await vi.advanceTimersByTimeAsync(COURSE_WATCH_BUDGET_MS + COURSE_WATCH_DEBOUNCE_MS)
    expect(onCoursesFound).not.toHaveBeenCalled()
    expect(onEmpty).not.toHaveBeenCalled()
  })
})
