// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://letus.ed.tus.ac.jp/course/view.php?id=1" }
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Assignment } from '../core/types'

const ASSIGNMENT_URL = 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=123'

function assignment(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a', courseId: 'c1', courseName: '電気数学', title: 'レポート1', url: ASSIGNMENT_URL,
    deadline: '2026-07-12T14:00:00.000Z', deadlineText: '', deadlineSource: null, sourceText: '',
    submissionStatus: 'not_submitted', lifecycleStatus: 'active',
    detectedAt: '', firstSeenAt: '', lastSeenAt: '', lastCheckedAt: '',
    ...over,
  }
}

/** chrome.storage.local のスタブ。onChanged は手動で発火させる。 */
function installChromeStub(initial: Record<string, unknown>) {
  const store: Record<string, unknown> = { ...initial }
  const listeners: Array<(changes: Record<string, unknown>) => void> = []

  const chromeStub = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items)
        }),
        onChanged: { addListener: (fn: (c: Record<string, unknown>) => void) => listeners.push(fn) },
      },
    },
    runtime: { sendMessage: vi.fn() },
  }
  vi.stubGlobal('chrome', chromeStub)

  return {
    /** バックグラウンドのスキャンがストレージを書き換えた状況を再現する。 */
    async write(items: Record<string, unknown>) {
      Object.assign(store, items)
      const changes = Object.fromEntries(Object.keys(items).map((k) => [k, { newValue: items[k] }]))
      for (const fn of listeners) fn(changes)
      // repaint() のストレージ読み出し（Promise.all）が解決するまで待つ
      await new Promise((r) => setTimeout(r, 0))
      await new Promise((r) => setTimeout(r, 0))
    },
  }
}

/** バッジは closed shadow root に入るため、attachShadow の戻り値を捕まえて覗く。 */
function captureShadowRoots(): ShadowRoot[] {
  const roots: ShadowRoot[] = []
  const original = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    const root = original.call(this, init)
    roots.push(root)
    return root
  }
  return roots
}

function badgeText(roots: ShadowRoot[]): string {
  const badges = roots.flatMap((r) => Array.from(r.querySelectorAll('.badge')))
  expect(badges).toHaveLength(1)
  return badges[0].textContent ?? ''
}

