/**
 * 正直な「読めませんでした」表示の内容決定（spec§7）。2層の出力を持つ。
 *
 * 1. buildBannerContent（警告バナー）: activeCodes（エスカレーション済み hard
 *    コード）から「読めていない」警告を導出。再試行導線・最終取得時刻つき。
 * 2. buildInfoNotes（情報ノート）: infoCodes（カバレッジ情報）から「未対応と
 *    正直に示す」注記を導出。hard/info 区分（diagnosticsState）により
 *    UNSUPPORTED_MODULE 等の info コードは activeCodes に決して載らないため、
 *    警告バナーだけでは spec§7 の unsupported-module 表示・§0 の「未対応と
 *    正直に示す」に UI 経路が無い。infoCodes を警告でないトーンで出すこの層が
 *    その実配線。健全なLETUSでも恒常発火し得るコードなので、警告色・再試行
 *    ボタンを持たない小さなノートに留める。
 *    加えて passive版フィンガープリント（spec§5）の BS5世代観測
 *    （StoredMoodleFingerprint.bs5=true）も、この層の情報ノート1行として出す
 *    （spec§7 layout-changed の最小配線）。版プローブは補助信号（安全網は§4）で、
 *    パースが正常でも 5.x 稼働はあり得るため、観測単独では警告バナーにしない。
 *    bs5=true 時の lenient parse 等の挙動変更は次版送り（moodleFingerprint.ts 参照）。
 *
 * 付随して shouldSuppressScanErrorBanner（重複排除の選択ロジック）を持つ:
 * logged_out バナー表示中は旧エラーバナーの同趣旨メッセージを抑制する（詳細は関数doc）。
 *
 * いずれも diagnosticsState（自己診断台帳）だけを入力とする純関数。
 * chrome.* / DOM に触れない。
 *
 * バナーの表示規則:
 * - 表示トリガは activeCodes が非空のときのみ。infoCodes / lastCodes に何が
 *   残っていても activeCodes が空ならバナーは出さない
 *   （単発の一過性失敗で警告しない debounce を UI 側でも尊重する）。
 * - 複数コード該当時は原因を1つだけ示す。優先順位:
 *   logged_out（ユーザーが確実に対処できる）> unreadable（レイアウト変更の可能性）
 *   > unsupported（カバレッジ注記・旧形式データ等の防御枝）。
 * - 未知の将来コードは unreadable へ倒す（黙って none にしない＝「静かに壊れない」）。
 * - 文言は非技術的な日本語のみ。診断コード名や技術用語をユーザーに見せない。
 * - lastGoodAt は state の値をそのまま返す（「最終取得: M/D HH:mm」への整形は
 *   UI 側の formatDateTime の責務）。kind: none では描画物が無いため null。
 *
 * 情報ノートの表示規則:
 * - activeCodes が非空（警告バナー表示中）の間はノートを出さない（spec§7 の
 *   重複排除。読めていない時のカバレッジ注記は不確かな観測でもある）。
 * - 既知の info コードは固定順（INFO_NOTE_ORDER）で1コード1ノート。
 *   未知の info コード（将来の階級再分類等）は汎用文へ倒し、同文は1つに束ねる
 *   （黙って落とさない）。
 */

import type { DiagnosticCode } from './diagnose'
import type { DiagnosticsState } from './diagnosticsState'
import type { StoredMoodleFingerprint } from './moodleFingerprint'

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

/**
 * BS5世代観測ノートの識別コード。DiagnosticCode ではない（診断台帳でなく
 * passive版フィンガープリント由来の独立した観測）ため専用の値を持つ。
 */
export const BS5_LAYOUT_NOTE_CODE = 'MOODLE_BS5_LAYOUT' as const

/** InfoNote の識別子: 診断コード or BS5観測ノート */
export type InfoNoteCode = DiagnosticCode | typeof BS5_LAYOUT_NOTE_CODE

/** カバレッジ情報ノート1件。code は React key 等の識別用（UI に表示しない） */
export interface InfoNote {
  code: InfoNoteCode
  text: string
}

/** 既知 info コードの表示順（spec の約束である unsupported を先頭に固定） */
const INFO_NOTE_ORDER: readonly DiagnosticCode[] = [
  'UNSUPPORTED_MODULE',
  'DEADLINE_KEYWORD_NO_DATE',
  'COURSE_LOST_ALL_ASSIGNMENTS',
]

/**
 * 既知 info コードの文言。unsupported はバナー防御枝と同一文を単一情報源で共有。
 * COURSE_LOST_ALL_ASSIGNMENTS は正当な非表示化でも発火するため断定せず、
 * last-good データを保持していること（skipSave の格上げ挙動）だけを伝える。
 */
