/**
 * 自己診断の永続状態（spec§4の永続層＋§7の状態表現の土台）。
 *
 * diagnose.ts が返す「単発観測の矛盾コード」を、スキャンサイクルをまたいで
 * 集約する純粋reducer。last-good（前回成功）と now-failing（今回失敗）を区別し、
 * 断続的な一過性失敗で誤警告しないよう連続失敗回数でエスカレーションする（debounce）。
 *
 * 設計原則:
 * - chrome.* / fetch / DOM に一切触れない純関数。保存（chrome.storage.local の
 *   DIAGNOSTICS_STATE_KEY）は background 側の薄い配線の責務。
 * - activeCodes = UI（popup/dashboardバナー）に見せてよい「確度の高い」コード。
 *   lastCodes = 直近スキャンの生観測（デバッグ・popup詳細用）。両者を分けることで
 *   「観測はしたがまだ鳴らさない」状態を表現する（spec§7）。
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

export interface DiagnosticsState {
  /** 最後に診断コードゼロでスキャンが完走した時刻（ISO）。一度も無ければ null */
  lastGoodAt: string | null
  /** 連続失敗（診断コード付きスキャン）回数。成功で 0 に戻る */
  consecutiveFailures: number
  /** エスカレーション済みの表示対象コード（UIバナーの根拠）。重複なし */
  activeCodes: DiagnosticCode[]
  /** 直近スキャンで観測したコード（昇格前の生観測・成功時は空）。重複なし */
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
 * - codes空 = 成功 → lastGoodAt=at・consecutiveFailures=0・activeCodes/lastCodes=[]。
 *   再ログインやLETUS復旧を即座に反映し、警告を残さない。
 * - codes非空 = 失敗 → consecutiveFailures+1・lastGoodAt保持。
 *   ESCALATION_THRESHOLD 連続で初めて activeCodes に今回のコードを昇格する
 *   （一過性失敗でバナーを出さない debounce・spec§7）。昇格後も毎回最新の
 *   観測で置き換え、古い症状を引きずらない。
 * - 例外: LOGGED_OUT は閾値を待たず即 active にする（ユーザーが「ログインし直す」
 *   で確実に対処できる明確状態のため）。閾値未満では随伴コードは昇格させない
 *   （ログアウト中の0コース等はログアウトの症状であり、原因1つだけを示す）。
 * - prev=null（初回）は「成功も失敗も無い空状態」として扱う。
 */
export function applyScanOutcome(
  prev: DiagnosticsState | null,
  outcome: ScanOutcome,
): DiagnosticsState {
  const codes = dedupe(outcome.codes)

  if (codes.length === 0) {
    return {
      lastGoodAt: outcome.at,
      consecutiveFailures: 0,
      activeCodes: [],
      lastCodes: [],
      updatedAt: outcome.at,
    }
  }

  const consecutiveFailures = (prev?.consecutiveFailures ?? 0) + 1
  const escalated = consecutiveFailures >= ESCALATION_THRESHOLD
  const activeCodes = escalated
    ? codes
    : codes.includes('LOGGED_OUT')
      ? dedupe([...(prev?.activeCodes ?? []), 'LOGGED_OUT'])
      : [...(prev?.activeCodes ?? [])]

  return {
    lastGoodAt: prev?.lastGoodAt ?? null,
    consecutiveFailures,
    activeCodes,
    lastCodes: codes,
    updatedAt: outcome.at,
  }
}
