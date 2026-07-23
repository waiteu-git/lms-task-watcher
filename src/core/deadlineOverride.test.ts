import { describe, it, expect, vi } from 'vitest'
import { applyDeadlineOverrides } from './deadlineOverride'
import type { Assignment } from './types'

function a(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 'a1',
    courseId: 'c1',
    courseName: '講義',
    title: '課題',
    url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1',
    deadline: null,
    deadlineText: '',
    deadlineSource: null,
    sourceText: '',
    submissionStatus: 'not_submitted',
    lifecycleStatus: 'open',
    detectedAt: '',
    firstSeenAt: '',
    lastSeenAt: '',
    lastCheckedAt: '',
    ...over,
  } as Assignment
}

describe('applyDeadlineOverrides', () => {
  it('override があれば deadline を差し替え deadlineSource を user にする', () => {
    const out = applyDeadlineOverrides([a()], {
      'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1': '2026-07-22T14:00:00.000Z',
    })
    expect(out[0].deadline).toBe('2026-07-22T14:00:00.000Z')
    expect(out[0].deadlineSource).toBe('user')
  })

  it('URL のフラグメント差は無視して一致（正規化）', () => {
    const out = applyDeadlineOverrides(
      [a({ url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1#section' })],
      { 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1': '2026-07-22T14:00:00.000Z' },
    )
    expect(out[0].deadline).toBe('2026-07-22T14:00:00.000Z')
  })

  it('override が無ければ不変（パース済み締切を保持）', () => {
    const src = [a({ deadline: '2026-07-01T00:00:00.000Z', deadlineSource: 'field' })]
    const out = applyDeadlineOverrides(src, {})
    expect(out[0].deadline).toBe('2026-07-01T00:00:00.000Z')
    expect(out[0].deadlineSource).toBe('field')
  })

  it('空マップは同一配列参照を返す（コスト回避）', () => {
    const src = [a()]
    expect(applyDeadlineOverrides(src, {})).toBe(src)
  })
})

describe('setDeadlineOverride', () => {
  it('URLを正規化したキーで既存のオーバーライドへ追記保存する', async () => {
    const store: Record<string, unknown> = {
      deadlineOverrides: { 'https://letus.ed.tus.ac.jp/mod/quiz/view.php?id=9': '2026-07-01T00:00:00.000Z' },
    }
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items)
          }),
        },
      },
    })

    const { setDeadlineOverride } = await import('./deadlineOverride')
    await setDeadlineOverride(
      'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1#section',
      '2026-07-30T14:59:00.000Z',
    )

    expect(store.deadlineOverrides).toEqual({
      'https://letus.ed.tus.ac.jp/mod/quiz/view.php?id=9': '2026-07-01T00:00:00.000Z',
      'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=1': '2026-07-30T14:59:00.000Z',
    })

    vi.unstubAllGlobals()
  })
})
