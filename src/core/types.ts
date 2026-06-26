export type Course = {
  id: string
  name: string
  url: string
  enabled: boolean
  lmsType: 'unknown' | 'letus' | 'moodle' | 'manaba' | 'webclass' | 'generic'
  createdAt: string
  updatedAt: string
}

export type AssignmentCandidate = {
  id: string
  courseId: string
  courseName: string
  title: string
  url: string
  sourceText: string
  detectedAt: string
}

export type AssignmentSubmissionStatus =
  | 'unknown'
  | 'not_submitted'
  | 'submitted'
  | 'completed'

export type AssignmentLifecycleStatus =
  | 'active'
  | 'new'
  | 'changed'
  | 'before_start'
  | 'submitted'
  | 'passed'
  | 'missing'
  | 'archived'

export type Assignment = {
  id: string
  courseId: string
  courseName: string
  title: string
  url: string
  deadline: string | null
  deadlineText: string
  sourceText: string
  submissionStatus: AssignmentSubmissionStatus
  lifecycleStatus: AssignmentLifecycleStatus
  detectedAt: string
  firstSeenAt: string
  lastSeenAt: string
  lastCheckedAt: string
}