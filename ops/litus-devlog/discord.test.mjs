import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDiscordPayload } from './discord.mjs'

test('短文はそのまま1チャンク', () => {
  assert.deepEqual(buildDiscordPayload('hello'), ['hello'])
})

test('空文字は空配列', () => {
  assert.deepEqual(buildDiscordPayload(''), [])
})

test('maxLen超は改行優先で複数チャンクに分割し、各チャンクは上限以下', () => {
  const line = 'x'.repeat(50)
  const text = Array.from({ length: 10 }, () => line).join('\n') // 10行×50字＋改行
  const chunks = buildDiscordPayload(text, 120)
  assert.ok(chunks.length > 1)
  for (const c of chunks) assert.ok(c.length <= 120, `chunk too long: ${c.length}`)
  // 分割しても全行が保持される
  assert.equal(chunks.join('\n').replace(/\n+/g, '\n'), text)
})

test('1行が上限を超える場合はハード分割する', () => {
  const chunks = buildDiscordPayload('y'.repeat(250), 100)
  assert.ok(chunks.every((c) => c.length <= 100))
  assert.equal(chunks.join(''), 'y'.repeat(250))
})
