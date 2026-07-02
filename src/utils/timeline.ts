import type { Assignment } from '../core/types'
import type { ManualAssignment } from '../core/manualAssignment'

export type TimelineItem =
  | { kind: 'scan'; assignment: Assignment }
  | { kind: 'manual'; assignment: ManualAssignment }

function getDeadlineTime(item: TimelineItem): number {
  const deadline = item.assignment.deadline
  return deadline ? new Date(deadline).getTime() : Number.POSITIVE_INFINITY
}

export function mergeTimeline(
  scanItems: Assignment[],
  manualItems: ManualAssignment[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...scanItems.map((assignment): TimelineItem => ({ kind: 'scan', assignment })),
    ...manualItems.map((assignment): TimelineItem => ({ kind: 'manual', assignment })),
  ]

  return items.sort((a, b) => getDeadlineTime(a) - getDeadlineTime(b))
}
