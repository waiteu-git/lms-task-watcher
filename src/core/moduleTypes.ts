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
 * catch-all診断の純関数（spec§3原則5）: /mod/<type>/view.php にマッチするのに
 * broad許可リストにも除外リストにも入らないモジュール型を重複排除・昇順で返す。
 *
 * 新モジュール型が LETUS に現れたとき、従来は isTargetActivityUrl が黙って落とす
 * （silent drop）だけで観測できなかった。この関数で「未対応の活動がある」事実を
 * UNSUPPORTED_MODULE 診断として浮上させる。未知型のページをスキャンしに行くことは
 * しない（パース対象は広げない＝大学向けリクエストを増やさない）。
 */
export function collectUnknownModuleTypes(urls: string[]): string[] {
  const knownTypes = new Set<string>([...BROAD_MODULE_TYPES, ...NON_ASSIGNMENT_MODULE_TYPES])
  const unknownTypes = new Set<string>()
  for (const url of urls) {
    const match = MOD_VIEW_URL_PATTERN.exec(url.toLowerCase())
    if (match === null) continue
    if (!knownTypes.has(match[1])) unknownTypes.add(match[1])
  }
  return Array.from(unknownTypes).sort()
}
