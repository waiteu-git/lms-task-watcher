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
})
