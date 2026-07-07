import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCachedSyllabus, fetchAndCacheSyllabus } from './syllabusStore'

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
    },
  },
})

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('syllabusStore', () => {
  it('キャッシュミス時は null', async () => {
    expect(await getCachedSyllabus(2026, '9973344')).toBeNull()
  })
  it('fetch してパース・キャッシュし、以後キャッシュから読める', async () => {
    const html =
      '<div class="rowStyle"><div class="colHeader colStyle">授業コード Class code</div><div class="colStyle">9973344</div></div>'
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(html) })))
    const c = await fetchAndCacheSyllabus(2026, '9973344')
    expect(c.doc.code).toBe('9973344')
    expect(c.fetchedAt).toMatch(/^\d{4}-/)
    expect((await getCachedSyllabus(2026, '9973344'))?.doc.code).toBe('9973344')
  })
  it('非200レスポンスは例外を投げる', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })))
    await expect(fetchAndCacheSyllabus(2026, '0000000')).rejects.toThrow()
  })
})
