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
    html.push(...renderBlock(block))
  }
  return html.join('\n')
}

// 1ブロック（空行を挟まない行の連続）を分類して HTML 断片の配列を返す。
// 先頭行が見出しの場合、見出し行だけを消費して残りの行を独立したブロックとして
// 再分類する（再帰）。これにより「見出し直下に空行なしで本文/リストが続く」形でも
// 後続の内容を取りこぼさない。
function renderBlock(block) {
  const first = block[0]
  const h = /^(#{1,3}) (.*)$/.exec(first)
  if (h) {
    const level = h[1].length
    const heading = `<h${level}>${inline(h[2])}</h${level}>`
    const rest = block.slice(1)
    return rest.length ? [heading, ...renderBlock(rest)] : [heading]
  }
  if (block.every((l) => /^- /.test(l))) {
    const items = block.map((l) => `<li>${inline(l.slice(2))}</li>`)
    return [`<ul>\n${items.join('\n')}\n</ul>`]
  }
  if (block.every((l) => /^\d+\. /.test(l))) {
    const items = block.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`)
    return [`<ol>\n${items.join('\n')}\n</ol>`]
  }
  return [`<p>${inline(block.join(' '))}</p>`]
}
