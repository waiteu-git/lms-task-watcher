/**
 * 認証状態のpassiveプローブ（spec§6 前提リファクタ）。
 * 既存fetchレスポンス（リダイレクト追従後のURL＋本文）だけからページの認証状態を
 * 分類する純関数群。**このモジュール自身はfetchしない**（追加リクエスト0のpiggyback専用）。
 *
 * 設計原則:
 * - chrome.* / fetch / DOM に一切触れない。結果の保存（chrome.storage.local）は配線側の責務。
 * - 分類は diagnose.ts の矛盾検知への入力を意図する:
 *   logged_out → LOGGED_OUT、not_moodle_page → NOT_A_MOODLE_PAGE の証拠になる。
 * - ネットワーク失敗（fetch例外・!ok）はここに来る前に配線側で処理する。
 *   本モジュールは「取得できたページが何者か」だけを見る。
 */

import { extractSesskey } from './letusApi'

/**
 * fetch済みページの認証分類。
 * - logged_in: M.cfg / sesskey マーカーがあり、ログアウト証拠が無い
 * - logged_out: /login/ 着地、または未ログイン本文マーカーを検知
 * - not_moodle_page: どのマーカーも無い（メンテページ・学内ポータル等が応答している）
 */
export type PageAuthClassification = 'logged_in' | 'logged_out' | 'not_moodle_page'

/** Moodleが未ログイン時に出す本文マーカー（既存checkIsLoggedInの判定文字列を踏襲） */
const NOT_LOGGED_IN_MARKERS = ['あなたはログインしていません', 'You are not logged in']

/**
 * M.cfg インラインJSON（Moodleページの存在アンカー）の代入形。
 * 散文中の「M.cfg」言及を拾わないよう、代入（=）まで含めて一致させる。
 */
const MCFG_ASSIGNMENT_RE = /M\.cfg\s*=/

/**
 * 取得済みページを認証状態で分類する。
 *
 * 判定順序（順序が仕様）:
 * 1. finalUrl に /login/ を含む → logged_out（ログイン画面へリダイレクトされた）。
 * 2. 未ログイン本文マーカー → logged_out。**M.cfg より先に見る**:
 *    未ログイン/ゲスト閲覧のMoodleページもゲストsesskey入り M.cfg を載せるため、
 *    M.cfg 先行だと未ログインを logged_in に誤分類する。
 * 3. M.cfg 代入形 or sesskey マーカー（extractSesskeyと同一正規表現）→ logged_in。
 * 4. どれでもない → not_moodle_page。
 */
export function classifyFetchedPage(input: {
  /** リダイレクト追従後の最終URL。不明（opaque応答等）なら空文字 */
  finalUrl: string
  /** レスポンス本文（生HTML） */
  bodyText: string
}): PageAuthClassification {
  if (input.finalUrl.includes('/login/')) return 'logged_out'
  if (NOT_LOGGED_IN_MARKERS.some((marker) => input.bodyText.includes(marker))) {
    return 'logged_out'
  }
  if (MCFG_ASSIGNMENT_RE.test(input.bodyText) || extractSesskey(input.bodyText) !== null) {
    return 'logged_in'
  }
  return 'not_moodle_page'
}

/**
 * スキャン1回分の分類集計。後続タスク（診断の配線/UI）が
 * 「全ページlogged_out」「Moodle以外が応答」等を判断するための材料。
 * この時点では storage 永続・UI 反映はしない（観測のみ）。
 */
export interface AuthProbeSummary {
  /** 分類対象になったfetch成功ページ数（fetch失敗ページは含まない） */
  probedCount: number
  loggedInCount: number
  loggedOutCount: number
  notMoodleCount: number
}

export function emptyAuthProbeSummary(): AuthProbeSummary {
  return { probedCount: 0, loggedInCount: 0, loggedOutCount: 0, notMoodleCount: 0 }
}

/** 分類1件を集計へ加算した新しい集計を返す（入力は破壊しない） */
export function addToAuthProbeSummary(
  summary: AuthProbeSummary,
  classification: PageAuthClassification,
): AuthProbeSummary {
  return {
    probedCount: summary.probedCount + 1,
    loggedInCount: summary.loggedInCount + (classification === 'logged_in' ? 1 : 0),
    loggedOutCount: summary.loggedOutCount + (classification === 'logged_out' ? 1 : 0),
    notMoodleCount: summary.notMoodleCount + (classification === 'not_moodle_page' ? 1 : 0),
  }
}
