import { describe, it, expect } from 'vitest'
import {
  extractDocsVersionSegment,
  extractBodyClasses,
  isBs5Generation,
  fingerprintPage,
  type MoodleVersion,
} from './moodleFingerprint'

/** Moodle 4.5風（classic系body class＋docs.moodle.org/405/ja/ヘルプリンク） */
const HTML_45_CLASSIC = `<!DOCTYPE html>
<html dir="ltr" lang="ja">
<head><title>コース: プログラミング演習</title></head>
<body id="page-course-view-topics" class="format-topics path-course course-1234 pagelayout-course jsenabled lang-ja dir-ltr">
<div id="page"><div class="course-content"><ul class="topics">
<li><a href="https://letus.ed.tus.ac.jp/mod/assign/view.php?id=111">第1回課題</a></li>
</ul></div></div>
<footer><a href="https://docs.moodle.org/405/ja/course/view/topics" target="_blank">このページのヘルプ</a></footer>
</body></html>`

/** Moodle 5.1風（boost/BS5系body class＋docs.moodle.org/501/en/リンク） */
const HTML_51_BOOST = `<!DOCTYPE html>
<html dir="ltr" lang="en">
<head><title>Dashboard</title></head>
<body id="page-my-index" class="format-site path-my theme-boost pagelayout-mydashboard jsenabled limitedwidth">
<div id="page"></div>
<footer><a href="https://docs.moodle.org/501/en/Dashboard">Documentation for this page</a></footer>
</body></html>`

describe('extractDocsVersionSegment', () => {
  const cases: Array<{ name: string; html: string; expected: MoodleVersion | null }> = [
    {
      name: '405 → 4.5（3桁: 末尾2桁がminor）',
      html: HTML_45_CLASSIC,
      expected: { major: 4, minor: 5 },
    },
    {
      name: '500 → 5.0',
      html: '<a href="https://docs.moodle.org/500/ja/mod/assign/view">help</a>',
      expected: { major: 5, minor: 0 },
    },
    {
      name: '501 → 5.1',
      html: HTML_51_BOOST,
      expected: { major: 5, minor: 1 },
    },
    {
      name: '311 → 3.11（minorが2桁の3桁セグメント）',
      html: '<a href="https://docs.moodle.org/311/ja/course/view">help</a>',
      expected: { major: 3, minor: 11 },
    },
    {
      name: '1001 → 10.1（4桁: majorが2桁）',
      html: '<a href="https://docs.moodle.org/1001/en/Dashboard">help</a>',
      expected: { major: 10, minor: 1 },
    },
    {
      name: 'プロトコル相対リンク（//docs.moodle.org/405/…）も拾う',
      html: '<a href="//docs.moodle.org/405/ja/x">help</a>',
      expected: { major: 4, minor: 5 },
    },
    {
      name: 'docsリンク無し → null',
      html: '<html><body class="format-site"><p>締切: 2026年8月1日</p></body></html>',
      expected: null,
    },
    {
      name: '空文字列 → null',
      html: '',
      expected: null,
    },
    {
      name: '非数値セグメント（docs.moodle.org/dev/…）は対象外 → null',
      html: '<a href="https://docs.moodle.org/dev/Plugin_types">dev docs</a>',
      expected: null,
    },
    {
      name: '2桁セグメント（/39/=3.9旧形式）は対象外 → null（3〜4桁のみサポート）',
      html: '<a href="https://docs.moodle.org/39/ja/x">old</a>',
      expected: null,
    },
    {
      name: '5桁セグメントは版とみなさない → null',
      html: '<a href="https://docs.moodle.org/40511/ja/x">bogus</a>',
      expected: null,
    },
    {
      name: 'セグメント直後にスラッシュが無いものは対象外 → null',
      html: '<a href="https://docs.moodle.org/405">bare</a>',
      expected: null,
    },
    {
      name: '別ホスト（mydocs.moodle.org）は対象外 → null',
      html: '<a href="https://mydocs.moodle.org/405/ja/x">fake</a>',
      expected: null,
    },
    {
      name: '複数docsリンク混在は最頻値を採用（405×2 vs 501×1 → 4.5）',
      html: [
        '<a href="https://docs.moodle.org/405/ja/a">1</a>',
        '<a href="https://docs.moodle.org/501/ja/b">2</a>',
        '<a href="https://docs.moodle.org/405/ja/c">3</a>',
      ].join('\n'),
      expected: { major: 4, minor: 5 },
    },
    {
      name: '最頻値が同数なら先頭出現を優先（501が先 → 5.1）',
      html: [
        '<a href="https://docs.moodle.org/501/ja/a">1</a>',
        '<a href="https://docs.moodle.org/405/ja/b">2</a>',
      ].join('\n'),
      expected: { major: 5, minor: 1 },
    },
  ]

  it.each(cases)('$name', ({ html, expected }) => {
    expect(extractDocsVersionSegment(html)).toEqual(expected)
  })
})

