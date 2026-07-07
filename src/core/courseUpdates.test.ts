import { describe, it, expect } from 'vitest'
import { computeCourseSignature, diffCourseSignature, computeCourseUpdate } from './courseUpdates'

const BASE = 'https://letus.ed.tus.ac.jp/course/view.php?id=5'
const html2 = (ids: number[]) => ids.map((i) => `<a href="/mod/assign/view.php?id=${i}">課題${i}</a>`).join('')

describe('computeCourseSignature', () => {
  it('/mod/*/view.php のみ・URL重複排除・ソートして返す', () => {
    const html = `
      <a href="/mod/assign/view.php?id=101">レポート課題1</a>
      <a href="/mod/resource/view.php?id=103">講義スライド</a>
      <a href="/course/view.php?id=5">コースホーム</a>
      <a href="/mod/assign/view.php?id=101#s2">レポート課題1(再掲)</a>
    `
    const sig = computeCourseSignature(html, BASE)
    expect(sig.map((a) => a.url)).toEqual([
      'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=101',
      'https://letus.ed.tus.ac.jp/mod/resource/view.php?id=103',
    ])
  })
})

describe('diffCourseSignature', () => {
  it('URLで追加/削除を出す', () => {
    const prev = [{ title: 'a', url: 'u1' }, { title: 'b', url: 'u2' }]
    const next = [{ title: 'b', url: 'u2' }, { title: 'c', url: 'u3' }]
    const d = diffCourseSignature(prev, next)
    expect(d.added.map((x) => x.url)).toEqual(['u3'])
    expect(d.removed.map((x) => x.url)).toEqual(['u1'])
  })
  it('変化なしなら空', () => {
    const s = [{ title: 'a', url: 'u1' }]
    expect(diffCourseSignature(s, s)).toEqual({ added: [], removed: [] })
  })
})

describe('computeCourseUpdate', () => {
  it('初回（前回null）はベースライン保存のみ・added空', () => {
    const r = computeCourseUpdate(null, html2([1, 2]), BASE, '2026-07-07T00:00:00Z')
    expect(r.added).toEqual([])
    expect(r.skipSave).toBe(false)
    expect(r.signature.map((s) => s.url)).toHaveLength(2)
  })
  it('2回目は追加分を UnreadUpdate として返す', () => {
    const prev = computeCourseSignature(html2([1, 2]), BASE)
    const r = computeCourseUpdate(prev, html2([1, 2, 3]), BASE, '2026-07-07T00:00:00Z')
    expect(r.added.map((a) => a.url)).toEqual(['https://letus.ed.tus.ac.jp/mod/assign/view.php?id=3'])
    expect(r.added[0].detectedAt).toBe('2026-07-07T00:00:00Z')
    expect(r.skipSave).toBe(false)
  })
  it('新signatureが空かつ前回非空なら skipSave（ベースライン破壊防止）', () => {
    const prev = computeCourseSignature(html2([1, 2]), BASE)
    const r = computeCourseUpdate(prev, '<html>logged out</html>', BASE, '2026-07-07T00:00:00Z')
    expect(r.skipSave).toBe(true)
    expect(r.added).toEqual([])
  })
})
