import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { escapeHtml, renderInline, mdToHtml } from './md-to-html.mjs'

test('escapeHtml は HTML 特殊文字を実体参照にする', () => {
  assert.equal(escapeHtml(`<a b="c" d='e'>&`), '&lt;a b=&quot;c&quot; d=&#39;e&#39;&gt;&amp;')
})

test('renderInline: コードと強調', () => {
  assert.equal(renderInline('a `x` b'), 'a <code>x</code> b')
  assert.equal(renderInline('a **x** b'), 'a <strong>x</strong> b')
})

test('renderInline: コード片が先に確定し内部の ** は bold 化しない', () => {
  assert.equal(renderInline('`a**b**c`'), '<code>a**b**c</code>')
})

test('h1/h2/h3 見出し', () => {
  assert.equal(mdToHtml('# 見出し1'), '<h1>見出し1</h1>')
  assert.equal(mdToHtml('## 見出し2'), '<h2>見出し2</h2>')
  assert.equal(mdToHtml('### 見出し3'), '<h3>見出し3</h3>')
})

test('- リストは ul/li になる', () => {
  assert.equal(mdToHtml('- 一\n- 二'), '<ul>\n<li>一</li>\n<li>二</li>\n</ul>')
})

test('番号リストは ol/li になりマーカー数字は落ちる', () => {
  assert.equal(mdToHtml('1. 一\n2. 二'), '<ol>\n<li>一</li>\n<li>二</li>\n</ol>')
})

test('段落は p になる', () => {
  assert.equal(mdToHtml('ふつうの文。'), '<p>ふつうの文。</p>')
})

test('見出し・リスト内でインライン記法が効く', () => {
  assert.equal(mdToHtml('## **強**と`コード`'), '<h2><strong>強</strong>と<code>コード</code></h2>')
  assert.equal(mdToHtml('- **強**な`x`'), '<ul>\n<li><strong>強</strong>な<code>x</code></li>\n</ul>')
})

test('テキスト・コード内の HTML 特殊文字がエスケープされる', () => {
  assert.equal(mdToHtml('a<b>c & d'), '<p>a&lt;b&gt;c &amp; d</p>')
  assert.equal(mdToHtml('`<x>`'), '<p><code>&lt;x&gt;</code></p>')
})

test('空行でブロックが分かれる', () => {
  assert.equal(mdToHtml('# 題\n\n本文。'), '<h1>題</h1>\n<p>本文。</p>')
})

test('統合スメル: 実正典 terms-ja.md を変換すると生記法が残らず整形される', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const md = readFileSync(join(root, 'docs/legal/terms-ja.md'), 'utf8')
  const html = mdToHtml(md)
  // 生記法が本文テキストとして残っていない（<pre> 退行の検出）
  assert.ok(!/^#{1,3} /m.test(html), '生の見出しマーカーが残っている')
  assert.ok(!html.includes('**'), '生の ** が残っている')
  assert.ok(!html.includes('`'), '生のバッククォートが残っている')
  // 期待する要素が生成されている
  for (const tag of ['<h1>', '<h2>', '<ul>', '<ol>', '<strong>', '<code>']) {
    assert.ok(html.includes(tag), `${tag} が生成されていない`)
  }
})
