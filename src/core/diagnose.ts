/**
 * 自己診断レイヤ（spec§4）: LETUSスクレイプが「静かに壊れる」代わりに、
 * ローカルで矛盾を検知して型付きコードとして浮上させる純粋関数群。
 *
 * 設計原則:
 * - chrome.* / fetch / DOM に一切触れない。入力はパーサ各層が算出したカウント/フラグのみ。
 * - 誤検知抑制を判定自体に内蔵する: 正当な空（0課題コース・未登録Dashboard・初回スキャン=prev無し）
 *   では発火しない。prev状態との差分＋ページマーカー存在を併用し、判定に迷う入力
 *   （認証状態 unknown 等）は「発火しない」に倒す（誤警告はUX毀損）。
 * - 連続失敗によるエスカレーション（debounce/閾値）は本モジュールの外（配線側）の責務。
 *   ここは「単発観測の矛盾判定」だけを純粋に行う。
 * - 発火有無に関わらず外部送信はしない（結果の保存先は chrome.storage.local のみ・配線側）。
 */

export const DIAGNOSTIC_CODES = [
  /** ログイン済み(sesskey有)のDashboardでコースアンカーが1件も読めない */
  'DASHBOARD_UNREADABLE',
  /** 既知コースのHTMLは取得できたが、コースページとして認識できず活動も読めない */
  'COURSE_PAGE_NO_ACTIVITIES',
  /** 締切キーワードは存在するのに日付がパースできない（相対日付/書式変更の兆候） */
  'DEADLINE_KEYWORD_NO_DATE',
  /** 既知コース（前回シグネチャ>0）が全課題を喪失した */
  'COURSE_LOST_ALL_ASSIGNMENTS',
  /** 既知コースの過半が同一スキャンで全課題を喪失した（レイアウト破損の強い兆候・hard階級） */
  'COURSES_MAJORITY_LOST',
  /** 認証fetchの応答に M.cfg が無い＝Moodleでないページが返っている */
  'NOT_A_MOODLE_PAGE',
  /** 提出状態の抽出に未対応なモジュール型（正直に「未対応」と示す） */
  'UNSUPPORTED_MODULE',
  /** ログアウト状態（ログインページ/未ログイン本文を検知） */
  'LOGGED_OUT',
] as const

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number]

/**
 * 取得済みHTMLから配線側が導出するページ単位の認証状態。
 * - logged_in: M.cfg の sesskey 等、ログイン済みの証拠がある
 * - logged_out: 「あなたはログインしていません」本文・/login/ リダイレクト等を検知
 * - unknown: どちらの証拠も無い（メンテページ・学内ポータル等の可能性）
 */
export type PageAuthState = 'logged_in' | 'logged_out' | 'unknown'

export interface DashboardInput {
  pageAuthState: PageAuthState
  /** Dashboard HTMLから抽出できた /course/view.php アンカー数 */
  courseAnchorCount: number
  /** storage に既に保存されている既知コース数（prev状態） */
  knownCourseCount: number
}

/**
 * Dashboard（/my/ 等）の矛盾検知。
 * 「ログイン済みなのに0コース」を、既知コースが存在する場合に限って破損とみなす。
 * 既知コース0件（初回利用・未登録）は正当な空なので発火しない。
 */
export function diagnoseDashboard(input: DashboardInput): DiagnosticCode[] {
  if (input.pageAuthState === 'logged_out') return ['LOGGED_OUT']
  if (input.pageAuthState !== 'logged_in') return []
  if (input.courseAnchorCount === 0 && input.knownCourseCount > 0) {
    return ['DASHBOARD_UNREADABLE']
  }
  return []
}

export interface CoursePageInput {
  pageAuthState: PageAuthState
  /** コースHTMLから抽出できた /mod/<type>/view.php アンカー数 */
  modAnchorCount: number
  /** 前回保存したコースシグネチャの件数。null = 初回スキャン（prev無し） */
  prevSignatureLen: number | null
  /** ページがコースページとして認識できるマーカー（format-* body class 等）を持つか */
  hasCourseMarker: boolean
}

/**
 * コースページ（course/view.php）の矛盾検知。
 * courseUpdates.computeCourseUpdate の暗黙 skipSave（空スクレイプ黙殺）を
 * 明示的な診断コードへ格上げするための判定。発火条件は「既知コース（prev>0）の0件化」のみ:
 * - 初回スキャン（prev=null）と既知の空コース（prev=0）は正当な空として発火しない。
 * - 0件化した際、コースマーカーが残っていれば COURSE_LOST_ALL_ASSIGNMENTS
 *   （ページは読めているが内容が消えた）、マーカーごと消えていれば
 *   COURSE_PAGE_NO_ACTIVITIES（ページ自体が読めない＝レイアウト変更の可能性）。
 * - 部分的な減少は通常運用（教員による非表示等）なので診断対象にしない（差分通知側の責務）。
 */
export function diagnoseCoursePage(input: CoursePageInput): DiagnosticCode[] {
  if (input.pageAuthState === 'logged_out') return ['LOGGED_OUT']
  if (input.pageAuthState !== 'logged_in') return []
  if (input.modAnchorCount > 0) return []
  if (input.prevSignatureLen === null || input.prevSignatureLen === 0) return []
  return input.hasCourseMarker ? ['COURSE_LOST_ALL_ASSIGNMENTS'] : ['COURSE_PAGE_NO_ACTIVITIES']
}

