// docs/legal/terms-ja.md を単一正典として、拡張内の TERMS_BODY と
// 公開ページ landing/terms.html を生成する。生成物は手編集しないこと。
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
<link rel="canonical" href="https://lms.waiteu.dev/terms">
<style>
body { margin: 0; line-height: 1.8;
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; color: #1a1a1a; }
main { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
pre { white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 15px; }
</style>
</head>
<body>
<!-- 自動生成ファイル。編集しないこと。pnpm gen:terms で再生成する。 -->
<main><pre>${escapeHtml(markdown)}</pre></main>
  <footer style="background:#0f172a;color:rgba(255,255,255,0.55);padding:32px 24px;text-align:center;">
    <nav aria-label="フッター" style="display:flex;justify-content:center;gap:22px;margin-bottom:14px;flex-wrap:wrap;">
      <a href="/" style="color:rgba(255,255,255,0.75);font-size:13.5px;font-weight:700;text-decoration:none;">トップページ</a>
      <a href="/terms" style="color:rgba(255,255,255,0.75);font-size:13.5px;font-weight:700;text-decoration:none;">利用規約</a>
      <a href="/privacy" style="color:rgba(255,255,255,0.75);font-size:13.5px;font-weight:700;text-decoration:none;">プライバシーポリシー</a>
      <a href="/transparency" style="color:rgba(255,255,255,0.75);font-size:13.5px;font-weight:700;text-decoration:none;">透明性レポート</a>
      <a href="https://chromewebstore.google.com/detail/letus-task-watcher/eofgkmpiadoeckkliialkddacidcinml" target="_blank" rel="noopener" style="color:rgba(255,255,255,0.75);font-size:13.5px;font-weight:700;text-decoration:none;">Chrome Web Store</a>
      <a href="https://microsoftedge.microsoft.com/addons/detail/femdjgdgelnbdpgnfehacobmpbfmbdoa" target="_blank" rel="noopener" style="color:rgba(255,255,255,0.75);font-size:13.5px;font-weight:700;text-decoration:none;">Edge Add-ons</a>
      <a href="https://litus.waiteu.dev/" target="_blank" rel="noopener" style="color:rgba(255,255,255,0.75);font-size:13.5px;font-weight:700;text-decoration:none;">リタス（スマホアプリ）</a>
      <a href="https://waiteu.dev/" target="_blank" rel="noopener" style="color:rgba(255,255,255,0.75);font-size:13.5px;font-weight:700;text-decoration:none;">開発者サイト</a>
    </nav>
    <p style="font-size:12.5px;font-weight:600;">© 2026 waiteu. 東京理科大学非公式の学生個人プロジェクトです。</p>
  </footer>
</body>
</html>
`
}

// 直接実行された時だけ生成する。import しただけで生成物を書き換えないようにするため。
// （このガードが無かったため、2026-07-19 に手で足した canonical が import 時の再生成で消えた）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const markdown = readFileSync(SOURCE, 'utf8')
  writeFileSync(join(root, 'src/legal/termsBody.ts'), renderTermsBodyTs(markdown))
  writeFileSync(join(root, 'landing/terms.html'), renderTermsHtml(markdown))
  console.log('generated: src/legal/termsBody.ts, landing/terms.html')
}
