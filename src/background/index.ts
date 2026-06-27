import type {
  Assignment,
  AssignmentCandidate,
  AssignmentLifecycleStatus,
  AssignmentSubmissionStatus,
  Course,
} from '../core/types'
import {
  ASSIGNMENT_CANDIDATES_KEY,
  ASSIGNMENT_SCAN_STATUS_KEY,
  ASSIGNMENTS_KEY,
  COURSES_KEY,
  DEADLINE_SCAN_STATUS_KEY,
  IGNORED_ASSIGNMENT_IDS_KEY,
  LAST_REFRESH_AT_KEY,
  NOTIFIED_DEADLINE_KEYS_KEY,
} from './storageKeys'
import type { AssignmentScanStatus, DeadlineScanStatus } from '../core/scanStatus'

console.log('[LETUS Task Watcher] background service worker loaded')

// ─── State ───────────────────────────────────────────────────────────────────

let isAssignmentScanning = false
let isDeadlineScanning = false

// ─── Utilities ───────────────────────────────────────────────────────────────

function normalizeText(text: unknown): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ')
}

function createId(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

function createAssignmentCandidateId(courseId: string, url: string): string {
  return createId(`${courseId}:${url}`)
}

function stripTags(html: string): string {
  return normalizeText(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' '),
  )
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  }
  return String(text).replace(
    /&(amp|lt|gt|quot|#39|nbsp);/g,
    (match) => entities[match] ?? match,
  )
}

function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    stripTags(
      String(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/th>/gi, ' ')
        .replace(/<\/td>/gi, ' '),
    ),
  )
}

function extractLinksFromHtml(
  html: string,
  baseUrl: string,
): { title: string; url: string }[] {
  const links: { title: string; url: string }[] = []
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1]
    const innerHtml = match[2]

    if (!href) continue

    try {
      const url = new URL(href, baseUrl).toString().split('#')[0]
      const title = decodeHtmlEntities(stripTags(innerHtml))
      if (title.length > 0) {
        links.push({ title, url })
      }
    } catch {
      // URL変換失敗は無視
    }
  }

  return links
}

// ─── Concurrency helper ───────────────────────────────────────────────────────

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<R | null | undefined>,
  onProgress?: (completed: number, item: T, results: R[]) => Promise<void>,
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  let completed = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      const item = items[currentIndex]
      const result = await handler(item, currentIndex)

      if (result !== undefined && result !== null) {
        if (Array.isArray(result)) {
          results.push(...result)
        } else {
          results.push(result)
        }
      }

      completed += 1
      await onProgress?.(completed, item, results)
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return results
}

// ─── Assignment candidate detection ──────────────────────────────────────────

type ScanLevel = 'strict' | 'standard' | 'broad'

function isTargetActivityUrl(url: string, scanLevel: ScanLevel): boolean {
  const normalizedUrl = url.toLowerCase()

  const strictModulePaths = [
    '/mod/assign/view.php',
    '/mod/quiz/view.php',
    '/mod/turnitintool/view.php',
    '/mod/turnitintooltwo/view.php',
  ]

  const standardModulePaths = [
    ...strictModulePaths,
    '/mod/workshop/view.php',
    '/mod/feedback/view.php',
    '/mod/choice/view.php',
    '/mod/questionnaire/view.php',
    '/mod/lti/view.php',
  ]

  const broadModulePaths = [
    ...standardModulePaths,
    '/mod/forum/view.php',
    '/mod/survey/view.php',
    '/mod/lesson/view.php',
  ]

  if (scanLevel === 'strict') {
    return strictModulePaths.some((path) => normalizedUrl.includes(path))
  }
  if (scanLevel === 'broad') {
    return broadModulePaths.some((path) => normalizedUrl.includes(path))
  }
  return standardModulePaths.some((path) => normalizedUrl.includes(path))
}

function isClearlyNonAssignmentUrl(url: string): boolean {
  const normalizedUrl = url.toLowerCase()
  const excludedPaths = [
    '/grade/',
    '/grade/report/',
    '/reportbuilder/',
    '/user/',
    '/calendar/',
    '/message/',
    '/blog/',
    '/badges/',
    '/competency/',
    '/course/report/',
    '/course/view.php',
    '/mod/resource/',
    '/mod/folder/',
    '/mod/page/',
    '/mod/url/',
    '/mod/book/',
    '/mod/label/',
    '/mod/glossary/',
    '/mod/wiki/',
  ]
  return excludedPaths.some((path) => normalizedUrl.includes(path))
}

