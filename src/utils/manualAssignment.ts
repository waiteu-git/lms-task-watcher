import type { ManualAssignment } from '../core/manualAssignment'
import {
  isWithin24Hours,
  isTomorrowOrEarlierAfter24Hours,
  isWithinThisWeekAfterTomorrow,
  isLaterThanThisWeek,
} from './date'

export function sortManualByDeadline(
  a: ManualAssignment,
  b: ManualAssignment,
): number {
  return new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
}

export function getManualUrgent(items: ManualAssignment[]): ManualAssignment[] {
  return items
    .filter((item) => !item.submitted && isWithin24Hours(item.deadline))
    .sort(sortManualByDeadline)
}

export function getManualTomorrow(items: ManualAssignment[]): ManualAssignment[] {
  return items
    .filter((item) => !item.submitted && isTomorrowOrEarlierAfter24Hours(item.deadline))
    .sort(sortManualByDeadline)
}

export function getManualThisWeek(items: ManualAssignment[]): ManualAssignment[] {
  return items
    .filter((item) => !item.submitted && isWithinThisWeekAfterTomorrow(item.deadline))
    .sort(sortManualByDeadline)
}

export function getManualLater(items: ManualAssignment[]): ManualAssignment[] {
  return items
    .filter((item) => !item.submitted && isLaterThanThisWeek(item.deadline))
    .sort(sortManualByDeadline)
}

export function getManualSubmitted(items: ManualAssignment[]): ManualAssignment[] {
  return items.filter((item) => item.submitted).sort(sortManualByDeadline)
}
