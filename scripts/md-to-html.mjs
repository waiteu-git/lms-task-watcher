// terms-ja.md が使う記法だけを HTML に変換する軽量変換器（外部パッケージ非依存）。
// 対象: # / ## / ### 見出し、- リスト、N. 番号リスト、**bold**、`code`、段落。
// これらは docs/legal/terms-ja.md の実測記法。他の記法は非対象（YAGNI）。

export function escapeHtml(s) {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// エスケープ済みテキストにインライン記法を適用する。
// code と bold を1本の正規表現（交代）で左から順に走査し、どちらか一致した方だけを置換する。
// マッチした範囲は消費済みとして読み進むため、コード片内部にある ** は
// bold パターン側の走査対象にならず bold 化されない。
export function renderInline(escaped) {
  return escaped.replace(/`([^`]+)`|\*\*(.+?)\*\*/g, (whole, code, bold) => {
    if (code !== undefined) return `<code>${code}</code>`
    return `<strong>${bold}</strong>`
  })
}

function inline(text) {
  return renderInline(escapeHtml(text))
}

// markdown を <main> の中身となる HTML 断片へ変換する。
export function mdToHtml(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let cur = []
  for (const line of lines) {
    if (line.trim() === '') {
      if (cur.length) { blocks.push(cur); cur = [] }
    } else {
      cur.push(line)
    }
  }
  if (cur.length) blocks.push(cur)

  const html = []
  for (const block of blocks) {
    const first = block[0]
    const h = /^(#{1,3}) (.*)$/.exec(first)
    if (h) {
      const level = h[1].length
      html.push(`<h${level}>${inline(h[2])}</h${level}>`)
      continue
    }
    if (block.every((l) => /^- /.test(l))) {
      const items = block.map((l) => `<li>${inline(l.slice(2))}</li>`)
      html.push(`<ul>\n${items.join('\n')}\n</ul>`)
      continue
    }
    if (block.every((l) => /^\d+\. /.test(l))) {
      const items = block.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`)
      html.push(`<ol>\n${items.join('\n')}\n</ol>`)
      continue
    }
    html.push(`<p>${inline(block.join(' '))}</p>`)
  }
  return html.join('\n')
}
