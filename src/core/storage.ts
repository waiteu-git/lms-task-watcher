import type { Assignment, AssignmentCandidate, Course } from './types'

const COURSES_KEY = 'courses'
const ASSIGNMENT_CANDIDATES_KEY = 'assignmentCandidates'
const ASSIGNMENTS_KEY = 'assignments'

type CoursesStorage = {
  courses?: Course[]
}

type AssignmentCandidatesStorage = {
  assignmentCandidates?: AssignmentCandidate[]
}

type AssignmentsStorage = {
  assignments?: Assignment[]
}

export async function getCourses(): Promise<Course[]> {
  const result = (await chrome.storage.local.get(COURSES_KEY)) as CoursesStorage
  return result.courses ?? []
}

export async function saveCourses(courses: Course[]): Promise<void> {
  await chrome.storage.local.set({
    courses,
  })
}

export async function upsertCourses(newCourses: Course[]): Promise<Course[]> {
  const currentCourses = await getCourses()
  const courseMap = new Map<string, Course>()

  for (const course of currentCourses) {
    courseMap.set(course.id, course)
  }

  for (const course of newCourses) {
    const existing = courseMap.get(course.id)

    if (existing) {
      courseMap.set(course.id, {
        ...existing,
        name: course.name,
        url: course.url,
        updatedAt: course.updatedAt,
      })
    } else {
      courseMap.set(course.id, course)
    }
  }

  const mergedCourses = Array.from(courseMap.values())
  await saveCourses(mergedCourses)

  return mergedCourses
}

export async function clearCourses(): Promise<void> {
  await chrome.storage.local.remove(COURSES_KEY)
}

export async function getAssignmentCandidates(): Promise<AssignmentCandidate[]> {
  const result = (await chrome.storage.local.get(
    ASSIGNMENT_CANDIDATES_KEY,
  )) as AssignmentCandidatesStorage

  return result.assignmentCandidates ?? []
}

export async function saveAssignmentCandidates(
  assignmentCandidates: AssignmentCandidate[],
): Promise<void> {
  await chrome.storage.local.set({
    assignmentCandidates,
  })
}

export async function clearAssignmentCandidates(): Promise<void> {
  await chrome.storage.local.remove(ASSIGNMENT_CANDIDATES_KEY)
}

export async function getAssignments(): Promise<Assignment[]> {
  const result = (await chrome.storage.local.get(
    ASSIGNMENTS_KEY,
  )) as AssignmentsStorage

  return result.assignments ?? []
}

export async function saveAssignments(assignments: Assignment[]): Promise<void> {
  await chrome.storage.local.set({
    assignments,
  })
}

export async function clearAssignments(): Promise<void> {
  await chrome.storage.local.remove(ASSIGNMENTS_KEY)
}