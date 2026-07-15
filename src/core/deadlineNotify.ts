import {
  resolveThresholds,
  pickThresholdToNotify,
  type NotificationRules,
} from '../background/notificationRules'

export type DeadlineTarget = {
  id: string
  /** LETUS課題はコースID。手動課題など無い場合は未指定＝コース別上書き非適用。 */
  courseId?: string
  title: string
  courseName: string
  deadline: string
  url?: string
}

export type DeadlineNotification = {
  notificationId: string
  title: string
  message: string
  url?: string
  /** 通知済み管理キー（`${targetId}:${hours}h`）。呼び出し側が発火後に記録する。 */
  notifyKey: string
}

/**
 * 締切ターゲット群から「今出すべき締切通知」を導く純関数。副作用なし。
 * コース別ミュート・しきい値（通知ルール）を尊重し、通知済みキーは抑制する。
 * background と ポップアップの両方がこれを使い、締切通知の挙動を一本化する。
 */
export function computeDeadlineNotifications(
  targets: DeadlineTarget[],
  rules: NotificationRules | null,
  notifiedKeys: Set<string>,
  now: number,
): DeadlineNotification[] {
  const out: DeadlineNotification[] = []
  const seen = new Set(notifiedKeys)

  for (const t of targets) {
    const diff = new Date(t.deadline).getTime() - now
    if (diff <= 0) continue

    const thresholds = resolveThresholds(rules, t.courseId ?? '')
    if (thresholds === null) continue // ミュート

    const pick = pickThresholdToNotify(diff, thresholds, t.id, seen)
    if (!pick) continue

    seen.add(pick.notifyKey)
    out.push({
      notificationId: `task-watcher-deadline-${pick.thresholdHours}h-${t.id}`,
      title: `締切まで${pick.thresholdHours}時間以内`,
      message: `${t.title}\n${t.courseName}`,
      url: t.url,
      notifyKey: pick.notifyKey,
    })
  }

  return out
}
