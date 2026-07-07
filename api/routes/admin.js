const express = require('express')
const crypto = require('crypto')
const db = require('../db/sqlite')

const router = express.Router()

function safeEqual(a, b) {
  const ab = Buffer.from(String(a), 'utf8')
  const bb = Buffer.from(String(b), 'utf8')
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

// HTTP Basic認証。パスワードは環境変数 ADMIN_PASSWORD（ユーザー名は任意）。
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD
  if (!expected) {
    return res.status(503).send('管理機能は未設定です（ADMIN_PASSWORD を設定してください）')
  }
  const header = req.headers.authorization || ''
  const [scheme, encoded] = header.split(' ')
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    const password = decoded.slice(decoded.indexOf(':') + 1)
    if (safeEqual(password, expected)) return next()
  }
  res.set('WWW-Authenticate', 'Basic realm="Litus admin", charset="UTF-8"')
  return res.status(401).send('認証が必要です')
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
}

router.get('/waitlist', requireAdmin, (_req, res) => {
  const rows = db
    .prepare('SELECT id, email, source, created_at, notified_at FROM waitlist ORDER BY id DESC')
    .all()

  const trs = rows
    .map(
      (r) =>
        `<tr><td>${r.id}</td><td>${esc(r.email)}</td><td>${esc(r.source)}</td><td>${esc(r.created_at)}</td><td>${r.notified_at ? esc(r.notified_at) : '—'}</td></tr>`
    )
    .join('')

  const emails = rows.map((r) => r.email).join('\n')

  res.set('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>リタス 事前登録一覧（${rows.length}件）</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; background: #f8fafc; margin: 0; padding: 24px; }
  h1 { font-size: 1.2rem; margin: 0 0 4px; }
  .count { color: #475569; font-size: 0.9rem; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; max-width: 920px; background: #fff; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; font-size: 0.9rem; word-break: break-all; }
  th { background: #0f9e75; color: #fff; }
  tr:nth-child(even) td { background: #f1f5f9; }
  textarea { width: 100%; max-width: 920px; height: 140px; margin-top: 20px; font-family: monospace; font-size: 0.85rem; }
  .hint { color: #64748b; font-size: 0.8rem; margin-top: 20px; }
</style>
</head>
<body>
<h1>リタス 事前登録一覧</h1>
<div class="count">${rows.length} 件</div>
<table>
<thead><tr><th>#</th><th>メール</th><th>流入元</th><th>登録日時</th><th>通知済</th></tr></thead>
<tbody>${trs || '<tr><td colspan="5">まだ登録がありません</td></tr>'}</tbody>
</table>
<p class="hint">メールアドレスのみ（改行区切り・コピー用）</p>
<textarea readonly>${esc(emails)}</textarea>
</body>
</html>`)
})

module.exports = router