describe('extractBodyClasses', () => {
  const cases: Array<{ name: string; html: string; expected: string[] }> = [
    {
      name: 'ダブルクォートのclass属性からクラス一覧を抽出',
      html: HTML_45_CLASSIC,
      expected: ['format-topics', 'path-course', 'course-1234', 'pagelayout-course', 'jsenabled', 'lang-ja', 'dir-ltr'],
    },
    {
      name: 'シングルクォートのclass属性も抽出',
      html: "<body id='page-my-index' class='format-site path-my'>x</body>",
      expected: ['format-site', 'path-my'],
    },
    {
      name: 'クォート無しのclass属性（単一クラス）も抽出',
      html: '<body class=format-site>x</body>',
      expected: ['format-site'],
    },
    {
      name: 'class属性が無いbody → []',
      html: '<body id="page-login-index"><p>ログインしてください</p></body>',
      expected: [],
    },
    {
      name: 'bodyタグ自体が無い → []（メンテページ・非HTML応答）',
      html: '{"error":"maintenance"}',
      expected: [],
    },
    {
      name: '空文字列 → []',
      html: '',
      expected: [],
    },
    {
      name: '空のclass属性 → []',
      html: '<body class="">x</body>',
      expected: [],
    },
    {
      name: 'class値内の連続空白・改行は区切りとして扱う',
      html: '<body class="format-topics\n  path-course\t jsenabled">x</body>',
      expected: ['format-topics', 'path-course', 'jsenabled'],
    },
    {
      name: '複数行にまたがるbody開始タグも読める',
      html: '<body\n  id="page-my-index"\n  class="format-site path-my"\n  data-region="page">x</body>',
      expected: ['format-site', 'path-my'],
    },
    {
      name: 'data-class等の別属性をclassと誤認しない',
      html: '<body id="p" data-class="bogus-value">x</body>',
      expected: [],
    },
    {
      name: '<body>より前のタグのclassは読まない（最初のbodyタグのみ）',
      html: '<html class="html-cls"><body class="body-cls">x</body></html>',
      expected: ['body-cls'],
    },
  ]

  it.each(cases)('$name', ({ html, expected }) => {
    expect(extractBodyClasses(html)).toEqual(expected)
  })
})

describe('isBs5Generation', () => {
  const cases: Array<{ name: string; version: MoodleVersion | null; expected: boolean }> = [
    { name: '4.5はBS4世代 → false', version: { major: 4, minor: 5 }, expected: false },
    { name: '3.11 → false', version: { major: 3, minor: 11 }, expected: false },
    { name: '5.0はBS5世代 → true', version: { major: 5, minor: 0 }, expected: true },
    { name: '5.1 → true', version: { major: 5, minor: 1 }, expected: true },
    { name: '5.3（予測されるTUS移行先LTS） → true', version: { major: 5, minor: 3 }, expected: true },
    { name: '10.0（将来のメジャー） → true', version: { major: 10, minor: 0 }, expected: true },
    { name: '版不明（null）はfalse（判定は矛盾検知＝diagnoseに委ねる）', version: null, expected: false },
  ]

  it.each(cases)('$name', ({ version, expected }) => {
    expect(isBs5Generation(version)).toBe(expected)
  })
})

describe('fingerprintPage', () => {
  it('Moodle 4.5風ページ: 版4.5＋classic系bodyクラス＋bs5=false', () => {
    const fp = fingerprintPage(HTML_45_CLASSIC)
    expect(fp.version).toEqual({ major: 4, minor: 5 })
    expect(fp.bs5).toBe(false)
    expect(fp.bodyClasses).toContain('format-topics')
    expect(fp.bodyClasses).toContain('pagelayout-course')
  })

  it('Moodle 5.1風ページ: 版5.1＋boost系bodyクラス＋bs5=true', () => {
    const fp = fingerprintPage(HTML_51_BOOST)
    expect(fp.version).toEqual({ major: 5, minor: 1 })
    expect(fp.bs5).toBe(true)
    expect(fp.bodyClasses).toContain('theme-boost')
    expect(fp.bodyClasses).toContain('limitedwidth')
  })

  it('docsリンクの無いページ: 版null・bs5=false でも bodyクラスは独立に取れる', () => {
    const fp = fingerprintPage('<body class="format-site path-my">x</body>')
    expect(fp.version).toBe(null)
    expect(fp.bs5).toBe(false)
    expect(fp.bodyClasses).toEqual(['format-site', 'path-my'])
  })

  it('bodyの無いページ: bodyClasses=[] でも 版は独立に取れる', () => {
    const fp = fingerprintPage('<a href="https://docs.moodle.org/501/ja/x">help</a>')
    expect(fp.version).toEqual({ major: 5, minor: 1 })
    expect(fp.bs5).toBe(true)
    expect(fp.bodyClasses).toEqual([])
  })

  it('空文字列: すべて空/null（例外を投げない）', () => {
    expect(fingerprintPage('')).toEqual({ version: null, bodyClasses: [], bs5: false })
  })
})
