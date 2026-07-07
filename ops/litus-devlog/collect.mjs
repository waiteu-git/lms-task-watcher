import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const US = '\x1f'
const RS = '\x1e'

export function parseGitLog(raw) {
  if (!raw) return []
  return raw
    .split(RS)
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((r) => {
      const [sha, date, subject, body = ''] = r.split(US)
      return { sha, date, subject, body }
    })
}

// 副作用あり（gitを実行）。テスト対象外。
export function collect({ repo, lastSha, sinceDaysDefault = 7 }) {
  const fmt = `--format=%H${US}%cI${US}%s${US}%b${RS}`
  const range = lastSha ? [`${lastSha}..HEAD`] : [`--since=${sinceDaysDefault} days ago`]
  let raw = ''
  try {
    raw = execFileSync('git', ['-C', repo, 'log', ...range, fmt], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  } catch (e) {
    throw new Error(`git log 失敗（repo=${repo}）: ${e.message}`)
  }
  const commits = parseGitLog(raw)
  let changelogHead = ''
  try {
    changelogHead = readFileSync(`${repo}/CHANGELOG.md`, 'utf8').split('\n').slice(0, 60).join('\n')
  } catch { changelogHead = '' }
  return { count: commits.length, newestSha: commits[0]?.sha ?? lastSha ?? null, commits, changelogHead }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('collect.mjs')) {
  const repo = process.env.LITUS_REPO || 'C:/dev/litus'
  let lastSha = null
  try {
    lastSha = JSON.parse(readFileSync(new URL('./state.json', import.meta.url), 'utf8')).lastSha || null
  } catch { lastSha = null }
  const result = collect({ repo, lastSha })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}
