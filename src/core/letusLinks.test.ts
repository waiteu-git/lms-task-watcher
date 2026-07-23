import { describe, it, expect } from 'vitest'
import { extractLinksFromHtml } from './letusLinks'

const BASE = 'https://letus.ed.tus.ac.jp/course/view.php?id=5'

describe('extractLinksFromHtml', () => {
  it('相対URLを絶対化しフラグメントを除去、タイトルを復号する', () => {
    const html = '<a href="/mod/assign/view.php?id=101#top">レポート&amp;課題</a>'
    expect(extractLinksFromHtml(html, BASE)).toEqual([
      { title: 'レポート&課題', url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=101' },
    ])
  })
  it('タイトル空のアンカーは除外する', () => {
    const html = '<a href="/mod/assign/view.php?id=1"></a>'
    expect(extractLinksFromHtml(html, BASE)).toEqual([])
  })
  it('取得元と異なるホストのリンクは除外する（認証付きfetchの外部流出防止）', () => {
    const html =
      '<a href="https://evil.example.com/steal">外部</a>' +
      '<a href="/mod/assign/view.php?id=2">課題</a>' +
      '<a href="//attacker.test/x">プロトコル相対</a>'
    expect(extractLinksFromHtml(html, BASE)).toEqual([
      { title: '課題', url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=2' },
    ])
  })
})
