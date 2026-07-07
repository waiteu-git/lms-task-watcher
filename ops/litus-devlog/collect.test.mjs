import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGitLog } from './collect.mjs'

const US = '\x1f'
const RS = '\x1e'

test('parseGitLog: 複数コミットを構造化する', () => {
  const raw =
    ['abc123', '2026-07-08T10:00:00+09:00', 'feat: A', 'body A'].join(US) + RS +
    ['def456', '2026-07-07T09:00:00+09:00', 'fix: B', ''].join(US) + RS
  const out = parseGitLog(raw)
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], { sha: 'abc123', date: '2026-07-08T10:00:00+09:00', subject: 'feat: A', body: 'body A' })
  assert.equal(out[1].subject, 'fix: B')
  assert.equal(out[1].body, '')
})

test('parseGitLog: 空入力は空配列', () => {
  assert.deepEqual(parseGitLog(''), [])
  assert.deepEqual(parseGitLog('   \n  '), [])
})