export interface ActivityPageInput {
  pageAuthState: PageAuthState
  /** 締切キーワード（extractDeadlineText相当）がページ本文から見つかったか */
  keywordFound: boolean
  /** parseDeadline（タイトル由来も含む）が日付を返したか */
  dateParsed: boolean
  /** 提出状態が unknown 以外に解決したか */
  statusResolved: boolean
  /** /mod/<type>/view.php の <type>。抽出不能なら null（診断メッセージ生成用・判定には使わない） */
  moduleType: string | null
  /** この型の提出状態抽出に対応済みか（assign/quiz等・配線側の許可リスト判定） */
  moduleSupported: boolean
}

/**
 * 活動ページ（mod/<type>/view.php）の矛盾検知。
 * - DEADLINE_KEYWORD_NO_DATE: キーワードが在るのに日付が取れない＝相対日付モードや
 *   書式変更で締切を取りこぼしている兆候。
 * - UNSUPPORTED_MODULE: 未対応型で「締切の証拠（キーワード or 日付）は在るのに状態が不明」
 *   のときだけ発火。締切の無い未対応活動に警告してもノイズなので鳴らさない。
 *   状態が汎用判定で解決できた場合も鳴らさない（実害が無い）。
 * - 対応型（assign等）の状態unknownは正当なvariant（グループ課題等）があり得るため発火しない。
 */
export function diagnoseActivityPage(input: ActivityPageInput): DiagnosticCode[] {
  if (input.pageAuthState === 'logged_out') return ['LOGGED_OUT']
  if (input.pageAuthState !== 'logged_in') return []
  const codes: DiagnosticCode[] = []
  if (input.keywordFound && !input.dateParsed) {
    codes.push('DEADLINE_KEYWORD_NO_DATE')
  }
  if (
    !input.moduleSupported &&
    !input.statusResolved &&
    (input.keywordFound || input.dateParsed)
  ) {
    codes.push('UNSUPPORTED_MODULE')
  }
  return codes
}

export interface CourseLossAggregateInput {
  /** 今回スキャンで COURSE_LOST_ALL_ASSIGNMENTS を発火した既知コース数 */
  lostCourseCount: number
  /** 今回スキャンで観測できた既知コース（ログイン済み・前回シグネチャ>0）の総数 */
  trackedCourseCount: number
}

/**
 * コース横断の喪失集計（per-course判定の構造的死角の補完）。
 *
 * COURSE_LOST_ALL_ASSIGNMENTS は「教員が学期末に全活動を非表示にした正当ケース」でも
 * 発火するため info 階級（警告バナー非発火・lastGoodAt 継続）だが、その区分は
 * 「1コースの正当な非表示化」と「全コース一斉喪失」を区別できない。5.x移行で
 * format-* body class は残るのに mod-anchor が全コースで消える破損モード
 * （活動一覧のクライアント描画化）では、per-course 判定だけだと hard コードが
 * 一切発火せず§7の警告経路に到達しない。この集計が両者を件数で区別する:
 *
 * - lostCourseCount >= 2: 1コースだけの喪失は正当ケースの本命なので絶対に昇格しない
 *   （既知コース1件のユーザーの単独喪失も昇格しない＝info階級の設計根拠を保存）。
 * - 厳密過半（lost*2 > tracked）: レイアウト破損は全コースを一様に壊す一方、
 *   複数教員の非表示操作が同一スキャン窓で過半に達することは稀。
 * - さらに diagnosticsState の連続失敗閾値（ESCALATION_THRESHOLD）を経て初めて
 *   バナー表示に至る（単発の一過性失敗では鳴らない）。
 *
 * 入力の集計（各コースの diagnoseCoursePage 結果を数える）は配線側の責務。
 */
export function diagnoseCourseLossAggregate(input: CourseLossAggregateInput): DiagnosticCode[] {
  if (input.lostCourseCount < 2) return []
  if (input.lostCourseCount * 2 <= input.trackedCourseCount) return []
  return ['COURSES_MAJORITY_LOST']
}

export interface AuthProbeInput {
  /** fetch がネットワーク的に成功したか（失敗はレイアウト診断の対象外） */
  fetchOk: boolean
  /** 応答HTMLに M.cfg インラインJSONが在るか（Moodleページの存在アンカー） */
  hasMcfg: boolean
  /** ログインページ/未ログイン本文/ログインへのリダイレクトを検知したか */
  hasLoginMarker: boolean
}

/**
 * 認証プローブ（既存fetchレスポンスへのpiggyback）の矛盾検知。
 * - fetch失敗はネットワーク問題＝ここでは診断しない（既存の network_error 経路の責務）。
 * - ログインマーカーは M.cfg 有無より優先する: 学外SSO/IdPのログインページ
 *   （idp.admin.tus.ac.jp / login.microsoftonline.com 等）は Moodleでない（M.cfg無し）が、
 *   それは NOT_A_MOODLE_PAGE でなく LOGGED_OUT。この検知自体は authProbe の
 *   classifyFetchedPage のURL規則（/auth/shibboleth/ 入口・非LETUSホスト着地＝logged_out）
 *   が担い、配線側が logged_out 分類を hasLoginMarker として本関数へ渡す。
 * - どちらのマーカーも無く M.cfg も欠落 → Moodle以外がLETUSオリジンで応答している
 *   （NOT_A_MOODLE_PAGE）。
 */
export function diagnoseAuthProbe(input: AuthProbeInput): DiagnosticCode[] {
  if (!input.fetchOk) return []
  if (input.hasLoginMarker) return ['LOGGED_OUT']
  if (!input.hasMcfg) return ['NOT_A_MOODLE_PAGE']
  return []
}