function hasAssignmentKeyword(text: string, url: string): boolean {
  const normalizedText = normalizeText(text).toLowerCase()
  const normalizedUrl = url.toLowerCase()
  const keywords = [
    '課題', '提出', 'レポート', '小テスト', '確認テスト', 'テスト',
    'アンケート', '回答', '投稿',
    'assignment', 'assign', 'report', 'quiz', 'test',
    'questionnaire', 'feedback', 'workshop', 'turnitin',
  ]
  return keywords.some((keyword) => {
    const lowerKeyword = keyword.toLowerCase()
    return normalizedText.includes(lowerKeyword) || normalizedUrl.includes(lowerKeyword)
  })
}

function isAssignmentLikeLink(text: string, url: string, scanLevel: ScanLevel): boolean {
  const normalizedText = normalizeText(text)
  if (normalizedText.length < 2 || normalizedText.length > 220) return false
  if (isClearlyNonAssignmentUrl(url)) return false
  if (isTargetActivityUrl(url, scanLevel)) return true
  if (scanLevel === 'broad') return hasAssignmentKeyword(normalizedText, url)
  return false
}

// ─── Deadline parsing ─────────────────────────────────────────────────────────

function toIsoStringFromParts(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
): string | null {
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  )
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function extractDeadlineText(plainText: string): string {
  const text = normalizeText(plainText)
  const deadlineKeywords = [
    '提出期限', '提出締切', '締切日時', '締切', '期限', '終了予定', '終了日時',
    '利用終了日時', '受験終了', '回答終了',
    'Due date', 'Closing date', 'Close date', 'Closes', 'Due', 'Close',
  ]
  const startKeywords = [
    '開始予定', '開始日時', '開始', '利用開始日時', '受験開始', '公開日時', '公開',
    'Open date', 'Opened', 'Available from',
  ]
  const lowerText = text.toLowerCase()
  let bestIndex = -1

  for (const keyword of deadlineKeywords) {
    const index = lowerText.indexOf(keyword.toLowerCase())
    if (index >= 0 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index
    }
  }

  if (bestIndex >= 0) {
    return text.slice(bestIndex, Math.min(text.length, bestIndex + 320))
  }

  const hasStartOnlyKeyword = startKeywords.some((keyword) =>
    lowerText.includes(keyword.toLowerCase()),
  )
  if (hasStartOnlyKeyword) return ''
  return ''
}

function parseDeadline(deadlineText: string): string | null {
  const text = normalizeText(deadlineText)

  const japaneseDateMatch = text.match(
    /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[(（][^)）]*[)）])?\s*(?:(\d{1,2})\s*(?:時|:|：)\s*(\d{1,2})?\s*分?)?/,
  )
  if (japaneseDateMatch) {
    const hasHour = japaneseDateMatch[4] !== undefined
    return toIsoStringFromParts(
      japaneseDateMatch[1],
      japaneseDateMatch[2],
      japaneseDateMatch[3],
      hasHour ? japaneseDateMatch[4] : '23',
      hasHour ? (japaneseDateMatch[5] ?? '00') : '59',
    )
  }

  const noYearJapaneseDateMatch = text.match(
    /(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[(（][^)）]*[)）])?\s*(?:(\d{1,2})\s*(?:時|:|：)\s*(\d{1,2})?\s*分?)?/,
  )
  if (noYearJapaneseDateMatch) {
    const currentYear = String(new Date().getFullYear())
    const hasHour = noYearJapaneseDateMatch[3] !== undefined
    return toIsoStringFromParts(
      currentYear,
      noYearJapaneseDateMatch[1],
      noYearJapaneseDateMatch[2],
      hasHour ? noYearJapaneseDateMatch[3] : '23',
      hasHour ? (noYearJapaneseDateMatch[4] ?? '00') : '59',
    )
  }

  return null
}

// ─── Submission & lifecycle status ────────────────────────────────────────────

function extractSubmissionStatus(
  plainText: string,
  url: string,
): AssignmentSubmissionStatus {
  const text = normalizeText(plainText).toLowerCase()
  const isQuiz = url.toLowerCase().includes('/mod/quiz/')

  if (isQuiz) {
    if (text.includes('ステータス 終了') || text.includes('status finished')) {
      return 'completed'
    }
    if (text.includes('受験済み') || text.includes('attempt finished')) {
      return 'completed'
    }
    if (
      text.includes('利用できません') ||
      text.includes('not available') ||
      text.includes('未受験') ||
      text.includes('not attempted')
    ) {
      return 'not_submitted'
    }
    return 'unknown'
  }

  if (text.includes('提出済み') || text.includes('submitted')) {
    return 'submitted'
  }
  if (text.includes('未提出') || text.includes('not submitted')) {
    return 'not_submitted'
  }
  return 'unknown'
}

