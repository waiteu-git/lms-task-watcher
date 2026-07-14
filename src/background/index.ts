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
  NOTIFICATION_TARGETS_KEY,
  TERMS_CONSENT_KEY,
  WELCOME_GUIDE_SHOWN_KEY,
} from './storageKeys'
import { isConsented } from '../legal/termsConsent'
import type { AssignmentScanStatus, DeadlineScanStatus } from '../core/scanStatus'
import { getManualAssignments } from '../core/manualAssignment'
import { getAuthToken, isSubscriptionActive } from '../core/auth'
import { getNotificationRules, getCourseUpdateNotifyEnabled } from '../core/premium'
import { extractDeadlineText, parseDeadline, parseDeadlineFromTitle } from './deadlineParser'
import { shouldNotifyCourseUpdate } from './notificationRules'
import { computeDeadlineNotifications, type DeadlineTarget } from '../core/deadlineNotify'
import { normalizeText, stripTags, decodeHtmlEntities } from '../core/htmlText'
import { extractLinksFromHtml } from '../core/letusLinks'
import { computeCourseUpdate } from '../core/courseUpdates'
import { getCourseSignature, saveCourseSignature, addUnreadUpdates } from './courseUpdatesStore'
import { getCapturedCourseCodes } from '../core/timetableView'
import { selectCoursesByTimetable } from '../core/courseSelect'
import { academicYear } from '../core/syllabus'
import { createPacer, LETUS_MIN_REQUEST_GAP_MS, type Pacer } from '../core/pacer'

console.log('[LETUS Task Watcher] background service worker loaded')

/**
 * LETUS への全リクエストが通るゲート。課題スキャンと締切スキャンで共有するため、
 * 連続して走るときも境目でバーストしない。同時実行数(3/5)はソケット上限として残り、
 * 実効レートはこのペーサーが決める。
 */
const letusPacer = createPacer(LETUS_MIN_REQUEST_GAP_MS)

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) ?? ''

// ─── State ───────────────────────────────────────────────────────────────────

let isAssignmentScanning = false
let isDeadlineScanning = false

// ─── Utilities ───────────────────────────────────────────────────────────────

