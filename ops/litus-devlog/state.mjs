import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULT = { lastSha: null, lastRunAt: null }

export function readState(path) {
  try {
    const obj = JSON.parse(readFileSync(path, 'utf8'))
    return { lastSha: obj.lastSha ?? null, lastRunAt: obj.lastRunAt ?? null }
  } catch {
    return { ...DEFAULT }
  }
}

export function writeState(path, { lastSha = null, lastRunAt = null }) {
  writeFileSync(path, JSON.stringify({ lastSha, lastRunAt }, null, 2) + '\n')
}
