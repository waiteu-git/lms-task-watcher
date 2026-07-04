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
export function resolveThresholds(
  rules: NotificationRules | null,
  courseId: string,
  subscriptionActive: boolean,
): number[] | null {
  if (!subscriptionActive || !rules) return DEFAULT_THRESHOLDS

  const override = rules.courseOverrides[courseId]
  if (override) {
    if (override.muted) return null
    return override.thresholds
  }
  return rules.defaultThresholds
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