function isBeforeStart(plainText: string): boolean {
  const text = normalizeText(plainText)
  return text.includes('開始予定') && text.includes('利用できません')
}

function isDeadlinePassed(deadline: string | null): boolean {
  if (!deadline) return false
  const date = new Date(deadline)
  if (Number.isNaN(date.getTime())) return false
  return date.getTime() < Date.now()
}

function resolveLifecycleStatus(
  plainText: string,
  submissionStatus: AssignmentSubmissionStatus,
  deadline: string | null,
): AssignmentLifecycleStatus {
  if (isBeforeStart(plainText)) return 'before_start'
  if (submissionStatus === 'submitted' || submissionStatus === 'completed') return 'submitted'
  if (isDeadlinePassed(deadline)) return 'passed'
  return 'active'
}

// ─── Storage ──────────────────────────────────────────────────────────────────

async function getCourses(): Promise<Course[]> {
  const result = await chrome.storage.local.get(COURSES_KEY)
  return (result[COURSES_KEY] as Course[] | undefined) ?? []
}

async function saveCourses(courses: Course[]): Promise<void> {
  await chrome.storage.local.set({ [COURSES_KEY]: courses })
}

async function upsertCourses(newCourses: Course[]): Promise<void> {
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

  await saveCourses(Array.from(courseMap.values()))
}

async function getAssignmentCandidates(): Promise<AssignmentCandidate[]> {
  const result = await chrome.storage.local.get(ASSIGNMENT_CANDIDATES_KEY)
  return (result[ASSIGNMENT_CANDIDATES_KEY] as AssignmentCandidate[] | undefined) ?? []
}

async function saveAssignmentCandidates(candidates: AssignmentCandidate[]): Promise<void> {
  await chrome.storage.local.set({ [ASSIGNMENT_CANDIDATES_KEY]: candidates })
}

async function saveAssignments(assignments: Assignment[]): Promise<void> {
  await chrome.storage.local.set({ [ASSIGNMENTS_KEY]: assignments })
}

async function saveAssignmentScanStatus(status: AssignmentScanStatus): Promise<void> {
  await chrome.storage.local.set({ [ASSIGNMENT_SCAN_STATUS_KEY]: status })
}

async function saveDeadlineScanStatus(status: DeadlineScanStatus): Promise<void> {
  await chrome.storage.local.set({ [DEADLINE_SCAN_STATUS_KEY]: status })
}

// ─── Notifications ────────────────────────────────────────────────────────────

const NOTIFICATION_TARGETS_KEY = 'notificationTargets'

async function getNotificationTargets(): Promise<Record<string, string>> {
  const result = await chrome.storage.local.get(NOTIFICATION_TARGETS_KEY)
  return (result[NOTIFICATION_TARGETS_KEY] as Record<string, string> | undefined) ?? {}
}

async function saveNotificationTarget(notificationId: string, url: string): Promise<void> {
  const targets = await getNotificationTargets()
  await chrome.storage.local.set({
    [NOTIFICATION_TARGETS_KEY]: { ...targets, [notificationId]: url },
  })
}

async function removeNotificationTarget(notificationId: string): Promise<void> {
  const targets = await getNotificationTargets()
  delete targets[notificationId]
  await chrome.storage.local.set({ [NOTIFICATION_TARGETS_KEY]: targets })
}

async function createNotification(params: {
  id: string
  title: string
  message: string
  url?: string
}): Promise<void> {
  if (params.url) {
    await saveNotificationTarget(params.id, params.url)
  }
  chrome.notifications.create(params.id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: params.title,
    message: params.message,
    priority: 2,
  })
}

function isWithin24Hours(deadline: string | null): boolean {
  if (!deadline) return false
  const diff = new Date(deadline).getTime() - Date.now()
  return diff > 0 && diff <= 24 * 60 * 60 * 1000
}

function isSubmitted(assignment: Assignment): boolean {
  return (
    assignment.lifecycleStatus === 'submitted' ||
    assignment.submissionStatus === 'submitted' ||
    assignment.submissionStatus === 'completed'
  )
}