describe('LETUSページのバッジ', () => {
  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = `<ul><li><a href="${ASSIGNMENT_URL}">レポート1</a></li></ul>`
  })

  it('提出済みになったら、ページを開いたままでもバッジが更新される', async () => {
    const roots = captureShadowRoots()
    const chrome = installChromeStub({
      courses: [{ id: 'c1', name: '9973337 電気数学', url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1', enabled: true, lmsType: 'letus', createdAt: '', updatedAt: '' }],
      assignments: [assignment()],
      manualAssignments: [],
    })

    const { initManualTaskWidget } = await import('./manualTaskWidget')
    await initManualTaskWidget()

    expect(badgeText(roots)).toContain('！')
    expect(badgeText(roots)).not.toContain('✓')

    // バックグラウンドのスキャンが提出済みへ更新
    await chrome.write({ assignments: [assignment({ submissionStatus: 'submitted' })] })

    expect(badgeText(roots)).toContain('✓')
  })

  it('未追加リンクは storage 更新後も「+」のまま', async () => {
    const roots = captureShadowRoots()
    const chrome = installChromeStub({
      courses: [{ id: 'c1', name: '9973337 電気数学', url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1', enabled: true, lmsType: 'letus', createdAt: '', updatedAt: '' }],
      assignments: [],
      manualAssignments: [],
    })

    const { initManualTaskWidget } = await import('./manualTaskWidget')
    await initManualTaskWidget()
    expect(badgeText(roots)).toBe('+')

    await chrome.write({ assignments: [] })
    expect(badgeText(roots)).toBe('+')
  })

  it('手動課題バッジは ✎ を表示し、クリックで編集フォームが開いて更新できる', async () => {
    const roots = captureShadowRoots()
    installChromeStub({
      courses: [{ id: 'c1', name: '9973337 電気数学', url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1', enabled: true, lmsType: 'letus', createdAt: '', updatedAt: '' }],
      assignments: [],
      manualAssignments: [{
        id: 'm1', courseId: 'c1', courseName: '9973337 電気数学', title: '手動レポート',
        letusUrl: ASSIGNMENT_URL, deadline: '2026-07-20T14:00:00.000Z', memo: '', submitted: false,
        createdAt: '2026-07-10T00:00:00.000Z',
      }],
    })

    const { initManualTaskWidget } = await import('./manualTaskWidget')
    await initManualTaskWidget()

    // バッジに鉛筆マーク
    expect(badgeText(roots)).toContain('✎')

    // バッジをクリック → 編集フォームが開く（handler が async のため flush する）
    const badge = roots.flatMap((r) => Array.from(r.querySelectorAll('.badge')))[0] as HTMLElement
    badge.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const titleInput = roots
      .map((r) => r.getElementById('me-title') as HTMLInputElement | null)
      .find(Boolean) as HTMLInputElement
    expect(titleInput.value).toBe('手動レポート')

    // 課題名を変更して「更新」
    titleInput.value = '手動レポート（改）'
    const updateBtn = roots
      .flatMap((r) => Array.from(r.querySelectorAll('.update')))
      .find(Boolean) as HTMLButtonElement
    updateBtn.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const { manualAssignments } = (await globalThis.chrome.storage.local.get(
      'manualAssignments',
    )) as { manualAssignments: Array<{ id: string; title: string }> }
    expect(manualAssignments.find((x) => x.id === 'm1')?.title).toBe('手動レポート（改）')
  })

  it('編集フォームを開いたまま外部で提出済みに変わっても、チェックを触らず保存すれば上書きしない', async () => {
    const roots = captureShadowRoots()
    const manual = {
      id: 'm1', courseId: 'c1', courseName: '9973337 電気数学', title: '手動レポート',
      letusUrl: ASSIGNMENT_URL, deadline: '2026-07-20T14:00:00.000Z', memo: '', submitted: false,
      createdAt: '2026-07-10T00:00:00.000Z',
    }
    const chrome = installChromeStub({
      courses: [{ id: 'c1', name: '9973337 電気数学', url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1', enabled: true, lmsType: 'letus', createdAt: '', updatedAt: '' }],
      assignments: [],
      manualAssignments: [manual],
    })

    const { initManualTaskWidget } = await import('./manualTaskWidget')
    await initManualTaskWidget()

    // バッジをクリック → 編集フォームが開く（この時点の submitted: false をフォームが記憶する）
    const badge = roots.flatMap((r) => Array.from(r.querySelectorAll('.badge')))[0] as HTMLElement
    badge.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const titleInput = roots
      .map((r) => r.getElementById('me-title') as HTMLInputElement | null)
      .find(Boolean) as HTMLInputElement
    expect(titleInput.value).toBe('手動レポート')

    // フォームを開いたまま、外部（別画面）が提出済みへ変更
    await chrome.write({ manualAssignments: [{ ...manual, submitted: true }] })

    // 提出チェックボックスには触れず、課題名だけ変更して更新
    titleInput.value = '手動レポート（改）'
    const updateBtn = roots
      .flatMap((r) => Array.from(r.querySelectorAll('.update')))
      .find(Boolean) as HTMLButtonElement
    updateBtn.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const { manualAssignments } = (await globalThis.chrome.storage.local.get(
      'manualAssignments',
    )) as { manualAssignments: Array<{ id: string; title: string; submitted: boolean }> }
    const updated = manualAssignments.find((x) => x.id === 'm1')
    expect(updated?.title).toBe('手動レポート（改）')
    expect(updated?.submitted).toBe(true)
  })
})
