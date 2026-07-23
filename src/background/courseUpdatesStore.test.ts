import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getCourseSignature, saveCourseSignature,
  getUnreadUpdates, addUnreadUpdates, markUpdateRead, clearCourseUpdates,
} from './courseUpdatesStore'

const store: Record<string, unknown> = {}
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys]
        const out: Record<string, unknown> = {}
        for (const k of arr) if (k in store) out[k] = store[k]
        return Promise.resolve(out)
      },
      set: (obj: Record<string, unknown>) => { Object.assign(store, obj); return Promise.resolve() },
      remove: (key: string) => { delete store[key]; return Promise.resolve() },
    },
  },
})
beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

const u = (url: string): { url: string; title: string; detectedAt: string } => ({ url, title: url, detectedAt: '2026-07-07T00:00:00Z' })

describe('courseUpdatesStore', () => {
  it('シグネチャを保存・取得（未保存はnull）', async () => {
    expect(await getCourseSignature('c1')).toBeNull()
    await saveCourseSignature('c1', [{ title: 'a', url: 'u1' }])
    expect((await getCourseSignature('c1'))?.[0].url).toBe('u1')
  })
  it('未読を重複を避けて追記できる', async () => {
    await addUnreadUpdates('c1', [u('u1'), u('u2')])
    await addUnreadUpdates('c1', [u('u2'), u('u3')])
    expect((await getUnreadUpdates('c1')).map((x) => x.url)).toEqual(['u1', 'u2', 'u3'])
  })
  it('項目単位で既読化、コース単位でクリアできる', async () => {
    await addUnreadUpdates('c1', [u('u1'), u('u2')])
    await markUpdateRead('c1', 'u1')
    expect((await getUnreadUpdates('c1')).map((x) => x.url)).toEqual(['u2'])
    await clearCourseUpdates('c1')
    expect(await getUnreadUpdates('c1')).toEqual([])
  })
})
