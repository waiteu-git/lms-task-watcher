import type { Assignment } from './types'
import type { ManualAssignment } from './manualAssignment'

/**
 * `utils/assignment` の `isSubmittedAssignment` と同じ判定。
 * このモジュールは content script から読まれる。content script は classic script として実行されるため
 * import 文が残ってはならず（vite.config.ts 参照）、popup と実行時モジュールを共有すると
 * Rollup が共有チャンクに切り出して content.js に import が残る。よって判定を持ち込む。
 */
function isSubmitted(assignment: Assignment): boolean {
  return (
    assignment.lifecycleStatus === 'submitted' ||
    assignment.submissionStatus === 'submitted' ||
    assignment.submissionStatus === 'completed'
  )
}

/**
 * LETUSページ上の課題リンクに付けるバッジの状態。
 * content script のDOM描画から状態決定を切り離し、ストレージ更新のたびに再計算して差分描画できるようにする。
 */
export type BadgeState =
  | { kind: 'scanned'; submitted: boolean; deadline: string | null }
  | { kind: 'manual'; id: string; submitted: boolean; deadline: string }
  | { kind: 'unadded' }

export function normalizeAssignmentUrl(url: string): string {
  return url.split('#')[0]
}

/** リンク先URLに対応するバッジ状態を決める。スキャン済み課題を手動課題より優先する。 */
export function computeBadgeState(
  url: string,
  assignments: Assignment[],
  manualAssignments: ManualAssignment[],
): BadgeState {
  const target = normalizeAssignmentUrl(url)

  const scanned = assignments.find((a) => a.url && normalizeAssignmentUrl(a.url) === target)
  if (scanned) {
    return { kind: 'scanned', submitted: isSubmitted(scanned), deadline: scanned.deadline }
  }

  const manual = manualAssignments.find((a) => a.letusUrl && normalizeAssignmentUrl(a.letusUrl) === target)
  if (manual) {
    return { kind: 'manual', id: manual.id, submitted: manual.submitted, deadline: manual.deadline }
  }

  return { kind: 'unadded' }
}

/** バッジ状態が同じなら再描画不要。 */
export function isSameBadgeState(a: BadgeState, b: BadgeState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