async function notifyDeadlineSummary(assignments: Assignment[]): Promise<void> {
  const urgentAssignments = assignments.filter(
    (a) => isWithin24Hours(a.deadline) && !isSubmitted(a) && a.lifecycleStatus !== 'passed',
  )

  if (urgentAssignments.length === 0) {
    chrome.notifications.create('task-watcher-refresh-completed', {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'LETUS Task Watcher',
      message: '更新が完了しました。24時間以内の未提出課題はありません。',
      priority: 1,
    })
    return
  }

  const first = urgentAssignments[0]
  await createNotification({
    id: `task-watcher-urgent-${first.id}`,
    title: `24時間以内の課題: ${urgentAssignments.length}件`,
    message: `${first.title}\n${first.courseName}`,
    url: first.url,
  })
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const targets = await getNotificationTargets()
  const url = targets[notificationId]
  if (url) chrome.tabs.create({ url })
  await removeNotificationTarget(notificationId)
  chrome.notifications.clear(notificationId)
})

chrome.notifications.onClosed.addListener(async (notificationId) => {
  await removeNotificationTarget(notificationId)
})

// ─── Assignment scan ──────────────────────────────────────────────────────────

async function scanAssignmentCandidatesInBackground(
  scanLevel: ScanLevel = 'standard',
): Promise<{ ok: boolean; reason?: string; detectedCount?: number; errorMessage?: string }> {
  if (isAssignmentScanning) return { ok: false, reason: 'already_running' }

  isAssignmentScanning = true
  const startedAt = new Date().toISOString()
  const courses = await getCourses()
  const enabledCourses = courses.filter((c) => c.enabled)
  const assignmentMap = new Map<string, AssignmentCandidate>()

  await saveAssignmentCandidates([])
  await saveAssignmentScanStatus({
    state: 'running',
    startedAt,
    finishedAt: null,
    totalCourses: enabledCourses.length,
    completedCourses: 0,
    currentCourseName: '開始準備中...',
    detectedCount: 0,
    errorMessage: null,
  })

  try {
    await mapWithConcurrency(
      enabledCourses,
      3,
      async (course) => {
        const response = await fetch(course.url, { credentials: 'include' })
        if (!response.ok) return null

        const html = await response.text()
        const links = extractLinksFromHtml(html, course.url)

        for (const link of links) {
          const title = normalizeText(link.title)
          if (!isAssignmentLikeLink(title, link.url, scanLevel)) continue

          const id = createAssignmentCandidateId(course.id, link.url)
          if (!assignmentMap.has(id)) {
            assignmentMap.set(id, {
              id,
              courseId: course.id,
              courseName: course.name,
              title,
              url: link.url,
              sourceText: title,
              detectedAt: startedAt,
            })
          }
        }

        return null
      },
      async (completed, course) => {
        await saveAssignmentCandidates(Array.from(assignmentMap.values()))
        await saveAssignmentScanStatus({
          state: 'running',
          startedAt,
          finishedAt: null,
          totalCourses: enabledCourses.length,
          completedCourses: completed,
          currentCourseName: course.name,
          detectedCount: assignmentMap.size,
          errorMessage: null,
        })
      },
    )

    const finishedAt = new Date().toISOString()
    const assignmentCandidates = Array.from(assignmentMap.values())

    await saveAssignmentCandidates(assignmentCandidates)
    await saveAssignmentScanStatus({
      state: 'completed',
      startedAt,
      finishedAt,
      totalCourses: enabledCourses.length,
      completedCourses: enabledCourses.length,
      currentCourseName: '',
      detectedCount: assignmentCandidates.length,
      errorMessage: null,
    })

    return { ok: true, detectedCount: assignmentCandidates.length }
  } catch (error) {
    await saveAssignmentScanStatus({
      state: 'error',
      startedAt,
      finishedAt: new Date().toISOString(),
      totalCourses: enabledCourses.length,
      completedCourses: 0,
      currentCourseName: '',
      detectedCount: assignmentMap.size,
      errorMessage: String(error),
    })
    return { ok: false, reason: 'error', errorMessage: String(error) }
  } finally {
    isAssignmentScanning = false
  }
}

// ─── Deadline scan ────────────────────────────────────────────────────────────

