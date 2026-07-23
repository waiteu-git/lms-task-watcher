// scripts/check-footer-consistency.mjs のユニットテスト。
// ops/litus-devlog/*.test.mjs と同じ node:test 形式（vitest は src/ 限定で collect しない）。
// 実行: node --test scripts/check-footer-consistency.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractFooterBlock, footerHash, checkFooters } from './check-footer-consistency.mjs'

// ラベル部分だけ差し替え可能なフッター入りHTMLを組み立てる。
function page(label) {
  return [
    '<!DOCTYPE html>',
    '<body>',
    '  <main><p>本文なので抽出対象外</p></main>',
    '  <footer style="background:#0f172a;padding:32px;">',
    '    <nav aria-label="フッター" style="display:flex;">',
    `      <a href="/">${label}</a>`,
    '      <a href="/terms">利用規約</a>',
    '    </nav>',
    '    <p>© 2026 waiteu. 東京理科大学非公式の学生個人プロジェクトです。</p>',
    '  </footer>',
    '</body>',
  ].join('\n')
}

test('extractFooterBlock: <footer>…</footer> の範囲だけを行単位で抜く', () => {
  const block = extractFooterBlock(page('トップページ'))
  const lines = block.split('\n')
  assert.match(lines[0], /<footer/)
  assert.match(lines[lines.length - 1], /<\/footer>/)
  // 範囲外の本文やbodyは含めない
  assert.ok(!block.includes('抽出対象外'), 'footer より前の本文を含んではいけない')
  assert.ok(!block.includes('<body>'), 'body 行を含んではいけない')
  // 範囲内は含む
  assert.ok(block.includes('aria-label="フッター"'))
})

test('extractFooterBlock: footer が無ければ例外', () => {
  assert.throws(() => extractFooterBlock('<body><p>no footer</p></body>'), /footer/i)
})

test('footerHash: 先頭空白の差は無視して同じ内容なら同一ハッシュ', () => {
  // sed 's/^[[:space:]]*//' 相当＝インデント違いは同一視される
  const a = '  <footer>\n    <a>x</a>\n  </footer>'
  const b = '<footer>\n<a>x</a>\n</footer>'
  assert.equal(footerHash(a), footerHash(b))
})

test('footerHash: フッター本文が違えば別ハッシュ', () => {
  assert.notEqual(footerHash(page('トップページ')), footerHash(page('別ラベル')))
})

test('checkFooters: 4ページ同一なら ok=true・外れ無し', () => {
  const entries = [
    { path: 'index.html', html: page('トップページ') },
    { path: 'terms.html', html: page('トップページ') },
    { path: 'privacy.html', html: page('トップページ') },
    { path: 'transparency.html', html: page('トップページ') },
  ]
  const r = checkFooters(entries)
  assert.equal(r.ok, true)
  assert.equal(r.outliers.length, 0)
  assert.equal(r.results.length, 4)
  assert.equal(new Set(r.results.map((x) => x.hash)).size, 1)
})

test('checkFooters: 1ページだけズレたら ok=false・そのファイルを名指し', () => {
  const entries = [
    { path: 'index.html', html: page('トップページ') },
    { path: 'terms.html', html: page('トップページ') },
    { path: 'privacy.html', html: page('トップページ') },
    { path: 'transparency.html', html: page('ズレた') }, // 1箇所だけ編集し忘れ相当
  ]
  const r = checkFooters(entries)
  assert.equal(r.ok, false)
  assert.deepEqual(r.outliers, ['transparency.html'])
})