function createId(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replaceAll('=', '')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

function createAssignmentCandidateId(courseId: string, url: string): string {
  return createId(`${courseId}:${url}`)
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

export async function applyAutoSelect(now: Date = new Date()): Promise<void> {
  const year = academicYear(now)
  const [zenki, kouki] = await Promise.all([
    getCapturedCourseCodes(year, 'zenki'),
    getCapturedCourseCodes(year, 'kouki'),
  ])
  const codes = new Set([...zenki, ...kouki])
  if (codes.size === 0) return
  const courses = await getCourses()
  const next = selectCoursesByTimetable(courses, codes, now.toISOString())
  if (next !== courses) await saveCourses(next)
}

async function syncCoursesToServerIfSubscriber(courses: Course[]): Promise<void> {
  if (!API_BASE_URL) return
  const [token, active] = await Promise.all([getAuthToken(), isSubscriptionActive()])

  if (!token || !active) {
    return
  }

  try {
    await fetch(`${API_BASE_URL}/api/user/courses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        courses: courses.map((c) => ({ id: c.id, name: c.name })),
      }),
    })
  } catch {
    // サーバー同期の失敗は無視する（次回のコース検出時に再試行される）
  }
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

async function getAssignments(): Promise<Assignment[]> {
  const result = await chrome.storage.local.get(ASSIGNMENTS_KEY)
  return (result[ASSIGNMENTS_KEY] as Assignment[] | undefined) ?? []
}

export async function upsertAssignments(newAssignments: Assignment[]): Promise<Assignment[]> {
  const current = await getAssignments()
  const map = new Map<string, Assignment>()
  for (const a of current) map.set(a.id, a)
  for (const a of newAssignments) {
    const existing = map.get(a.id)
    map.set(a.id, {
      ...a,
      firstSeenAt: existing?.firstSeenAt ?? a.firstSeenAt,
    })
  }
  const merged = Array.from(map.values())
  await saveAssignments(merged)
  return merged
}

async function saveAssignmentScanStatus(status: AssignmentScanStatus): Promise<void> {
  await chrome.storage.local.set({ [ASSIGNMENT_SCAN_STATUS_KEY]: status })
}

async function saveDeadlineScanStatus(status: DeadlineScanStatus): Promise<void> {
  await chrome.storage.local.set({ [DEADLINE_SCAN_STATUS_KEY]: status })
}

// ─── Notifications ────────────────────────────────────────────────────────────

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

async function notifyCourseUpdate(course: Course, addedCount: number): Promise<void> {
  await createNotification({
    id: `course-update:${course.id}`,
    title: 'コース更新',
    message: `${course.name} に新しい教材/課題 ${addedCount}件`,
    url: `${chrome.runtime.getURL('index.html')}#dashboard`,
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

export async function scanAssignmentCandidatesInBackground(
  scanLevel: ScanLevel = 'standard',
  pacer: Pacer = letusPacer,
): Promise<{ ok: boolean; reason?: string; detectedCount?: number; errorMessage?: string }> {
  if (isAssignmentScanning) return { ok: false, reason: 'already_running' }

  isAssignmentScanning = true
  const startedAt = new Date().toISOString()
  const courses = await getCourses()
  const enabledCourses = courses.filter((c) => c.enabled)
  const enabledCourseIds = new Set(enabledCourses.map((c) => c.id))
  const existingCandidates = await getAssignmentCandidates()
  const assignmentMap = new Map<string, AssignmentCandidate>()
  for (const candidate of existingCandidates) {
    if (enabledCourseIds.has(candidate.courseId)) {
      assignmentMap.set(candidate.id, candidate)
    }
  }

  // コース更新通知の可否判定に使う（ミュート済み or 全体OFF なら通知だけ抑制）。
  const [notifyRules, courseUpdateNotifyEnabled] = await Promise.all([
    getNotificationRules(),
    getCourseUpdateNotifyEnabled(),
  ])

  await saveAssignmentScanStatus({
    state: 'running',
    startedAt,
    finishedAt: null,
    totalCourses: enabledCourses.length,
    completedCourses: 0,
    currentCourseName: '開始準備中...',
    detectedCount: assignmentMap.size,
    errorMessage: null,
  })

  try {
    await mapWithConcurrency(
      enabledCourses,
      3,
      async (course) => {
        let response: Response
        try {
          await pacer.acquire()
          response = await fetch(course.url, { credentials: 'include' })
        } catch {
          return null
        }
        if (!response.ok) return null

        const html = await response.text()
        const links = extractLinksFromHtml(html, course.url)

        try {
          const prevSig = await getCourseSignature(course.id)
          const upd = computeCourseUpdate(prevSig, html, course.url, new Date().toISOString())
          if (!upd.skipSave) {
            await saveCourseSignature(course.id, upd.signature)
            if (upd.added.length > 0) {
              await addUnreadUpdates(course.id, upd.added)
              if (shouldNotifyCourseUpdate(notifyRules, course.id, courseUpdateNotifyEnabled)) {
                await notifyCourseUpdate(course, upd.added.length)
              }
            }
          }
        } catch {
          // 更新検知の失敗はスキャン本体を止めない
        }

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
    const assignmentCandidates = Array.from(assignmentMap.values()).filter((c) =>
      enabledCourseIds.has(c.courseId),
    )

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

export async function scanDeadlinesInBackground(pacer: Pacer = letusPacer): Promise<{
  ok: boolean
  reason?: string
  detectedCount?: number
  errorMessage?: string
}> {
  if (isDeadlineScanning) return { ok: false, reason: 'already_running' }

  isDeadlineScanning = true
  const startedAt = new Date().toISOString()

  const courses = await getCourses()
  const enabledCourses = courses.filter((c) => c.enabled)
  const loginStatus = await checkIsLoggedIn(enabledCourses, pacer)

  if (loginStatus !== 'ok') {
    const errorMessage =
      loginStatus === 'login_required'
        ? 'LETUSにログインしていないため更新できませんでした。'
        : 'LETUSへの通信に失敗しました。ネットワーク接続を確認してください。'

    await saveDeadlineScanStatus({
      state: 'error',
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItems: 0,
      completedItems: 0,
      currentItemTitle: '',
      detectedCount: 0,
      errorMessage,
    })
    isDeadlineScanning = false
    return { ok: false, reason: loginStatus, errorMessage }
  }

  const candidates = await getAssignmentCandidates()
  const assignments: Assignment[] = []

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
        let response: Response
        try {
          await pacer.acquire()
          response = await fetch(candidate.url, { credentials: 'include' })
        } catch {
          return null
        }
        if (!response.ok) return null

        const html = await response.text()
        const plainText = htmlToPlainText(html)
        const deadlineText = extractDeadlineText(plainText)
        const fieldDeadline = deadlineText ? parseDeadline(deadlineText) : null
        const titleDeadline = fieldDeadline
          ? null
          : parseDeadlineFromTitle(candidate.title)
        const deadline = fieldDeadline ?? titleDeadline
        const deadlineSource: 'field' | 'title' | null = fieldDeadline
          ? 'field'
          : titleDeadline
            ? 'title'
            : null
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
          deadlineSource,
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

        await upsertAssignments(assignments)
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
    const candidateIds = new Set(candidates.map((c) => c.id))
    const merged = await upsertAssignments(assignments)
    const finalAssignments = merged.filter((a) => candidateIds.has(a.id))
    const detectedCount = finalAssignments.filter((a) => a.deadline !== null).length

    await saveAssignments(finalAssignments)
    await notifyDeadlineSummary(finalAssignments)
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

// ─── Deadline warning notifications (rule-based thresholds) ─────────────────

async function checkDeadlineWarningNotifications(): Promise<void> {
  const [assignments, ignoredIds, notifiedKeys, manualAssignments, rules] = await Promise.all([
    getAssignments(),
    getIgnoredAssignmentIds(),
    getNotifiedDeadlineKeys(),
    getManualAssignments(),
    getNotificationRules(),
  ])

  const ignoredSet = new Set(ignoredIds)

  const scanTargets = assignments.filter(
    (a) =>
      !ignoredSet.has(a.id) &&
      a.deadline !== null &&
      a.lifecycleStatus !== 'passed' &&
      a.lifecycleStatus !== 'submitted' &&
      a.submissionStatus !== 'submitted' &&
      a.submissionStatus !== 'completed',
  )

  const manualTargets = manualAssignments.filter((a) => !a.submitted)

  const targets: DeadlineTarget[] = [
    ...scanTargets
      .filter((a): a is Assignment & { deadline: string } => a.deadline !== null)
      .map((a) => ({
        id: a.id,
        courseId: a.courseId,
        title: a.title,
        courseName: a.courseName,
        deadline: a.deadline,
        url: a.url,
      })),
    // 手動課題はユーザーが明示的に追加したリマインダー。コース側のミュート/しきい値の
    // 影響を受けて通知が黙って消えることのないよう courseId は渡さない（＝常に既定しきい値）。
    ...manualTargets.map((a) => ({
      id: a.id,
      title: a.title,
      courseName: a.courseName,
      deadline: a.deadline,
      url: a.letusUrl ?? undefined,
    })),
  ]

  const notifications = computeDeadlineNotifications(targets, rules, new Set(notifiedKeys), Date.now())
  if (notifications.length === 0) return

  const nextNotifiedKeys = new Set(notifiedKeys)
  for (const n of notifications) {
    await createNotification({ id: n.notificationId, title: n.title, message: n.message, url: n.url })
    nextNotifiedKeys.add(n.notifyKey)
  }
  await saveNotifiedDeadlineKeys(Array.from(nextNotifiedKeys))
}

// ─── Alarm-based auto scan ────────────────────────────────────────────────────

export const ALARM_NAME = 'auto-scan'
export const ALARM_PERIOD_MINUTES = 1440

const LETUS_LOGIN_URL = 'https://letus.ed.tus.ac.jp/login/index.php'

function isNotLoggedInPageContent(html: string): boolean {
  return html.includes('あなたはログインしていません') || html.includes('You are not logged in')
}

export async function checkIsLoggedIn(
  courses: Course[],
  pacer: Pacer = letusPacer,
): Promise<'ok' | 'login_required' | 'network_error'> {
  const course = courses.find((c) => c.enabled)
  if (!course) return 'ok'
  try {
    await pacer.acquire()
    const response = await fetch(course.url, {
      credentials: 'include',
      redirect: 'manual',
    })
    // 未ログイン時は course ページが login/SSO へリダイレクトする。
    // redirect:'manual' では（同一/別オリジン問わず）opaqueredirect になる。
    if (response.type === 'opaqueredirect') return 'login_required'
    if (!response.ok) return 'network_error'
    if (response.url.includes('/login/')) return 'login_required'
    const html = await response.text()
    return isNotLoggedInPageContent(html) ? 'login_required' : 'ok'
  } catch {
    return 'network_error'
  }
}

export async function runAutoScan(): Promise<void> {
  // 規約に同意していない利用者のデータは一切扱わない。
  if (!(await isConsented())) return

  const courses = await getCourses()
  const enabledCourses = courses.filter((c) => c.enabled)

  if (enabledCourses.length === 0) return

  const loginStatus = await checkIsLoggedIn(enabledCourses)
  if (loginStatus !== 'ok') {
    await createNotification({
      id: 'task-watcher-login-required',
      title: 'LETUS Task Watcher',
      message:
        loginStatus === 'login_required'
          ? 'LETUSにログインしてください。クリックするとログイン画面が開きます。'
          : 'LETUSへの通信に失敗しました。ネットワーク接続を確認してください。',
      url: loginStatus === 'login_required' ? LETUS_LOGIN_URL : undefined,
    })
    return
  }

  await scanAssignmentCandidatesInBackground('standard')
  await scanDeadlinesInBackground()
  await saveLastRefreshAt(new Date().toISOString())
  await checkDeadlineWarningNotifications()
}

/** 未同意のあいだ拡張アイコンに "!" を出し、同意で消す。通知は使わない。 */
export async function updateConsentBadge(): Promise<void> {
  const consented = await isConsented()
  await chrome.action.setBadgeText({ text: consented ? '' : '!' })
  if (!consented) {
    await chrome.action.setBadgeBackgroundColor({ color: '#d93025' })
  }
}

export async function handleInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: ALARM_PERIOD_MINUTES,
    periodInMinutes: ALARM_PERIOD_MINUTES,
  })

  await updateConsentBadge()

  if (details.reason === 'install') {
    await chrome.storage.local.set({ [WELCOME_GUIDE_SHOWN_KEY]: true })
    await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') })
    return
  }

  if (details.reason === 'update') {
    const result = await chrome.storage.local.get(WELCOME_GUIDE_SHOWN_KEY) as {
      welcomeGuideShown?: boolean
    }
    if (result.welcomeGuideShown === true) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('changelog.html') })
    } else {
      await chrome.storage.local.set({ [WELCOME_GUIDE_SHOWN_KEY]: true })
      await chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') })
    }
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  handleInstalled(details).catch((error) => {
    console.error('[LETUS Task Watcher] onInstalled handling failed', error)
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

chrome.storage.local.onChanged.addListener((changes) => {
  if (TERMS_CONSENT_KEY in changes) {
    void updateConsentBadge()
  }
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return

  runAutoScan().catch((error) => {
    console.error('[LETUS Task Watcher] auto scan failed', error)
  })
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  if (Object.keys(changes).some((k) => k.startsWith('timetable:'))) {
    applyAutoSelect().catch((error) => {
      console.error('[LETUS Task Watcher] auto select failed', error)
    })
  }
})

// ─── Message handler ──────────────────────────────────────────────────────────

function handleCollectingMessage(
  message: { type: string; [k: string]: unknown },
  sendResponse: (response: unknown) => void,
): void {
  if (message.type === 'UPSERT_COURSES') {
    const courses = (message.courses ?? []) as Course[]
    sendResponse({ ok: true, count: courses.length })
    upsertCourses(courses)
      .then(() => applyAutoSelect())
      .then(() => syncCoursesToServerIfSubscriber(courses))
      .catch((error) => {
        console.error('[LETUS Task Watcher] upsertCourses failed', error)
      })
    return
  }

  if (message.type === 'START_ASSIGNMENT_SCAN') {
    if (isAssignmentScanning) {
      sendResponse({ ok: false, reason: 'already_running' })
      return
    }
    const scanLevel = (message.scanLevel ?? 'standard') as ScanLevel
    void (async () => {
      const courses = await getCourses()
      const enabledCourses = courses.filter((c) => c.enabled)
      const loginStatus = await checkIsLoggedIn(enabledCourses)
      if (loginStatus !== 'ok') {
        sendResponse({
          ok: false,
          reason: loginStatus === 'login_required' ? 'not_logged_in' : 'network_error',
        })
        return
      }
      sendResponse({ ok: true, reason: 'started' })
      scanAssignmentCandidatesInBackground(scanLevel).catch((error) => {
        console.error('[LETUS Task Watcher] assignment scan failed', error)
      })
    })()
    return
  }

  if (message.type === 'START_DEADLINE_SCAN') {
    if (isDeadlineScanning) {
      sendResponse({ ok: false, reason: 'already_running' })
      return
    }
    sendResponse({ ok: true, reason: 'started' })
    scanDeadlinesInBackground().catch((error) => {
      console.error('[LETUS Task Watcher] deadline scan failed', error)
    })
    return
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[LETUS Task Watcher] received message', message)

  if (message?.type === 'OPEN_DASHBOARD') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('index.html#dashboard') })
    return
  }

  // 収集を伴うメッセージは、規約同意まで一切受け付けない。
  // popup の自動 refresh は React の useEffect であり画面ゲートでは止まらないため、
  // ここが実効的な防波堤になる。
  const COLLECTING_MESSAGES = ['UPSERT_COURSES', 'START_ASSIGNMENT_SCAN', 'START_DEADLINE_SCAN']
  if (COLLECTING_MESSAGES.includes(message?.type)) {
    void isConsented().then((consented) => {
      if (!consented) {
        sendResponse({ ok: false, reason: 'consent_required' })
      } else {
        handleCollectingMessage(message, sendResponse)
      }
    })
    return true
  }

  return false
})

export {}
