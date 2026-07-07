import { readFileSync } from 'node:fs'

export function buildDiscordPayload(text, maxLen = 1900) {
  if (!text) return []
  const chunks = []
  let cur = ''
  const pushCur = () => { if (cur.length) { chunks.push(cur); cur = '' } }
  for (const rawLine of text.split('\n')) {
    // 1行が上限超ならハード分割
    let line = rawLine
    while (line.length > maxLen) {
      pushCur()
      chunks.push(line.slice(0, maxLen))
      line = line.slice(maxLen)
    }
    const candidate = cur.length ? cur + '\n' + line : line
    if (candidate.length > maxLen) {
      pushCur()
      cur = line
    } else {
      cur = candidate
    }
  }
  pushCur()
  return chunks
}

export async function postToDiscord(webhookUrl, text) {
  const chunks = buildDiscordPayload(text)
  for (const content of chunks) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error(`Discord投稿失敗: ${res.status} ${await res.text()}`)
  }
  return chunks.length
}

if (process.argv[1]?.endsWith('discord.mjs')) {
  const file = process.argv[2]
  const url = process.env.DISCORD_DEVLOG_WEBHOOK
  if (!url) { console.error('DISCORD_DEVLOG_WEBHOOK 未設定'); process.exit(1) }
  if (!file) { console.error('usage: node discord.mjs <messageFile>'); process.exit(1) }
  const text = readFileSync(file, 'utf8')
  postToDiscord(url, text).then((n) => console.log(`posted ${n} chunk(s)`)).catch((e) => { console.error(e.message); process.exit(1) })
}
