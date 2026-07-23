// LTW 公開4ページ（index / terms / privacy / transparency）のフッターは
// ビルド無し静的配信のため逐語複製されている（共通化不可＝2026-07-23 ユーザー承認済み）。
// 1箇所だけ編集して他とズレても気づけないので、4ページのフッターブロックを md5 照合する。
//
// 判定式（人間が手で叩けるもの・このスクリプトはこれを純Nodeで忠実に再現する）:
//   awk '/<footer/,/<\/footer>/' F | sed 's/^[[:space:]]*//' | md5sum
// 対象ファイルは LF のため footerHash の full md5 は bash md5sum と一致する。
//
// 実行: node scripts/check-footer-consistency.mjs  （pnpm では check:footers）
// テスト: node --test scripts/check-footer-consistency.test.mjs
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

// awk '/<footer/,/<\/footer>/' 相当。<footer を含む最初の行から </footer> を含む行まで（両端含む）。
export function extractFooterBlock(html) {
  const lines = html.split(/\r?\n/)
  const start = lines.findIndex((l) => l.includes('<footer'))
  if (start === -1) throw new Error('footer ブロックが見つかりません（<footer が無い）')
  const rel = lines.slice(start).findIndex((l) => l.includes('</footer>'))
  if (rel === -1) throw new Error('footer ブロックが閉じていません（</footer> が無い）')
  return lines.slice(start, start + rel + 1).join('\n')
}

// awk 抽出 → sed 's/^[[:space:]]*//'（各行の先頭空白除去）→ 末尾 \n 付与 → md5。
export function footerHash(html) {
  const stripped = extractFooterBlock(html)
    .split('\n')
    .map((l) => l.replace(/^\s+/, ''))
    .join('\n')
  return createHash('md5').update(stripped + '\n').digest('hex')
}

// entries: [{ path, html }] を照合。全一致なら ok=true。不一致なら多数派から外れたパスを outliers に。
export function checkFooters(entries) {
  const results = entries.map((e) => ({ path: e.path, hash: footerHash(e.html) }))
  const counts = new Map()
  for (const r of results) counts.set(r.hash, (counts.get(r.hash) ?? 0) + 1)
  const majorityHash = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const outliers = results.filter((r) => r.hash !== majorityHash).map((r) => r.path)
  return { ok: counts.size === 1, majorityHash, results, outliers }
}

const short = (h) => h.slice(0, 16)

// 直接実行された時だけ照合する（import しただけでは走らせない）。gen-terms.mjs と同じガード。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const FILES = [
    'landing/index.html',
    'landing/terms.html',
    'landing/privacy.html',
    'landing/transparency.html',
  ]
  const entries = FILES.map((path) => ({ path, html: readFileSync(join(root, path), 'utf8') }))
  const { ok, majorityHash, results, outliers } = checkFooters(entries)

  for (const r of results) {
    const mark = r.hash === majorityHash ? ' ' : '✗'
    console.log(`  ${mark} ${short(r.hash)}  ${r.path}`)
  }

  if (ok) {
    console.log(`✓ フッター4ページ一致 (md5 ${short(majorityHash)})`)
    process.exit(0)
  }
  console.error(
    `✗ フッターがズレています。多数派 md5 ${short(majorityHash)} から外れたファイル:\n` +
      outliers.map((p) => `    - ${p}`).join('\n') +
      `\n  landing の実体を直したら scripts/gen-terms.mjs のテンプレートも直して pnpm gen:terms を実行すること。`,
  )
  process.exit(1)
}
