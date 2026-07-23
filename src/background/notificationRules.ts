export type CourseOverride = {
  muted: boolean
  thresholds: number[]
}

export type NotificationRules = {
  version: 1
  defaultThresholds: number[]
  courseOverrides: Record<string, CourseOverride>
}

export const DEFAULT_THRESHOLDS: number[] = [1, 3, 24]

// コースに適用するしきい値（時間）を解決する。muted なら null（= 通知しない）。
// 通知ルールはローカル保存の無料機能。以前あった subscriptionActive ゲートは、
// バックエンド凍結後に常に false となりミュート/カスタム値を殺していたため撤去した。
export function resolveThresholds(
  rules: NotificationRules | null,
  courseId: string,
): number[] | null {
  if (!rules) return DEFAULT_THRESHOLDS

  const override = rules.courseOverrides[courseId]
  if (override) {
    if (override.muted) return null
    return override.thresholds
  }
  return rules.defaultThresholds
}

// コース内容の更新通知（追加された教材/課題の Chrome 通知）を出すべきか。
// 全体トグルが off、または当該コースがミュートされていれば通知しない。
// 表示（NEWバッジ・履歴）は呼び出し側で別途維持する（ここは通知の可否のみ）。
export function shouldNotifyCourseUpdate(
  rules: NotificationRules | null,
  courseId: string,
  globalEnabled: boolean,
): boolean {
  if (!globalEnabled) return false
  return rules?.courseOverrides[courseId]?.muted !== true
}

// 締切までの残差(ms)に対し、発火すべき最小の未通知しきい値を返す（無ければ null）。
export function pickThresholdToNotify(
  diffMs: number,
  thresholds: number[],
  targetId: string,
  notifiedKeys: Set<string>,
): { thresholdHours: number; notifyKey: string } | null {
  const sorted = [...thresholds].sort((a, b) => a - b)
  for (const hours of sorted) {
    const thresholdMs = hours * 60 * 60 * 1000
    if (diffMs <= thresholdMs) {
      const notifyKey = `${targetId}:${hours}h`
      if (!notifiedKeys.has(notifyKey)) {
        return { thresholdHours: hours, notifyKey }
      }
    }
  }
  return null
}
