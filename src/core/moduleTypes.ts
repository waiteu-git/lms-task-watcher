/**
 * Moodle モジュール型の許可/除外リストの単一情報源（spec§3原則5）。
 *
 * 従来 src/background/index.ts の isTargetActivityUrl / isClearlyNonAssignmentUrl に
 * 直書きされていたリストをここへ集約し、課題スキャンの対象判定と
 * 「未知モジュール型」catch-all診断（collectUnknownModuleTypes）が
 * 同じリストを参照するようにする。リストが将来増減しても両者が乖離しない。
 */

/** 常に課題候補として扱うモジュール型（scanLevel: strict） */
export const STRICT_MODULE_TYPES = [
  'assign',
  'quiz',
  'turnitintool',
  'turnitintooltwo',
] as const

/** standard で追加されるモジュール型 */
export const STANDARD_MODULE_TYPES = [
  ...STRICT_MODULE_TYPES,
  'workshop',
  'feedback',
  'choice',
  'questionnaire',
  'lti',
] as const

/** broad で追加されるモジュール型 */
export const BROAD_MODULE_TYPES = [
  ...STANDARD_MODULE_TYPES,
  'forum',
  'survey',
  'lesson',
] as const

/** 課題性が無いと確定しているモジュール型（資料系・スキャン対象外） */
export const NON_ASSIGNMENT_MODULE_TYPES = [
  'resource',
  'folder',
  'page',
  'url',
  'book',
  'label',
  'glossary',
  'wiki',
] as const

/**
 * Moodleコア標準のうち LTW がスキャン対象にしていない既知モジュール型
 * （catch-all診断の「既知化」専用・最終レビュー指摘対応）。
 *
 * これらが「未知」扱いだと、コースに1つ含まれるだけで健全な現行LETUS(4.5.8)でも
 * UNSUPPORTED_MODULE の infoノートが初日から恒久表示され、spec§8の休眠出荷方針
 * （4.5.8では表示なし）と矛盾する。コア標準型は「LETUSの画面構成が変わった兆候」
 * ではないため既知として扱う。
 *
 * NON_ASSIGNMENT_MODULE_TYPES と分ける理由: あちらは NON_ASSIGNMENT_PATHS 経由で
 * broadスキャンのキーワード判定からも除外される。scorm/h5pactivity は締切を持ち得る
 * ため除外リストへは入れず、既存のスキャン挙動（broadでのキーワード拾い上げ）を
 * 一切変えずに「未知型」誤警告だけを止める。フル対応は v1.4 のカバレッジ課題。
 */
export const KNOWN_UNSCANNED_MODULE_TYPES = [
  'chat',
  'data',
  'h5pactivity',
  'imscp',
  'scorm',
] as const

/**
 * 提出状態抽出（extractSubmissionStatus）が対応済みのモジュール型（spec§1: assign/quiz）。
 * diagnoseActivityPage の moduleSupported 判定（配線側の許可リスト）の単一情報源。
 * 対応型の状態unknownは正当なvariantがあり得るため UNSUPPORTED_MODULE を発火しない。
 */
export const STATUS_SUPPORTED_MODULE_TYPES = ['assign', 'quiz'] as const

function toViewPaths(types: readonly string[]): readonly string[] {
  return types.map((type) => `/mod/${type}/view.php`)
}

export const STRICT_MODULE_PATHS: readonly string[] = toViewPaths(STRICT_MODULE_TYPES)
export const STANDARD_MODULE_PATHS: readonly string[] = toViewPaths(STANDARD_MODULE_TYPES)
export const BROAD_MODULE_PATHS: readonly string[] = toViewPaths(BROAD_MODULE_TYPES)

/**
 * 明らかに課題でないURLの除外パス（isClearlyNonAssignmentUrl が参照）。
 * モジュール由来分は NON_ASSIGNMENT_MODULE_TYPES から導出し、二重管理を避ける。
 */
export const NON_ASSIGNMENT_PATHS: readonly string[] = [
  '/grade/',
  '/grade/report/',
  '/reportbuilder/',
  '/user/',
  '/calendar/',
  '/message/',
  '/blog/',
  '/badges/',
  '/competency/',
  '/course/report/',
  '/course/view.php',
  ...NON_ASSIGNMENT_MODULE_TYPES.map((type) => `/mod/${type}/`),
]

/** /mod/<type>/view.php の <type> セグメント（Moodle の frankenstyle 準拠: 英字始まり） */
const MOD_VIEW_URL_PATTERN = /\/mod\/([a-z][a-z0-9_]*)\/view\.php/

/**
 * URLから /mod/<type>/view.php の <type> を抽出する（大文字混じりは小文字化）。
 * マッチしなければ null（コースページ・broadキーワード由来の非view URL等）。
 * diagnoseActivityPage の moduleType 入力（診断メッセージ用）に使う。
 */
export function extractModuleType(url: string): string | null {
  const match = MOD_VIEW_URL_PATTERN.exec(url.toLowerCase())
  return match !== null ? match[1] : null
}

/** この型の提出状態抽出に対応済みか（diagnoseActivityPage の moduleSupported 入力） */
export function isStatusSupportedModuleType(moduleType: string | null): boolean {
  return (
    moduleType !== null &&
    (STATUS_SUPPORTED_MODULE_TYPES as readonly string[]).includes(moduleType)
  )
}

/**
 * catch-all診断の純関数（spec§3原則5）: /mod/<type>/view.php にマッチするのに
 * broad許可リスト・除外リスト・既知非スキャンリストのいずれにも入らない
 * モジュール型を重複排除・昇順で返す。
 *
 * 新モジュール型が LETUS に現れたとき、従来は isTargetActivityUrl が黙って落とす
 * （silent drop）だけで観測できなかった。この関数で「未対応の活動がある」事実を
 * UNSUPPORTED_MODULE 診断として浮上させる。未知型のページをスキャンしに行くことは
 * しない（パース対象は広げない＝大学向けリクエストを増やさない）。
 */
export function collectUnknownModuleTypes(urls: string[]): string[] {
  const knownTypes = new Set<string>([
    ...BROAD_MODULE_TYPES,
    ...NON_ASSIGNMENT_MODULE_TYPES,
    ...KNOWN_UNSCANNED_MODULE_TYPES,
  ])
  const unknownTypes = new Set<string>()
  for (const url of urls) {
    const match = MOD_VIEW_URL_PATTERN.exec(url.toLowerCase())
    if (match === null) continue
    if (!knownTypes.has(match[1])) unknownTypes.add(match[1])
  }
  return Array.from(unknownTypes).sort()
}
