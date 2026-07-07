/**
 * LETUS(Moodle) sesskey AJAX APIの純粋ロジック。
 * 設計: docs/superpowers/specs/2026-07-08-letus-api-deadline-hybrid-design.md
 * Chrome API・fetch・DOMに依存しない（litusへそのまま移植する前提）。
 */

/** ログイン済みLETUSページの生HTMLから sesskey を抽出する（M.cfgのインラインJSON形状）。 */
export function extractSesskey(html: string): string | null {
  const m = String(html).match(/"sesskey":"([A-Za-z0-9]+)"/)
  return m ? m[1] : null
}
