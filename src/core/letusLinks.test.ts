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
})
