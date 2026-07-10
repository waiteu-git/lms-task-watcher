// docs/legal/terms-ja.md を単一正典として、拡張内の TERMS_BODY と
// 公開ページ landing/terms.html を生成する。生成物は手編集しないこと。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'docs/legal/terms-ja.md')

const GENERATED_HEADER = '// 自動生成ファイル。編集しないこと。`pnpm gen:terms` で再生成する。\n'

function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderTermsBodyTs(markdown) {
  return `${GENERATED_HEADER}\nexport const TERMS_BODY = ${JSON.stringify(markdown)}\n`
}

export function renderTermsHtml(markdown) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>利用規約 — LETUS Task Watcher</title>
<style>
body { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; line-height: 1.8;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; color: #1a1a1a; }
pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 15px; }
</style>
</head>
<body>
<!-- 自動生成ファイル。編集しないこと。pnpm gen:terms で再生成する。 -->
<pre>${escapeHtml(markdown)}</pre>
</body>
</html>
`
}

const markdown = readFileSync(SOURCE, 'utf8')
writeFileSync(join(root, 'src/legal/termsBody.ts'), renderTermsBodyTs(markdown))
writeFileSync(join(root, 'landing/terms.html'), renderTermsHtml(markdown))
console.log('generated: src/legal/termsBody.ts, landing/terms.html')
