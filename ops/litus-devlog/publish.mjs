import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { writeState } from './state.mjs'
import { postToDiscord } from './discord.mjs'

const MARKER = '<!-- 新しいエントリはこの下'

// 純粋関数：updates.html のマーカー直後に entry ブロックを挿入する（新着が上＝日付降順）。
export function insertEntry(html, entryBlock) {
  const mi = html.indexOf(MARKER)
  if (mi === -1) throw new Error('updates.html: エントリ挿入マーカーが見つからない')
  const nl = html.indexOf('\n', mi)
  const at = nl === -1 ? html.length : nl + 1
  const indented = entryBlock.trim().split('\n').map((l) => (l.length ? '  ' + l : l)).join('\n')
  return html.slice(0, at) + indented + '\n\n' + html.slice(at)
}

// --- CLI（副作用：ファイル書換・git commit/push・Discord通知。テスト対象外） ---
const HERE = (p) => fileURLToPath(new URL(p, import.meta.url))
const REPO_ROOT = HERE('../../')
const UPDATES = HERE('../../landing/updates.html')
const STATE = HERE('./state.json')
const PENDING_ENTRY = HERE('./.pending-entry.html')
const PENDING_SHA = HERE('./.pending-sha')

function git(args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' })
}

async function main() {
  // 引数省略時はルーティンが残した保留中ファイルを使う
  const entryFile = process.argv[2] || (existsSync(PENDING_ENTRY) ? PENDING_ENTRY : null)
  const newestSha = process.argv[3] || (existsSync(PENDING_SHA) ? readFileSync(PENDING_SHA, 'utf8').trim() : null)
  if (!entryFile) throw new Error('usage: publish.mjs <entry.html> <newestSha>（または保留中の .pending-entry.html / .pending-sha）')
  if (!newestSha) throw new Error('newestSha が無い（引数か .pending-sha が必要）')

  const entry = readFileSync(entryFile, 'utf8')
  if (!entry.trim()) throw new Error('エントリ本文が空')

  // develop 以外での誤爆を防ぐ
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  if (branch !== 'develop') throw new Error(`develop ブランチで実行すること（現在: ${branch}）`)

  // 1) updates.html へ挿入（新着が上）
  const html = readFileSync(UPDATES, 'utf8')
  writeFileSync(UPDATES, insertEntry(html, entry))

  // 2) state を newestSha まで前進（次回ルーティンの差分起点）
  writeState(STATE, { lastSha: newestSha, lastRunAt: new Date().toISOString() })

  // 3) 対象2ファイルのみ commit → push（Cloudflare Pages が updates.html を自動デプロイ）
  const shortSha = newestSha.slice(0, 7)
  git(['add', 'landing/updates.html', 'ops/litus-devlog/state.json'])
  git(['commit', '-m', `feat(devlog): publish entry & advance state to ${shortSha}`])
  git(['push', 'origin', 'develop'])

  // 4) 任意：Discord 管理ch へ公開通知（webhook 未設定なら黙ってスキップ）
  const url = process.env.DISCORD_DEVLOG_WEBHOOK
  if (url) {
    try {
      await postToDiscord(url, `✅ devlog 公開しました（updates.html → Cloudflare 自動デプロイ）。state を ${shortSha} まで前進。`)
    } catch (e) {
      console.error('Discord 通知は失敗（公開自体は成功済み）:', e.message)
    }
  }

  // 5) 保留中ファイルを掃除
  for (const f of [PENDING_ENTRY, PENDING_SHA]) if (existsSync(f)) rmSync(f)

  console.log(`published & pushed. state→${shortSha}`)
}

if (process.argv[1]?.endsWith('publish.mjs')) {
  main().catch((e) => { console.error(e.message); process.exit(1) })
}
