/**
 * 正直な「読めませんでした」バナーの内容決定（spec§7）。
 *
 * diagnosticsState（自己診断台帳）から popup/dashboard に出すバナーの
 * 種別・文言・最終取得時刻を導出する純関数。chrome.* / DOM に触れない。
 *
 * 表示規則:
 * - 表示トリガは activeCodes（エスカレーション済み hard コード）が非空のときのみ。
 *   infoCodes / lastCodes に何が残っていても activeCodes が空なら表示しない
 *   （単発の一過性失敗で警告しない debounce を UI 側でも尊重する）。
 * - 複数コード該当時は原因を1つだけ示す。優先順位:
 *   logged_out（ユーザーが確実に対処できる）> unreadable（レイアウト変更の可能性）
 *   > unsupported（カバレッジ注記）。
 * - 未知の将来コードは unreadable へ倒す（黙って none にしない＝「静かに壊れない」）。
 * - 文言は非技術的な日本語のみ。診断コード名や技術用語をユーザーに見せない。
 * - lastGoodAt は state の値をそのまま返す（「最終取得: M/D HH:mm」への整形は
 *   UI 側の formatDateTime の責務）。kind: none では描画物が無いため null。
 */

import type { DiagnosticCode } from './diagnose'
import type { DiagnosticsState } from './diagnosticsState'

export type BannerKind = 'none' | 'logged_out' | 'unreadable' | 'unsupported'

export interface BannerContent {
  kind: BannerKind
  title: string
  body: string
  /** 最後に正常取得できた時刻（ISO）。未成功なら null。整形はUI側 */
  lastGoodAt: string | null
}

/**
 * kind ごとの文言。UNSUPPORTED_MODULE の詳細なモジュール型名は
 * DiagnosticsState に永続されていない（コードのみ）ため、一般化した文とする。
 */
const BANNER_TEXTS: Record<Exclude<BannerKind, 'none'>, { title: string; body: string }> = {
  logged_out: {
    title: 'LETUSからログアウトされています',
    body: 'LETUSにログインし直すと自動的に再開します。',
  },
  unreadable: {
    title: 'LETUSの情報を読み取れませんでした',
    body: 'LETUSの画面構成が変わった可能性があり、一部の情報を読み取れませんでした。表示中のデータは最後に取得できた時点のものです。',
  },
  unsupported: {
    title: '一部の活動は自動取得に未対応です',
    body: '一部の活動はまだ締切の自動取得に対応していません。',
  },
}

/**
 * activeCodes から表示種別を決める（優先順位: logged_out > unreadable > unsupported）。
 * UNSUPPORTED_MODULE 以外の全コード（将来の未知コード含む）は unreadable として扱う。
 */
function resolveKind(activeCodes: DiagnosticCode[]): Exclude<BannerKind, 'none'> {
  if (activeCodes.includes('LOGGED_OUT')) return 'logged_out'
  if (activeCodes.some((code) => code !== 'UNSUPPORTED_MODULE')) return 'unreadable'
  return 'unsupported'
}

/** diagnosticsState からバナー内容を導出する。表示不要なら kind: 'none' */
export function buildBannerContent(state: DiagnosticsState | null): BannerContent {
  if (state === null || state.activeCodes.length === 0) {
    return { kind: 'none', title: '', body: '', lastGoodAt: null }
  }
  const kind = resolveKind(state.activeCodes)
  const { title, body } = BANNER_TEXTS[kind]
  return { kind, title, body, lastGoodAt: state.lastGoodAt }
}
