import { describe, it, expect } from 'vitest'
import {
  computeCourseSignature,
  diffCourseSignature,
  computeCourseUpdate,
  hasCourseMarker,
} from './courseUpdates'

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

describe('hasCourseMarker', () => {
  it('format-* bodyクラスで true（コースフォーマットのマーカー）', () => {
    expect(hasCourseMarker('<body class="format-topics course-5">x</body>')).toBe(true)
    expect(hasCourseMarker('<body class="limitedwidth format-weeks">x</body>')).toBe(true)
  })
  it('path-course-view / pagelayout-course でも true', () => {
    expect(hasCourseMarker('<body class="path-course-view">x</body>')).toBe(true)
    expect(hasCourseMarker("<body class='pagelayout-course'>x</body>")).toBe(true)
  })
  it('コースマーカーの無いbodyクラスは false（ログインページ等）', () => {
    expect(hasCourseMarker('<body class="pagelayout-login path-login">x</body>')).toBe(false)
  })
  it('body自体が無いHTML（メンテページ断片等）は false', () => {
    expect(hasCourseMarker('<div>no body</div>')).toBe(false)
  })
  it('前方部分一致の誤認をしない（reformat- は format-* ではない）', () => {
    expect(hasCourseMarker('<body class="reformat-topics">x</body>')).toBe(false)
  })
})

describe('computeCourseUpdate の診断入力（spec§4 skipSave明示化）', () => {
  it('skip発生時は skipped:true と実測カウントを返す（保存スキップ=last-good保持は維持）', () => {
    const prev = computeCourseSignature(html2([1, 2]), BASE)
    const r = computeCourseUpdate(
      prev,
      '<body class="format-topics">課題リンクの無いコース応答</body>',
      BASE,
      '2026-07-07T00:00:00Z',
    )
    expect(r.skipSave).toBe(true)
    expect(r.diagnostic).toEqual({
      modAnchorCount: 0,
      prevSignatureLen: 2,
      hasCourseMarker: true,
      skipped: true,
    })
  })
  it('初回スキャン（prev=null）は prevSignatureLen:null・skipped:false', () => {
    const r = computeCourseUpdate(null, html2([1]), BASE, '2026-07-07T00:00:00Z')
    expect(r.diagnostic).toEqual({
      modAnchorCount: 1,
      prevSignatureLen: null,
      hasCourseMarker: false,
      skipped: false,
    })
  })
  it('通常更新は今回の実測アンカー数と前回件数を返し skipped:false', () => {
    const prev = computeCourseSignature(html2([1, 2]), BASE)
    const r = computeCourseUpdate(prev, html2([1, 2, 3]), BASE, '2026-07-07T00:00:00Z')
    expect(r.diagnostic).toEqual({
      modAnchorCount: 3,
      prevSignatureLen: 2,
      hasCourseMarker: false,
      skipped: false,
    })
  })
  it('既知の空コース（prev=0件）が空のままなら skipped:false（正当な空・保存も行う）', () => {
    const r = computeCourseUpdate([], '<html><body class="format-topics"></body></html>', BASE, '2026-07-07T00:00:00Z')
    expect(r.skipSave).toBe(false)
    expect(r.diagnostic).toEqual({
      modAnchorCount: 0,
      prevSignatureLen: 0,
      hasCourseMarker: true,
      skipped: false,
    })
  })
})
