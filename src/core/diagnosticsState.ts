/**
 * 自己診断の永続状態（spec§4の永続層＋§7の状態表現の土台）。
 *
 * diagnose.ts が返す「単発観測の矛盾コード」を、スキャンサイクルをまたいで
 * 集約する純粋reducer。last-good（前回成功）と now-failing（今回失敗）を区別し、
 * 断続的な一過性失敗で誤警告しないよう連続失敗回数でエスカレーションする（debounce）。
 *
 * コードは2階級に区分して畳み込む:
 * - hard（スキャン整合性）: LOGGED_OUT / NOT_A_MOODLE_PAGE / DASHBOARD_UNREADABLE /
 *   COURSE_PAGE_NO_ACTIVITIES。健全なLETUSでは発火しない＝「読めていない」ことの証拠。
 *   consecutiveFailures / lastGoodAt / エスカレーションはこの階級だけで駆動する。
 * - info（カバレッジ情報）: INFO_DIAGNOSTIC_CODES 参照。健全なLETUSでも恒常的に
 *   発火し得る（未対応モジュール型を含むコース・教員が全活動を非表示にした正当な空 等）。
 *   これを失敗カウンタへ合流させると lastGoodAt が恒久凍結・consecutiveFailures が
 *   無限増加して閾値が常時成立し、どんな一過性コードも初回観測で昇格＝debounce が
 *   恒久無効化される。そのため infoCodes フィールドへ分離し、失敗カウンタを駆動せず
 *   常に最新観測で置換するのみとする。
 *
 * 設計原則:
 * - chrome.* / fetch / DOM に一切触れない純関数。保存（chrome.storage.local の
 *   DIAGNOSTICS_STATE_KEY）は background 側の薄い配線の責務。
 * - activeCodes = UI（popup/dashboardバナー）に見せてよい「確度の高い」hardコード。
 *   infoCodes = UIが警告でなく情報として別扱いで見せるカバレッジ注記。
 *   lastCodes = 直近スキャンの生観測（hard+info・デバッグ・popup詳細用）。
 * - 外部送信ゼロ。状態は端末内で完結する。
 */

import type { DiagnosticCode } from './diagnose'

/** chrome.storage.local の保存キー（配線・UI側が共有する単一情報源） */
export const DIAGNOSTICS_STATE_KEY = 'diagnosticsState'

/**
 * activeCodes へ昇格させる連続失敗回数の閾値（spec§7 debounce）。
 * 単発の一過性失敗（メンテ・一時的なプロキシ応答等）ではバナーを出さず、
 * 2回連続で同じく失敗したときに初めて「壊れている」と表明する。
 */
export const ESCALATION_THRESHOLD = 2

/**
 * info（カバレッジ情報）階級のコード。健全なLETUSでも恒常的に発火し得るため、
 * 失敗カウンタ（consecutiveFailures / lastGoodAt / エスカレーション）を駆動しない。
 * - UNSUPPORTED_MODULE: 既知リスト外モジュール型を含むコースがあるだけで毎スキャン発火する。
 * - DEADLINE_KEYWORD_NO_DATE: 特定活動の書式起因なら、その活動が在る限り発火し続ける。
 * - COURSE_LOST_ALL_ASSIGNMENTS: レイアウト破損でも起きるが、教員が学期末に全活動を
 *   非表示にした正当ケースでも発火し、skipSave が旧シグネチャを保持するため自己回復しない。
 *   1コースの状態で全体台帳を凍結させないため info とする。実レイアウト破損は
 *   DASHBOARD_UNREADABLE / COURSE_PAGE_NO_ACTIVITIES（hard）と§5のpassive版
 *   フィンガープリントが別途拾う。加えて「既知コースの過半が同一スキャンで一斉喪失」
 *   （format-* は残るが活動一覧だけが全コースで死ぬ5.x破損モード）は、per-course 判定の
 *   死角として集計側 diagnoseCourseLossAggregate が COURSES_MAJORITY_LOST（hard）へ
 *   昇格させる＝正当な1コース非表示と全滅破損の区別は件数集計が担う。
 */
export const INFO_DIAGNOSTIC_CODES = [
  'UNSUPPORTED_MODULE',
  'DEADLINE_KEYWORD_NO_DATE',
  'COURSE_LOST_ALL_ASSIGNMENTS',
] as const satisfies readonly DiagnosticCode[]

const INFO_CODE_SET: ReadonlySet<DiagnosticCode> = new Set(INFO_DIAGNOSTIC_CODES)

/** code が info（カバレッジ情報）階級か。false = hard（スキャン整合性）階級 */
export function isInfoDiagnosticCode(code: DiagnosticCode): boolean {
  return INFO_CODE_SET.has(code)
}