const INFO_NOTE_TEXTS: Partial<Record<DiagnosticCode, string>> = {
  UNSUPPORTED_MODULE: BANNER_TEXTS.unsupported.body,
  DEADLINE_KEYWORD_NO_DATE:
    '一部の活動で締切らしい記載を見つけましたが、日時を読み取れませんでした。',
  COURSE_LOST_ALL_ASSIGNMENTS:
    '一部のコースで課題が見つからなくなりました。以前に取得した課題は引き続き表示しています。',
}

/** 未知の info コード（将来の階級再分類等）を黙って落とさないための汎用文 */
const FALLBACK_INFO_NOTE_TEXT = '一部の情報を自動取得できていない可能性があります。'

/**
 * BS5世代（Moodle 5.x）観測時の情報ノート文言。観測は事実（docsリンクの版セグメント）
 * だが影響は未確定なので、断定せず「可能性」のトーンに留める（§7 非技術的な一文）。
 */
const BS5_LAYOUT_NOTE_TEXT =
  'LETUSの画面構成が新しくなった可能性を検出しました。課題の読み取りに影響が出る場合があります。'

/**
 * 旧エラーバナー（スキャン失敗メッセージ）のログアウト趣旨判定キー。
 * background のログインガード文言「LETUSにログインしていないため更新できませんでした。」
 * （src/background/index.ts NOT_LOGGED_IN_ERROR_MESSAGE・課題/締切両スキャン共通）に
 * 一致させる。core→background の依存は張れない（background は chrome.* 副作用と同居）
 * ため全文でなく趣旨の中核句で部分一致させ、文言の推敲に対して壊れにくくする。
 * タイムアウト文言「ログインしているか」・通信失敗文言「ログイン状態」はこの句を
 * 含まない＝別趣旨として抑制対象にならない。
 */
const NOT_LOGGED_IN_SCAN_ERROR_MARKER = 'ログインしていない'

/**
 * 診断バナーが logged_out を表示している間、旧エラーバナーの同趣旨メッセージ
 * （ログインしていないため更新できなかった）を抑制するかを決める（spec§7 の重複排除）。
 *
 * 方向は「diagnosticsBanner を優先する一元化」: logged_out バナーが再ログイン案内・
 * 最終取得時刻・再試行導線を持つため、旧バナーを消しても情報と導線は失われない。
 * 逆に、ネットワーク断など別趣旨のスキャン失敗は logged_out バナーでは代替されない
 * ので抑制しない（情報が消えない方向）。バナーが logged_out 以外（none/unreadable/
 * unsupported）のときは、ログアウト趣旨メッセージでも旧バナーが唯一の表示経路なので
 * 抑制しない。
 */
export function shouldSuppressScanErrorBanner(
  bannerKind: BannerKind,
  scanErrorMessage: string | null,
): boolean {
  if (scanErrorMessage === null || scanErrorMessage === '') return false
  return (
    bannerKind === 'logged_out' &&
    scanErrorMessage.includes(NOT_LOGGED_IN_SCAN_ERROR_MARKER)
  )
}

/**
 * diagnosticsState からカバレッジ情報ノート（警告でない注記）を導出する。
 * 表示不要なら空配列。activeCodes 非空（警告バナー表示中）の間は常に空配列
 * （BS5観測ノート含む: unreadable バナーが「画面構成が変わった可能性」を既に
 * 伝えているため重ねない）。
 *
 * fingerprint（passive版フィンガープリントの最新観測・spec§5）が BS5世代
 * （bs5=true）を示す場合、診断台帳と独立に BS5 観測ノートを1行追記する。
 * 台帳が無い（state=null）だけの状態でも出す＝フィンガープリントは独立した観測。
 * 既知 info コードの固定順（unsupported 先頭）の約束を崩さないよう末尾に置く。
 */
export function buildInfoNotes(
  state: DiagnosticsState | null,
  fingerprint?: Pick<StoredMoodleFingerprint, 'bs5'> | null,
): InfoNote[] {
  if (state !== null && state.activeCodes.length > 0) {
    return []
  }
  const infoCodes = state?.infoCodes ?? []
  const known = INFO_NOTE_ORDER.filter((code) => infoCodes.includes(code))
  const unknown = infoCodes.filter((code) => !INFO_NOTE_ORDER.includes(code))
  const notes: InfoNote[] = []
  const seenTexts = new Set<string>()
  for (const code of [...known, ...unknown]) {
    const text = INFO_NOTE_TEXTS[code] ?? FALLBACK_INFO_NOTE_TEXT
    if (seenTexts.has(text)) continue
    seenTexts.add(text)
    notes.push({ code, text })
  }
  if (fingerprint?.bs5 === true) {
    notes.push({ code: BS5_LAYOUT_NOTE_CODE, text: BS5_LAYOUT_NOTE_TEXT })
  }
  return notes
}
