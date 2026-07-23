import { test } from 'node:test'
import assert from 'node:assert/strict'
import { insertEntry } from './publish.mjs'

const SAMPLE = `<main>
  <h1>開発の歩み</h1>
  <!-- 新しいエントリはこの下（このコメント直後）に追加する。日付降順（新しいものが上）。 -->
  <div class="entry">
    <div class="date">2026-07-08</div>
    <h2>既存エントリ</h2>
  </div>
</main>
`

const ENTRY = `<div class="entry">
  <div class="date">2026-07-10</div>
  <h2>新エントリ</h2>
</div>`

test('insertEntry: マーカー直後に挿入される', () => {
  const out = insertEntry(SAMPLE, ENTRY)
  assert.ok(out.includes('新エントリ'))
  const markerIdx = out.indexOf('新しいエントリはこの下')
  const newIdx = out.indexOf('新エントリ')
  assert.ok(markerIdx < newIdx, 'マーカーの後に新エントリが入る')
})

test('insertEntry: 新エントリが既存より上に来る（日付降順）', () => {
  const out = insertEntry(SAMPLE, ENTRY)
  const newIdx = out.indexOf('新エントリ')
  const oldIdx = out.indexOf('既存エントリ')
  assert.ok(newIdx < oldIdx, '新が上・既存が下')
})

test('insertEntry: 既存エントリを壊さない', () => {
  const out = insertEntry(SAMPLE, ENTRY)
  assert.ok(out.includes('既存エントリ'))
  assert.ok(out.includes('2026-07-08'))
})

test('insertEntry: マーカー未検出で例外', () => {
  assert.throws(() => insertEntry('<main></main>', ENTRY), /マーカー/)
})

test('insertEntry: entryBlock の前後空白はトリムされる', () => {
  const out = insertEntry(SAMPLE, '\n\n' + ENTRY + '\n\n')
  // 新エントリと既存の間に過剰な空行が積み上がらない（3連続改行以内）
  assert.ok(!/\n\n\n\n/.test(out), '過剰な空行が生じない')
})
