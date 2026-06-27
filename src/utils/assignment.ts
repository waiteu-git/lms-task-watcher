import { OLD_PASSED_DAYS, ONE_DAY_MS } from '../constants'
import type { Assignment, Course } from '../core/types'
import { isWithin24Hours } from './date'

export function isOldPassedAssignment(assignment: Assignment): boolean {
  if (assignment.lifecycleStatus !== 'passed' || !assignment.deadline) {
    return false
  }

  const diff = Date.now() - new Date(assignment.deadline).getTime()

  return diff >= OLD_PASSED_DAYS * ONE_DAY_MS
}

export function isSubmittedAssignment(assignment: Assignment): boolean {
  return (
    assignment.lifecycleStatus === 'submitted' ||
    assignment.submissionStatus === 'submitted' ||
    assignment.submissionStatus === 'completed'
  )
}

export function sortByDeadline(a: Assignment, b: Assignment): number {
  const aTime = a.deadline
    ? new Date(a.deadline).getTime()
    : Number.POSITIVE_INFINITY

  const bTime = b.deadline
    ? new Date(b.deadline).getTime()
    : Number.POSITIVE_INFINITY

  return aTime - bTime
}

export function getStatusLabel(assignment: Assignment): string {
  if (assignment.lifecycleStatus === 'before_start') {
    return '開始前'
  }

  if (assignment.submissionStatus === 'completed') {
    return '完了'
  }

  if (assignment.submissionStatus === 'submitted') {
    return '提出済み'
  }

  if (assignment.lifecycleStatus === 'passed') {
    return '期限切れ'
  }

  if (assignment.submissionStatus === 'not_submitted') {
    return '未提出'
  }

  return '提出状態不明'
}

export function isAssignmentVisibleByCourse(
  assignment: Assignment,
  courses: Course[],
): boolean {
  const course = courses.find((candidate) => candidate.id === assignment.courseId)

  if (!course) {
    return true
  }

  return course.enabled
}

export function getUrgentAssignments(
  assignments: Assignment[],
  courses: Course[],
): Assignment[] {
  return assignments
    .filter((assignment) => {
      return (
        isAssignmentVisibleByCourse(assignment, courses) &&
        assignment.deadline &&
        isWithin24Hours(assignment.deadline) &&
        !isSubmittedAssignment(assignment) &&
        assignment.lifecycleStatus !== 'passed'
      )
    })
    .sort(sortByDeadline)
}