async function scanDeadlinesInBackground(): Promise<{
  ok: boolean
  reason?: string
  detectedCount?: number
  errorMessage?: string
}> {
  if (isDeadlineScanning) return { ok: false, reason: 'already_running' }

  isDeadlineScanning = true
  const startedAt = new Date().toISOString()
  const candidates = await getAssignmentCandidates()
  const assignments: Assignment[] = []

  await saveAssignments([])
  await saveDeadlineScanStatus({
    state: 'running',
    startedAt,
    finishedAt: null,
    totalItems: candidates.length,
    completedItems: 0,
    currentItemTitle: '開始準備中...',
    detectedCount: 0,
    errorMessage: null,
  })

  try {
    await mapWithConcurrency(
      candidates,
      5,
      async (candidate) => {
        const response = await fetch(candidate.url, { credentials: 'include' })
        if (!response.ok) return null

        const html = await response.text()
        const plainText = htmlToPlainText(html)
        const deadlineText = extractDeadlineText(plainText)
        const deadline = deadlineText ? parseDeadline(deadlineText) : null
        const submissionStatus = extractSubmissionStatus(plainText, candidate.url)
        const lifecycleStatus = resolveLifecycleStatus(plainText, submissionStatus, deadline)
        const now = new Date().toISOString()

        return {
          id: candidate.id,
          courseId: candidate.courseId,
          courseName: candidate.courseName,
          title: candidate.title,
          url: candidate.url,
          deadline,
          deadlineText: deadlineText ?? '',
          sourceText: plainText.slice(0, 1200),
          submissionStatus,
          lifecycleStatus,
          detectedAt: candidate.detectedAt,
          firstSeenAt: now,
          lastSeenAt: now,
          lastCheckedAt: now,
        } satisfies Assignment
      },
      async (completed, candidate, results) => {
        assignments.length = 0
        assignments.push(...results)

        await saveAssignments(assignments)
        await saveDeadlineScanStatus({
          state: 'running',
          startedAt,
          finishedAt: null,
          totalItems: candidates.length,
          completedItems: completed,
          currentItemTitle: candidate.title,
          detectedCount: results.filter((a) => a.deadline !== null).length,
          errorMessage: null,
        })
      },
    )

    const finishedAt = new Date().toISOString()
    const detectedCount = assignments.filter((a) => a.deadline !== null).length

    await saveAssignments(assignments)
    await notifyDeadlineSummary(assignments)
    await saveDeadlineScanStatus({
      state: 'completed',
      startedAt,
      finishedAt,
      totalItems: candidates.length,
      completedItems: candidates.length,
      currentItemTitle: '',
      detectedCount,
      errorMessage: null,
    })

    return { ok: true, detectedCount }
  } catch (error) {
    await saveDeadlineScanStatus({
      state: 'error',
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItems: candidates.length,
      completedItems: 0,
      currentItemTitle: '',
      detectedCount: assignments.filter((a) => a.deadline !== null).length,
      errorMessage: String(error),
    })
    return { ok: false, reason: 'error', errorMessage: String(error) }
  } finally {
    isDeadlineScanning = false
  }
}

// ─── Additional storage helpers ──────────────────────────────────────────────

async function getAssignments(): Promise<Assignment[]> {
  const result = await chrome.storage.local.get(ASSIGNMENTS_KEY)
  return (result[ASSIGNMENTS_KEY] as Assignment[] | undefined) ?? []
}

async function getIgnoredAssignmentIds(): Promise<string[]> {
  const result = await chrome.storage.local.get(IGNORED_ASSIGNMENT_IDS_KEY)
  return (result[IGNORED_ASSIGNMENT_IDS_KEY] as string[] | undefined) ?? []
}

async function getNotifiedDeadlineKeys(): Promise<string[]> {
  const result = await chrome.storage.local.get(NOTIFIED_DEADLINE_KEYS_KEY)
  return (result[NOTIFIED_DEADLINE_KEYS_KEY] as string[] | undefined) ?? []
}

async function saveNotifiedDeadlineKeys(keys: string[]): Promise<void> {
  await chrome.storage.local.set({ [NOTIFIED_DEADLINE_KEYS_KEY]: keys })
}

async function saveLastRefreshAt(value: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_REFRESH_AT_KEY]: value })
}

// ─── Deadline warning notifications (1h / 3h / 24h) ─────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000
const THREE_HOURS_MS = 3 * ONE_HOUR_MS
const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS

