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
 * - logged_out: /login/・/auth/shibboleth/ 着地、学外オリジン着地、
 *   または未ログイン本文マーカーを検知
 * - not_moodle_page: どのマーカーも無い（メンテページ等がLETUSオリジンで応答している）
 */
export type PageAuthClassification = 'logged_in' | 'logged_out' | 'not_moodle_page'

/**
 * LETUS本番ホスト名（コア層の単一情報源）。
 * background の `LETUS_LOGIN_URL`（src/background/index.ts）にも同ホストが埋まっているが、
 * core→background の逆依存は作れないためここを正とする。
 * content 側 courseDetectorCore.ts のリテラルは content script 制約
 *（core共有モジュールをcontentからimportすると共有チャンク化でESM importが残る）により共有不可。
 */
export const LETUS_HOSTNAME = 'letus.ed.tus.ac.jp'

/**
 * TUS実機のSSO入口パス（2026-07-19実測）。ログアウト時のリダイレクトチェーンは
 * course/view.php → 303 同一オリジン /auth/shibboleth/index.php →
 * 302 idp.admin.tus.ac.jp（SAML・クロスオリジン）→ login.microsoftonline.com。
 */
const SSO_ENTRY_PATH_MARKER = '/auth/shibboleth/'

/** Moodleが未ログイン時に出す本文マーカー（既存checkIsLoggedInの判定文字列を踏襲） */
const NOT_LOGGED_IN_MARKERS = ['あなたはログインしていません', 'You are not logged in']

/**
 * M.cfg インラインJSON（Moodleページの存在アンカー）の代入形。
 * 散文中の「M.cfg」言及を拾わないよう、代入（=）まで含めて一致させる。
 */
const MCFG_ASSIGNMENT_RE = /M\.cfg\s*=/

/** finalUrl からホスト名を取り出す。空文字・相対URL等の解釈不能はホスト不明として null */
function extractHostname(url: string): string | null {
  try {
    const hostname = new URL(url).hostname
    return hostname === '' ? null : hostname
  } catch {
    return null
  }
}

/**
 * 取得済みページを認証状態で分類する。
 *
 * 判定順序（順序が仕様）:
 * 1. finalUrl に /login/ を含む → logged_out（ログイン画面へリダイレクトされた）。
 * 2. finalUrl に /auth/shibboleth/ を含む → logged_out（TUS実機SSO入口・2026-07-19実測。
 *    redirect:'follow' の fetch がここへ着地したケースの検知。既存 checkIsLoggedIn の
 *    redirect:'manual' 運用では初段 303 が opaqueredirect になるため従来どおり検知済み）。
 * 3. 未ログイン本文マーカー → logged_out。**M.cfg より先に見る**:
 *    未ログイン/ゲスト閲覧のMoodleページもゲストsesskey入り M.cfg を載せるため、
 *    M.cfg 先行だと未ログインを logged_in に誤分類する。
 * 4. M.cfg 代入形 or sesskey マーカー（extractSesskeyと同一正規表現）→ logged_in。
 * 5. finalUrl のホストが letus.ed.tus.ac.jp 以外 → logged_out（クロスオリジン規則:
 *    LETUSはログイン済みfetchを学外オリジンへリダイレクトしない。実例は
 *    idp.admin.tus.ac.jp / login.microsoftonline.com への SAML チェーン着地。
 *    IdP/Microsoftのログイン面は Moodleマーカーを持たないため必ずこの規則へ落ちる。
 *    マーカー判定より後段に置くのは、デモサイト由来fixture（school.moodledemo.net・
 *    M.cfg有り）を実配線テストで logged_in のまま通すため＝実SSO面の検知力は不変）。
 * 6. どれでもない → not_moodle_page（ホスト不明＝opaque応答等の空/解釈不能URLには
 *    規則5を適用せず、従来どおり本文マーカーだけで判定する）。
 */
export function classifyFetchedPage(input: {
  /** リダイレクト追従後の最終URL。不明（opaque応答等）なら空文字 */
  finalUrl: string
  /** レスポンス本文（生HTML） */
  bodyText: string
}): PageAuthClassification {
  if (input.finalUrl.includes('/login/')) return 'logged_out'
  if (input.finalUrl.includes(SSO_ENTRY_PATH_MARKER)) return 'logged_out'
  if (NOT_LOGGED_IN_MARKERS.some((marker) => input.bodyText.includes(marker))) {
    return 'logged_out'
  }
  if (MCFG_ASSIGNMENT_RE.test(input.bodyText) || extractSesskey(input.bodyText) !== null) {
    return 'logged_in'
  }
  const hostname = extractHostname(input.finalUrl)
  if (hostname !== null && hostname !== LETUS_HOSTNAME) return 'logged_out'
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
