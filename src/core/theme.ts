export type ThemeSetting = 'auto' | 'default' | 'dark'
export type EffectiveTheme = 'default' | 'dark'

/**
 * 保存されたテーマ設定と OS のダーク志向から、実際に適用する見た目を導く純関数。
 * - 'dark' / 'default'（ライト）は OS に関係なく固定
 * - 'auto' は OS の prefers-color-scheme に追従
 * - 未知の値は 'default'（ライト）にフォールバック
 * 適用側は結果を `data-theme` 属性に張る（CSS: :root=ライト / [data-theme="dark"]=ダーク）。
 */
export function resolveEffectiveTheme(stored: string, systemPrefersDark: boolean): EffectiveTheme {
  if (stored === 'dark') return 'dark'
  if (stored === 'auto') return systemPrefersDark ? 'dark' : 'default'
  return 'default'
}