async function checkDeadlineWarningNotifications(): Promise<void> {
  const [assignments, ignoredIds, notifiedKeys] = await Promise.all([
    getAssignments(),
    getIgnoredAssignmentIds(),
    getNotifiedDeadlineKeys(),
  ])

  const ignoredSet = new Set(ignoredIds)
  const notifiedSet = new Set(notifiedKeys)
  const nextNotifiedKeys = new Set(notifiedKeys)
  let changed = false

  const targets = assignments.filter(
    (a) =>
      !ignoredSet.has(a.id) &&
      a.deadline !== null &&
      a.lifecycleStatus !== 'passed' &&
      a.lifecycleStatus !== 'submitted' &&
      a.submissionStatus !== 'submitted' &&
      a.submissionStatus !== 'completed',
  )

  for (const assignment of targets) {
    if (!assignment.deadline) continue

    const diff = new Date(assignment.deadline).getTime() - Date.now()
    if (diff <= 0) continue

    const key1h = `${assignment.id}:1h`
    const key3h = `${assignment.id}:3h`
    const key24h = `${assignment.id}:24h`

    if (diff <= ONE_HOUR_MS && !notifiedSet.has(key1h)) {
      await createNotification({
        id: `task-watcher-deadline-1h-${assignment.id}-${Date.now()}`,
        title: '締切まで1時間以内',
        message: `${assignment.title}\n${assignment.courseName}`,
        url: assignment.url,
      })
      nextNotifiedKeys.add(key1h)
      changed = true
    } else if (diff <= THREE_HOURS_MS && !notifiedSet.has(key3h)) {
      await createNotification({
        id: `task-watcher-deadline-3h-${assignment.id}-${Date.now()}`,
        title: '締切まで3時間以内',
        message: `${assignment.title}\n${assignment.courseName}`,
        url: assignment.url,
      })
      nextNotifiedKeys.add(key3h)
      changed = true
    } else if (diff <= TWENTY_FOUR_HOURS_MS && !notifiedSet.has(key24h)) {
      await createNotification({
        id: `task-watcher-deadline-24h-${assignment.id}-${Date.now()}`,
        title: '締切まで24時間以内',
        message: `${assignment.title}\n${assignment.courseName}`,
        url: assignment.url,
      })
      nextNotifiedKeys.add(key24h)
      changed = true
    }
  }

  if (changed) {
    await saveNotifiedDeadlineKeys(Array.from(nextNotifiedKeys))
  }
}

// ─── Alarm-based auto scan ────────────────────────────────────────────────────

const ALARM_NAME = 'auto-scan'
const ALARM_PERIOD_MINUTES = 120

async function runAutoScan(): Promise<void> {
  const courses = await getCourses()
  const hasEnabledCourse = courses.some((c) => c.enabled)

  if (!hasEnabledCourse) return

  await scanAssignmentCandidatesInBackground('standard')
  await scanDeadlinesInBackground()

  await saveLastRefreshAt(new Date().toISOString())
  await checkDeadlineWarningNotifications()
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: ALARM_PERIOD_MINUTES,
    periodInMinutes: ALARM_PERIOD_MINUTES,
  })
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm) {
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: ALARM_PERIOD_MINUTES,
        periodInMinutes: ALARM_PERIOD_MINUTES,
      })
    }
  })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return

  runAutoScan().catch((error) => {
    console.error('[LETUS Task Watcher] auto scan failed', error)
  })
})

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[LETUS Task Watcher] received message', message)

  if (message?.type === 'UPSERT_COURSES') {
    const courses = (message.courses ?? []) as Course[]
    sendResponse({ ok: true, count: courses.length })
    upsertCourses(courses).catch((error) => {
      console.error('[LETUS Task Watcher] upsertCourses failed', error)
    })
    return false
  }

  if (message?.type === 'START_ASSIGNMENT_SCAN') {
    if (isAssignmentScanning) {
      sendResponse({ ok: false, reason: 'already_running' })
      return false
    }
    sendResponse({ ok: true, reason: 'started' })
    const scanLevel = (message.scanLevel ?? 'standard') as ScanLevel
    scanAssignmentCandidatesInBackground(scanLevel).catch((error) => {
      console.error('[LETUS Task Watcher] assignment scan failed', error)
    })
    return false
  }

  if (message?.type === 'START_DEADLINE_SCAN') {
    if (isDeadlineScanning) {
      sendResponse({ ok: false, reason: 'already_running' })
      return false
    }
    sendResponse({ ok: true, reason: 'started' })
    scanDeadlinesInBackground().catch((error) => {
      console.error('[LETUS Task Watcher] deadline scan failed', error)
    })
    return false
  }

  return false
})

export {}
