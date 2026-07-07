import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readState, writeState } from './state.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('無いファイルは既定を返す', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'st-')), 'state.json')
  assert.deepEqual(readState(p), { lastSha: null, lastRunAt: null })
})

test('書いて読むと往復する', () => {
  const dir = mkdtempSync(join(tmpdir(), 'st-'))
  const p = join(dir, 'state.json')
  writeState(p, { lastSha: 'abc', lastRunAt: '2026-07-08T00:00:00Z' })
  assert.deepEqual(readState(p), { lastSha: 'abc', lastRunAt: '2026-07-08T00:00:00Z' })
  rmSync(dir, { recursive: true, force: true })
})

test('壊れたJSONは既定を返す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'st-'))
  const p = join(dir, 'state.json')
  writeFileSync(p, '{bad')
  assert.deepEqual(readState(p), { lastSha: null, lastRunAt: null })
  rmSync(dir, { recursive: true, force: true })
})
