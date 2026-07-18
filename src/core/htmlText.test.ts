import { describe, it, expect } from 'vitest'
import { htmlToPlainText } from './htmlText'
import { extractDeadlineText, parseDeadline } from '../background/deadlineParser'

// background/index.ts から抽出した htmlToPlainText の「現挙動」を固定する特性テスト。
// 挙動仕様ではなく実装の観測結果を記録する（抽出前後で1文字も変えない保証）。
describe('htmlToPlainText（現挙動の特性）', () => {
  it('タグを除去し、連続空白・改行・タブを単一スペースへ正規化してtrimする', () => {
    expect(htmlToPlainText('  <div>\n  Hello \t <span>world</span>  </div>  ')).toBe(
      'Hello world',
    )
  })

  it('ブロック終了タグ(</p></div></li></tr>)は語を連結させず区切りになる', () => {
    expect(htmlToPlainText('<p>期限</p><p>7月25日</p>')).toBe('期限 7月25日')
    expect(htmlToPlainText('<ul><li>項目A</li><li>項目B</li></ul>')).toBe('項目A 項目B')
  })

  it('<br>の変種(<br> <br/> <br />・大文字)はすべて区切りになる', () => {
    expect(htmlToPlainText('A<br>B<br/>C<br />D<BR>E')).toBe('A B C D E')
  })

  it('table行はth/tdセルがスペース1個で隣接し、行間も区切られる', () => {
    const html =
      '<table class="generaltable"><tbody>' +
      '<tr><th class="cell c0">提出ステータス</th><td class="cell c1">未提出</td></tr>' +
      '<tr><th class="cell c0">評定ステータス</th><td class="cell c1">未評定</td></tr>' +
      '</tbody></table>'
    expect(htmlToPlainText(html)).toBe('提出ステータス 未提出 評定ステータス 未評定')
  })

  it('script/styleは中身ごと除去される', () => {
    const html =
      '<p>前</p><script>const s = "<td>非表示</td>";</script><style>.x{color:red}</style>後'
    expect(htmlToPlainText(html)).toBe('前 後')
  })

  it('エンティティ復号はタグ除去の後＝&lt;b&gt;はリテラル文字として残る', () => {
    expect(htmlToPlainText('2 &lt; 3 &amp;&amp; A &gt; B')).toBe('2 < 3 && A > B')
    expect(htmlToPlainText('&lt;b&gt;太字&lt;/b&gt;')).toBe('<b>太字</b>')
  })

  it('&quot;と&#39;を復号する', () => {
    expect(htmlToPlainText('&quot;引用&quot; It&#39;s')).toBe('"引用" It\'s')
  })

  it('&nbsp;は空白正規化の後に復号されるため、連続するとスペースが複数残る', () => {
    // 実装順序(normalize→decode)に由来する既知の癖。抽出で変えないことを固定する。
    expect(htmlToPlainText('A&nbsp;&nbsp;B')).toBe('A  B')
  })

  it('対応表にないエンティティはそのまま残る', () => {
    expect(htmlToPlainText('残り&hellip;')).toBe('残り&hellip;')
  })

  it('空文字は空文字のまま', () => {
    expect(htmlToPlainText('')).toBe('')
  })
})

// これまで deadlineParser.test.ts は平坦化済み文字列を直接投入しており、
// 実スキャンが通る flatten 経路（生HTML→htmlToPlainText→抽出→パース）は未検証だった。
// mod/assign 風の現実的なHTML断片で経路全体を固定する（spec§6 前提リファクタ）。
describe('統合: htmlToPlainText → extractDeadlineText → parseDeadline（mod/assign風）', () => {
  const jst = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : null

  const ASSIGN_VIEW_FRAGMENT = `
<div role="main"><span id="maincontent"></span>
  <div class="activity-header" data-for="page-activity-header">
    <h2>第10回 レポート課題</h2>
    <div data-region="activity-dates" class="activity-dates">
      <div><strong>開始日時:</strong> 2026年 7月 11日(土曜日) 00:00</div>
      <div><strong>終了日時:</strong> 2026年 7月 25日(土曜日) 23:59</div>
    </div>
  </div>
  <div class="submissionstatustable">
    <h3>提出ステータス</h3>
    <table class="generaltable table-bordered">
      <tbody>
        <tr>
          <th class="cell c0" scope="row">提出ステータス</th>
          <td class="cell c1 lastcol">未提出</td>
        </tr>
        <tr>
          <th class="cell c0" scope="row">評定ステータス</th>
          <td class="cell c1 lastcol">未評定</td>
        </tr>
        <tr>
          <th class="cell c0" scope="row">残り時間</th>
          <td class="cell c1 lastcol">7 日</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>`

  it('平坦化テキストにラベルと値が期待どおり隣接して現れる', () => {
    const plainText = htmlToPlainText(ASSIGN_VIEW_FRAGMENT)
    expect(plainText).toContain('終了日時: 2026年 7月 25日(土曜日) 23:59')
    expect(plainText).toContain('提出ステータス 未提出')
    expect(plainText).toContain('評定ステータス 未評定')
  })

  it('flatten経路から正しい締切ISO(2026-07-25 23:59 JST)が得られる', () => {
    const plainText = htmlToPlainText(ASSIGN_VIEW_FRAGMENT)
    const deadlineText = extractDeadlineText(plainText)
    const iso = parseDeadline(deadlineText)
    expect(iso).not.toBe(null)
    expect(jst(iso)).toBe('2026/7/25 23:59:00')
    // 開始日時(7/11)ではなく終了日時(7/25)を選んでいること
    expect(deadlineText.startsWith('終了日時:')).toBe(true)
  })
})
