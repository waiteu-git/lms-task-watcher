// CLASS学生時間割表(Kmd008)を passive に取り込む dumb grabber。
// パースはしない（node-html-parserを含めない）。timetableStoreも import しない
// （Rollup共有チャンク化で import 文が出力され classic content script が壊れるのを避ける）。

console.log('[LETUS Task Watcher] CLASS timetable content script loaded')

function detectSemester(): 'zenki' | 'kouki' | null {
  const sel = document.querySelector<HTMLSelectElement>('select[name*="gakki"], select[id*="gakki"]')
  if (sel) {
    if (sel.value === '1') return 'zenki'
    if (sel.value === '2') return 'kouki'
    const text = sel.selectedOptions[0]?.textContent ?? ''
    if (text.includes('前期')) return 'zenki'
    if (text.includes('後期')) return 'kouki'
  }
  const body = document.body.textContent ?? ''
  if (body.includes('後期')) return 'kouki'
  if (body.includes('前期')) return 'zenki'
  return null
}

function detectYear(): number {
  const m = (document.body.textContent ?? '').match(/(20\d{2})\s*年度/)
  if (m) return Number(m[1])
  const now = new Date()
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
}

function findJigenText(): string {
  const el = Array.from(document.querySelectorAll('*')).find(
    (e) => /\d+\s*限\s*\d{1,2}:\d{2}/.test(e.textContent ?? '') && e.children.length === 0,
  )
  return el?.textContent?.trim() ?? ''
}

function showToast(message: string): void {
  const div = document.createElement('div')
  div.textContent = message
  div.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#1d9e75;color:#fff;' +
    'padding:10px 16px;border-radius:8px;font-size:13px;font-family:sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2)'
  document.body.appendChild(div)
  setTimeout(() => div.remove(), 3000)
}

let lastHtml = ''

function capture(): void {
  const table = document.querySelector('table.classTable')
  if (!table) return
  const html = table.outerHTML
  if (html === lastHtml) return
  const semester = detectSemester()
  if (!semester) return
  lastHtml = html

  const year = detectYear()
  const key = `timetable:${year}:${semester}`
  const value = { rawTableHtml: html, jigenText: findJigenText(), capturedAt: new Date().toISOString() }
  void chrome.storage.local.set({ [key]: value }).then(() => {
    showToast('時間割を取り込みました')
  })
}

const observer = new MutationObserver(() => capture())
observer.observe(document.documentElement, { childList: true, subtree: true })
capture()