export interface DiagnosticsState {
  /** 最後に hard コードゼロでスキャンが完走した時刻（ISO）。一度も無ければ null */
  lastGoodAt: string | null
  /** hard コード付きスキャンの連続回数。hard コードゼロの完走で 0 に戻る */
  consecutiveFailures: number
  /** エスカレーション済みの表示対象 hard コード（UIバナーの根拠）。重複なし */
  activeCodes: DiagnosticCode[]
  /**
   * 直近スキャンで観測した info コード（カバレッジ注記）。重複なし。
   * 失敗カウンタを駆動せず、毎回の記録で最新観測に置換される（古い注記を引きずらない。
   * hard 失敗で観測が不完全なサイクルでは一時的に空へ戻り、次の健全スキャンで再導出される）。
   */
  infoCodes: DiagnosticCode[]
  /** 直近スキャンで観測した全コード（hard+info の生観測）。重複なし */
  lastCodes: DiagnosticCode[]
  /** この状態を書いたスキャンの時刻（ISO） */
  updatedAt: string
}

/** 1回のスキャンサイクルの観測結果 */
export interface ScanOutcome {
  /** サイクル中に発火した診断コード（重複可・本reducerが排除する） */
  codes: DiagnosticCode[]
  /** スキャン完了時刻（ISO）。updatedAt / lastGoodAt にそのまま使う */
  at: string
}

/** 出現順を保った重複排除 */
function dedupe(codes: DiagnosticCode[]): DiagnosticCode[] {
  return Array.from(new Set(codes))
}

/**
 * スキャン結果を永続状態へ畳み込む純粋reducer。
 *
 * 規則:
 * - hard コード無し = 成功 → lastGoodAt=at・consecutiveFailures=0・activeCodes=[]。
 *   再ログインやLETUS復旧を即座に反映し、警告を残さない。info コードだけの観測も
 *   成功（スキャン自体は読めている）: infoCodes として保持しつつ失敗系は駆動しない。
 * - hard コード有り = 失敗 → consecutiveFailures+1・lastGoodAt保持。
 *   ESCALATION_THRESHOLD 連続で初めて activeCodes へ今回の hard コードを昇格する
 *   （一過性失敗でバナーを出さない debounce・spec§7）。昇格後も毎回最新の
 *   観測で置き換え、古い症状を引きずらない。info コードは昇格対象にしない。
 * - 例外: LOGGED_OUT は閾値を待たず即 active にする（ユーザーが「ログインし直す」
 *   で確実に対処できる明確状態のため）。閾値未満では随伴コードは昇格させない
 *   （ログアウト中の0コース等はログアウトの症状であり、原因1つだけを示す）。
 * - infoCodes は成功/失敗を問わず毎回、今回観測した info コードで置換する。
 * - prev=null（初回）は「成功も失敗も無い空状態」として扱う。
 *
 * 呼び出し側の契約: 途中で死んだ不完全なサイクル（ネットワーク例外等・hard コード無し）は
 * 記録せず中立スキップすること（background の recordScanCycleOutcome が担保）。
 */
export function applyScanOutcome(
  prev: DiagnosticsState | null,
  outcome: ScanOutcome,
): DiagnosticsState {
  const codes = dedupe(outcome.codes)
  const infoCodes = codes.filter((code) => isInfoDiagnosticCode(code))
  const hardCodes = codes.filter((code) => !isInfoDiagnosticCode(code))

  if (hardCodes.length === 0) {
    return {
      lastGoodAt: outcome.at,
      consecutiveFailures: 0,
      activeCodes: [],
      infoCodes,
      lastCodes: codes,
      updatedAt: outcome.at,
    }
  }

  const consecutiveFailures = (prev?.consecutiveFailures ?? 0) + 1
  const escalated = consecutiveFailures >= ESCALATION_THRESHOLD
  // 旧形式の保存データや将来の階級再分類で prev.activeCodes に info コードが
  // 混じっていても引き継がない（activeCodes は常に hard のみ＝自己修復）。
  const carriedActive = (prev?.activeCodes ?? []).filter((code) => !isInfoDiagnosticCode(code))
  const activeCodes = escalated
    ? hardCodes
    : hardCodes.includes('LOGGED_OUT')
      ? dedupe([...carriedActive, 'LOGGED_OUT'])
      : carriedActive

  return {
    lastGoodAt: prev?.lastGoodAt ?? null,
    consecutiveFailures,
    activeCodes,
    infoCodes,
    lastCodes: codes,
    updatedAt: outcome.at,
  }
}
