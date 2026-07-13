import type { Course } from './types'

/**
 * ポップアップのオンボーディング（初回チュートリアル）で今どのステップを案内すべきかを、
 * 状態から導く純関数。UI からステップ判定を分離してユニットテスト可能にする。
 *
 * 優先順位は「時間割取込 → LETUSコース登録 → コース選択 → 更新」。
 * 時間割はチュートリアルの先頭に置く方針のため、コースが登録済みでも
 * 時間割が未取込のあいだは timetable を最優先で返す。
 */
export type OnboardingStep = 'timetable' | 'letus' | 'dashboard' | 'update'

/** 表示順（＝「N / 4」の N を導くための並び）。timetable が先頭。 */
export const ONBOARDING_STEP_ORDER: OnboardingStep[] = [
  'timetable',
  'letus',
  'dashboard',
  'update',
]

export function resolveOnboardingStep(
  hasTimetable: boolean,
  courses: Course[],
): OnboardingStep {
  if (!hasTimetable) return 'timetable'
  if (courses.length === 0) return 'letus'
  if (courses.filter((c) => c.enabled).length === 0) return 'dashboard'
  return 'update'
}
