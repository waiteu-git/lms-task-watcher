import { collect } from './collect.mjs'
import { postToDiscord } from './discord.mjs'
import { readState, writeState } from './state.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const STATE = fileURLToPath(new URL('./state.json', import.meta.url))
const REPO = process.env.LITUS_REPO || '/Users/waiteu/dev/litus'

export function loadDelta() {
  const { lastSha } = readState(STATE)
  return collect({ repo: REPO, lastSha })
}

async function main() {
  const mode = process.argv[2]
  if (mode === '--delta') {
    process.stdout.write(JSON.stringify(loadDelta(), null, 2) + '\n')
    return
  }
  if (mode === '--post') {
    const file = process.argv[3]
    const newestSha = process.argv[4]
    const url = process.env.DISCORD_DEVLOG_WEBHOOK
    if (!url) throw new Error('DISCORD_DEVLOG_WEBHOOK 未設定')
    if (!file || !newestSha) throw new Error('usage: run.mjs --post <file> <newestSha>')
    await postToDiscord(url, readFileSync(file, 'utf8'))
    writeState(STATE, { lastSha: newestSha, lastRunAt: new Date().toISOString() })
    console.log('posted & state advanced to', newestSha)
    return
  }
  throw new Error('usage: run.mjs --delta | --post <file> <newestSha>')
}
main().catch((e) => { console.error(e.message); process.exit(1) })
