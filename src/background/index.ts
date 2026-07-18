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
  TIMETABLE_IMPORT_NOTIFIED_KEY,
} from './storageKeys'
import { isConsented } from '../legal/termsConsent'
import type { AssignmentScanStatus, DeadlineScanStatus } from '../core/scanStatus'
import { getManualAssignments } from '../core/manualAssignment'
import { getAuthToken, isSubscriptionActive } from '../core/auth'
import { getNotificationRules, getCourseUpdateNotifyEnabled } from '../core/premium'
import { extractDeadlineText, parseDeadline, parseDeadlineFromTitle } from './deadlineParser'
import { shouldNotifyCourseUpdate } from './notificationRules'
import { computeDeadlineNotifications, type DeadlineTarget } from '../core/deadlineNotify'
import { applyDeadlineOverrides, getDeadlineOverrides } from '../core/deadlineOverride'
import { normalizeText, htmlToPlainText } from '../core/htmlText'
import { extractLinksFromHtml } from '../core/letusLinks'
import {
  STRICT_MODULE_PATHS,
  STANDARD_MODULE_PATHS,
  BROAD_MODULE_PATHS,
  NON_ASSIGNMENT_PATHS,
  collectUnknownModuleTypes,
} from '../core/moduleTypes'
import { computeCourseUpdate } from '../core/courseUpdates'
import { pickFirstImportNotification, buildFirstImportNotification } from '../core/timetableImportNotify'
import { getCourseSignature, saveCourseSignature, addUnreadUpdates } from './courseUpdatesStore'
import { getCapturedCourseCodes } from '../core/timetableView'
import { selectCoursesByTimetable } from '../core/courseSelect'
import { academicYear } from '../core/syllabus'
import { createPacer, LETUS_MIN_REQUEST_GAP_MS, type Pacer } from '../core/pacer'
import { createKeepAlive } from '../core/keepAlive'
import {
  classifyFetchedPage,
  emptyAuthProbeSummary,
  addToAuthProbeSummary,
  type AuthProbeSummary,
  type PageAuthClassification,
} from '../core/authProbe'
import {
  diagnoseAuthProbe,
  diagnoseCoursePage,
  type DiagnosticCode,
  type PageAuthState,
} from '../core/diagnose'
import {
  applyScanOutcome,
  DIAGNOSTICS_STATE_KEY,
  isInfoDiagnosticCode,
  type DiagnosticsState,
} from '../core/diagnosticsState'

console.log('[LETUS Task Watcher] background service worker loaded')

/**
 * LETUS への全リクエストが通るゲート。課題スキャンと締切スキャンで共有するため、
 * 連続して走るときも境目でバーストしない。同時実行数(3/5)はソケット上限として残り、
 * 実効レートはこのペーサーが決める。
 */
const letusPacer = createPacer(LETUS_MIN_REQUEST_GAP_MS)

// ─── Service worker keep-alive ────────────────────────────────────────────────
// MV3 の service worker は 30 秒アイドルで終了する。長時間スキャン中は 20 秒ごとに
// 軽い拡張 API（getPlatformInfo）を呼んでアイドルタイマをリセットし、ポップアップ/
// ダッシュボードを閉じてもスキャンを最後まで走らせる。完了で必ずタイマを止める。
const KEEP_ALIVE_INTERVAL_MS = 20_000
let keepAliveTimer: ReturnType<typeof setInterval> | null = null

const keepAlive = createKeepAlive({
  start: () => {
    if (keepAliveTimer !== null) return
    keepAliveTimer = setInterval(() => {
      chrome.runtime.getPlatformInfo(() => {
        void chrome.runtime.lastError
      })
    }, KEEP_ALIVE_INTERVAL_MS)
  },
  stop: () => {
    if (keepAliveTimer === null) return
    clearInterval(keepAliveTimer)
    keepAliveTimer = null
  },
})

/** fn 実行中だけ service worker を延命する。スキャンの入れ子/連続でもタイマは1本。 */
async function withKeepAlive<T>(fn: () => Promise<T>): Promise<T> {
  keepAlive.acquire()
  try {
    return await fn()
  } finally {
    keepAlive.release()
  }
}

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

// 許可/除外リストの実体は src/core/moduleTypes.ts（単一情報源）。
// 未知モジュール型のcatch-all診断（collectUnknownModuleTypes）と同じリストを共有する。
function isTargetActivityUrl(url: string, scanLevel: ScanLevel): boolean {
  const normalizedUrl = url.toLowerCase()
  const modulePaths =
    scanLevel === 'strict'
      ? STRICT_MODULE_PATHS
      : scanLevel === 'broad'
        ? BROAD_MODULE_PATHS
        : STANDARD_MODULE_PATHS
  return modulePaths.some((path) => normalizedUrl.includes(path))
}

function isClearlyNonAssignmentUrl(url: string): boolean {
  const normalizedUrl = url.toLowerCase()
  return NON_ASSIGNMENT_PATHS.some((path) => normalizedUrl.includes(path))
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

/** deadlineスキャンのログインガードと同一文言（ログイン切れをUIに正直に示す） */
const NOT_LOGGED_IN_ERROR_MESSAGE = 'LETUSにログインしていないため更新できませんでした。'

/**
 * classifyFetchedPage の分類を diagnose 層の PageAuthState へ写像する薄いアダプタ。
 * not_moodle_page は「ログイン/ログアウトどちらの証拠も無い」＝ unknown に倒し、
 * コースページ系の矛盾検知を誤発火させない（NOT_A_MOODLE_PAGE は diagnoseAuthProbe が担う）。
 */
function toPageAuthState(classification: PageAuthClassification): PageAuthState {
  return classification === 'not_moodle_page' ? 'unknown' : classification
}

export async function scanAssignmentCandidatesInBackground(
  scanLevel: ScanLevel = 'standard',
  pacer: Pacer = letusPacer,
): Promise<{
  ok: boolean
  reason?: string
  detectedCount?: number
  errorMessage?: string
  /** コースページfetchの認証分類集計（piggyback・追加リクエスト0）。診断配線タスクが利用する */
  authProbe?: AuthProbeSummary
  /** スキャン全体で発火した診断コード（spec§4の評価関数の出力・重複排除）。
   * storage永続は呼び出し側（runManualUpdate/runAutoScan の recordScanCycleOutcome）が
   * サイクル単位で行う */
  diagnostics?: DiagnosticCode[]
  /** UNSUPPORTED_MODULE の詳細: コースページのリンクに現れた未知モジュール型（重複排除・昇順） */
  unsupportedModuleTypes?: string[]
}> {
  if (isAssignmentScanning) return { ok: false, reason: 'already_running' }

  isAssignmentScanning = true
  const startedAt = new Date().toISOString()
  let authProbe = emptyAuthProbeSummary()
  // ログインガード（spec§6）: コースページの応答が logged_out と分類されたら立てる。
  // 以降のコースのfetchを打ち切り、既存データを一切変更せずエラーとして報告する。
  let loggedOutDetected = false
  const diagnosticCodes = new Set<DiagnosticCode>()
  const unsupportedModuleTypes = new Set<string>()
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
        // ログインガード: 先行コースで logged_out を検知済みなら fetch 自体を行わない
        // （無駄な大学向けリクエストの抑制）。並走中だった fetch は完走するが、
        // 下の logged_out 早期 return で既存データには触れない。
        if (loggedOutDetected) return null

        let response: Response
        try {
          await pacer.acquire()
          response = await fetch(course.url, { credentials: 'include' })
        } catch {
          return null
        }
        if (!response.ok) return null

        const html = await response.text()
        // 認証プローブ（piggyback）: 取得済みレスポンスをそのまま分類して集計する。
        // 追加リクエストはしない。ここは観測のみ（storage永続は呼び出し側のサイクル記録）。
        const classification = classifyFetchedPage({ finalUrl: response.url ?? '', bodyText: html })
        authProbe = addToAuthProbeSummary(authProbe, classification)
        // 分類は classifyFetchedPage 内でマーカー優先順位（ログアウト証拠 > M.cfg）を
        // 織り込み済みなので、diagnoseAuthProbe の入力へそのまま復元できる。
        for (const code of diagnoseAuthProbe({
          fetchOk: true,
          hasMcfg: classification === 'logged_in',
          hasLoginMarker: classification === 'logged_out',
        })) {
          diagnosticCodes.add(code)
        }

        if (classification === 'logged_out') {
          // 未ログインHTML(200)から候補抽出・シグネチャ保存をすると、空データが
          // 既存候補やベースラインを汚染する（skipSave黙殺の温床）。このページは
          // 一切処理せず、スキャン全体をログインエラーへ倒す（deadlineスキャンの
          // checkIsLoggedIn ガードと同じ結末）。
          loggedOutDetected = true
          return null
        }

        const links = extractLinksFromHtml(html, course.url)

        // catch-all診断（spec§3原則5）: 許可/除外どちらのリストにも無い
        // /mod/<type>/view.php リンクを silent drop せず「未対応モジュールがある」
        // 事実として浮上させる。未知型ページを追加でスキャンしには行かない
        // （パース対象は広げない＝大学向けリクエスト増ゼロ・観測のみ）。
        // Moodleと認識できないページ（メンテ等）のリンクで誤発火しないよう logged_in に限定。
        if (classification === 'logged_in') {
          const unknownTypes = collectUnknownModuleTypes(links.map((link) => link.url))
          if (unknownTypes.length > 0) {
            diagnosticCodes.add('UNSUPPORTED_MODULE')
            for (const type of unknownTypes) unsupportedModuleTypes.add(type)
          }
        }

        try {
          const prevSig = await getCourseSignature(course.id)
          const upd = computeCourseUpdate(prevSig, html, course.url, new Date().toISOString())
          // skipSave の明示化（spec§4）: スキップを含む観測結果を評価関数に流し、
          // 「既知コースの全課題喪失/ページ不読」を診断コードとして浮上させる。
          for (const code of diagnoseCoursePage({
            pageAuthState: toPageAuthState(classification),
            modAnchorCount: upd.diagnostic.modAnchorCount,
            prevSignatureLen: upd.diagnostic.prevSignatureLen,
            hasCourseMarker: upd.diagnostic.hasCourseMarker,
          })) {
            diagnosticCodes.add(code)
          }
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

    if (loggedOutDetected) {
      // deadlineスキャンの checkIsLoggedIn ガードと整合: 既存候補・シグネチャは
      // 一切変更せず（最終保存・除去も行わず）、ログインエラーとして正直に報告する。
      await saveAssignmentScanStatus({
        state: 'error',
        startedAt,
        finishedAt: new Date().toISOString(),
        totalCourses: enabledCourses.length,
        completedCourses: 0,
        currentCourseName: '',
        detectedCount: assignmentMap.size,
        errorMessage: NOT_LOGGED_IN_ERROR_MESSAGE,
      })
      return {
        ok: false,
        reason: 'login_required',
        errorMessage: NOT_LOGGED_IN_ERROR_MESSAGE,
        authProbe,
        diagnostics: Array.from(diagnosticCodes),
        unsupportedModuleTypes: Array.from(unsupportedModuleTypes).sort(),
      }
    }

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

    return {
      ok: true,
      detectedCount: assignmentCandidates.length,
      authProbe,
      diagnostics: Array.from(diagnosticCodes),
      unsupportedModuleTypes: Array.from(unsupportedModuleTypes).sort(),
    }
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
    return {
      ok: false,
      reason: 'error',
      errorMessage: String(error),
      authProbe,
      diagnostics: Array.from(diagnosticCodes),
      unsupportedModuleTypes: Array.from(unsupportedModuleTypes).sort(),
    }
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
  /** 活動ページfetchの認証分類集計（piggyback・追加リクエスト0）。診断配線タスクが利用する */
  authProbe?: AuthProbeSummary
  /** スキャン全体で発火した診断コード（重複排除）。diagnosticsState への畳み込みに使う */
  diagnostics?: DiagnosticCode[]
}> {
  if (isDeadlineScanning) return { ok: false, reason: 'already_running' }

  isDeadlineScanning = true
  const startedAt = new Date().toISOString()
  let authProbe = emptyAuthProbeSummary()
  const diagnosticCodes = new Set<DiagnosticCode>()

  const courses = await getCourses()
  const enabledCourses = courses.filter((c) => c.enabled)
  const loginStatus = await checkIsLoggedIn(enabledCourses, pacer)

  // unknown（enabledコース0件＝判定不能）はブロックしない: 候補が残っていれば
  // スキャン本体は従来どおり走らせ、偽のログインエラーをUIに出さない。
  if (isLoginBlocking(loginStatus)) {
    const errorMessage =
      loginStatus === 'login_required'
        ? NOT_LOGGED_IN_ERROR_MESSAGE
        : 'LETUSへの通信に失敗しました。ネットワーク接続を確認してください。'

    // login_required はログアウトの実観測なので診断コードとして浮上させる。
    // network_error はレイアウト診断の対象外（diagnose層の責務外）＝コード無し。
    if (loginStatus === 'login_required') diagnosticCodes.add('LOGGED_OUT')

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
    return { ok: false, reason: loginStatus, errorMessage, diagnostics: Array.from(diagnosticCodes) }
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
        // 認証プローブ（piggyback）: 取得済みレスポンスをそのまま分類して集計する。
        // 追加リクエストはしない。診断コード化も同じ分類から導く（課題スキャンと同型）。
        const classification = classifyFetchedPage({ finalUrl: response.url ?? '', bodyText: html })
        authProbe = addToAuthProbeSummary(authProbe, classification)
        for (const code of diagnoseAuthProbe({
          fetchOk: true,
          hasMcfg: classification === 'logged_in',
          hasLoginMarker: classification === 'logged_out',
        })) {
          diagnosticCodes.add(code)
        }
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
    await notifyDeadlineSummary(applyDeadlineOverrides(finalAssignments, await getDeadlineOverrides()))
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

    return { ok: true, detectedCount, authProbe, diagnostics: Array.from(diagnosticCodes) }
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
    return {
      ok: false,
      reason: 'error',
      errorMessage: String(error),
      authProbe,
      diagnostics: Array.from(diagnosticCodes),
    }
  } finally {
    isDeadlineScanning = false
  }
}

// ─── Diagnostics ledger (spec§4 永続層) ───────────────────────────────────────

/** 各スキャンが返す診断関連フィールドの最小形（記録に必要な分だけ） */
type ScanDiagnosticsResult = { ok: boolean; diagnostics?: DiagnosticCode[] }

/**
 * 1スキャンサイクル（課題スキャン＋締切スキャン）の観測を diagnosticsState へ畳み込む。
 *
 * サイクル単位で1回だけ記録する理由: スキャン毎に個別記録すると、課題スキャンが
 * コード付きで完了（失敗+1）→続く締切スキャンがコード無しで完了（成功=全リセット）の
 * 振動が毎サイクル起き、連続失敗が閾値に達しない＝エスカレーションが恒久に死ぬ。
 *
 * 記録規則（hard/info の区分は core/diagnosticsState.ts の INFO_DIAGNOSTIC_CODES 参照）:
 * - hard（スキャン整合性）コードが1つでもあれば「失敗」として畳み込む。
 * - hard コード無しで全スキャン ok なら「成功」として畳み込む（lastGoodAt 更新）。
 *   info（カバレッジ情報）コードだけのサイクルもここに含める: 未対応モジュール型を
 *   含むコース等では info が恒常発火するため、これを失敗に数えると lastGoodAt が
 *   恒久凍結し debounce も恒久無効化される（reducer 側の infoCodes へ分離して保持）。
 * - hard コード無しで ok でない（ネットワーク例外・already_running 等）は記録しない:
 *   途中で死んだサイクルの観測は不完全で、成功扱いで lastGoodAt を進めるのも
 *   失敗扱いでバナーを出すのも嘘になる（中立スキップ）。
 * - 保存失敗はスキャン本体を壊さない（握って console.error のみ）。
 */
async function recordScanCycleOutcome(results: ScanDiagnosticsResult[]): Promise<void> {
  const codes: DiagnosticCode[] = []
  for (const result of results) codes.push(...(result.diagnostics ?? []))
  const allOk = results.length > 0 && results.every((result) => result.ok)
  const hasHardCode = codes.some((code) => !isInfoDiagnosticCode(code))
  if (!hasHardCode && !allOk) return

  try {
    const stored = await chrome.storage.local.get(DIAGNOSTICS_STATE_KEY)
    const prev = (stored[DIAGNOSTICS_STATE_KEY] as DiagnosticsState | undefined) ?? null
    const next = applyScanOutcome(prev, { codes, at: new Date().toISOString() })
    await chrome.storage.local.set({ [DIAGNOSTICS_STATE_KEY]: next })
  } catch (error) {
    console.error('[LETUS Task Watcher] diagnostics state save failed', error)
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
  const [rawAssignments, ignoredIds, notifiedKeys, manualAssignments, rules, overrides] = await Promise.all([
    getAssignments(),
    getIgnoredAssignmentIds(),
    getNotifiedDeadlineKeys(),
    getManualAssignments(),
    getNotificationRules(),
    getDeadlineOverrides(),
  ])
  const assignments = applyDeadlineOverrides(rawAssignments, overrides)

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

/**
 * ログイン確認の結果。
 * - 'unknown': プローブ対象（enabledコース）が無く判定不能。以前はここで無条件 'ok' を
 *   返しており「ログイン済みだが0コース」を区別できなかった（spec§6）。unknown は
 *   スキャンを阻害してはならない値であり、呼び出し側のブロック条件は必ず
 *   isLoginBlocking()（login_required / network_error のみ）で判定すること。
 */
export type LoginCheckStatus = 'ok' | 'login_required' | 'network_error' | 'unknown'

/**
 * スキャン中止・エラー通知に値する失敗か。unknown（判定不能）と ok は非ブロック。
 * 「loginStatus !== 'ok'」比較だと unknown を偽エラー（network_error扱い）に
 * 落としてしまうため、ブロック条件はこの関数へ一本化する。
 */
function isLoginBlocking(status: LoginCheckStatus): status is 'login_required' | 'network_error' {
  return status === 'login_required' || status === 'network_error'
}

export async function checkIsLoggedIn(
  courses: Course[],
  pacer: Pacer = letusPacer,
): Promise<LoginCheckStatus> {
  const course = courses.find((c) => c.enabled)
  if (!course) return 'unknown'
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
    // 本文分類は core/authProbe に一元化。logged_out だけをブロックし、
    // not_moodle_page は従来挙動どおりここでは 'ok'（矛盾検知は診断配線側の責務）。
    return classifyFetchedPage({ finalUrl: response.url, bodyText: html }) === 'logged_out'
      ? 'login_required'
      : 'ok'
  } catch {
    return 'network_error'
  }
}

export async function runAutoScan(pacer: Pacer = letusPacer): Promise<void> {
  // 規約に同意していない利用者のデータは一切扱わない。
  if (!(await isConsented())) return

  const courses = await getCourses()
  const enabledCourses = courses.filter((c) => c.enabled)

  if (enabledCourses.length === 0) return

  const loginStatus = await checkIsLoggedIn(enabledCourses, pacer)
  if (isLoginBlocking(loginStatus)) {
    // login_required はログアウトの実観測: スキャン本体は走らないが台帳へは記録する
    // （日次アラームで放置ログアウトが activeCodes に反映されるように）。
    // network_error は中立（コード無し・ok=false）＝記録されない。
    await recordScanCycleOutcome([
      {
        ok: false,
        diagnostics: loginStatus === 'login_required' ? ['LOGGED_OUT'] : [],
      },
    ])
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

  const assignment = await scanAssignmentCandidatesInBackground('standard', pacer)
  const deadline = await scanDeadlinesInBackground(pacer)
  // スキャン完了処理（spec§4）: サイクル全体の診断観測を diagnosticsState へ畳み込む。
  // 従来どおり結果の ok に関わらず最終処理へ進む挙動は変えない（記録は追加のみ）。
  await recordScanCycleOutcome([assignment, deadline])
  await saveLastRefreshAt(new Date().toISOString())
  await checkDeadlineWarningNotifications()
}

/** 手動更新が途中で失敗したときの通知。スキャンは throw せず {ok:false} を返すため、
 * runManualUpdate 側で失敗を検知してここで通知する（閉じていても失敗が分かる）。
 * already_running は別の更新が進行中なだけなので通知しない。 */
async function notifyUpdateFailed(reason: string | undefined): Promise<void> {
  if (reason === 'already_running') return
  const isLogin = reason === 'login_required' || reason === 'not_logged_in'
  await createNotification({
    id: isLogin ? 'task-watcher-login-required' : 'letus-task-watcher-update-error',
    title: 'LETUS Task Watcher',
    message: isLogin
      ? 'LETUSにログインしてください。クリックするとログイン画面が開きます。'
      : '更新に失敗しました。ネットワークやLETUSのログイン状態を確認してください。',
    url: isLogin ? LETUS_LOGIN_URL : undefined,
  })
}

/**
 * 手動更新（ポップアップの「今すぐ更新」）の全工程を service worker 側で実行する。
 * 課題スキャン→締切スキャン→最終更新時刻の保存→締切通知判定 まで SW が一気に走るので、
 * 開始後にポップアップ/ダッシュボードを閉じても最後まで完了する。オーケストレーションと
 * 最終処理を popup から SW に移すための本体。ログイン確認は呼び出し側（START_FULL_UPDATE
 * ハンドラ）で済ませてから呼ぶ。
 *
 * スキャン関数は失敗時に throw せず {ok:false} を返すため、各段階で ok を確認し、失敗時は
 * 最終処理（lastRefreshAt 保存・締切通知）をスキップして偽の成功を作らない。完了/緊急の
 * サマリ通知は締切スキャン成功時に notifyDeadlineSummary が発火するのでここでは出さない。
 */
async function runManualUpdate(): Promise<void> {
  const assignment = await scanAssignmentCandidatesInBackground('standard')
  if (!assignment.ok) {
    // 課題スキャンで打ち切り: このサイクルの観測（LOGGED_OUT等）だけで台帳へ畳み込む。
    // hardコード無しの失敗（ネットワーク例外・already_running）は中立＝記録されない。
    await recordScanCycleOutcome([assignment])
    await notifyUpdateFailed(assignment.reason)
    return
  }
  const deadline = await scanDeadlinesInBackground()
  // スキャン完了処理（spec§4）: 課題＋締切のサイクル全体で1回だけ記録する
  // （スキャン毎の個別記録は成功/失敗が交互に畳まれて閾値に届かなくなる）。
  await recordScanCycleOutcome([assignment, deadline])
  if (!deadline.ok) {
    await notifyUpdateFailed(deadline.reason)
    return
  }
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
    const allKeys = await chrome.storage.local.get(null)
    if (Object.keys(allKeys).some((k) => k.startsWith('timetable:'))) {
      await chrome.storage.local.set({ [TIMETABLE_IMPORT_NOTIFIED_KEY]: true })
    }

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

  withKeepAlive(runAutoScan).catch((error) => {
    console.error('[LETUS Task Watcher] auto scan failed', error)
  })
})

/** 初回の時間割取込時にだけ1回OS通知する。フラグは取込前に立てて再入を防ぐ。
 * 通知idは固定なので万一の二重発火でも可視通知は1つ。クリックはダッシュボードへ。 */
async function maybeNotifyFirstTimetableImport(setKeys: string[]): Promise<void> {
  const stored = (await chrome.storage.local.get(TIMETABLE_IMPORT_NOTIFIED_KEY)) as {
    timetableImportNotified?: boolean
  }
  const pick = pickFirstImportNotification(setKeys, stored.timetableImportNotified === true)
  if (!pick) return
  await chrome.storage.local.set({ [TIMETABLE_IMPORT_NOTIFIED_KEY]: true })
  const { title, message } = buildFirstImportNotification(pick.year, pick.semester)
  await createNotification({
    id: 'timetable-imported',
    title,
    message,
    url: `${chrome.runtime.getURL('index.html')}#dashboard`,
  })
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return
  const setTimetableKeys = Object.keys(changes).filter(
    (k) => k.startsWith('timetable:') && changes[k].newValue !== undefined,
  )
  if (setTimetableKeys.length > 0) {
    applyAutoSelect().catch((error) => {
      console.error('[LETUS Task Watcher] auto select failed', error)
    })
    maybeNotifyFirstTimetableImport(setTimetableKeys).catch((error) => {
      console.error('[LETUS Task Watcher] timetable import notify failed', error)
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

  if (message.type === 'START_FULL_UPDATE') {
    if (isAssignmentScanning || isDeadlineScanning) {
      sendResponse({ ok: false, reason: 'already_running' })
      return
    }
    void (async () => {
      const courses = await getCourses()
      const enabledCourses = courses.filter((c) => c.enabled)
      const loginStatus = await checkIsLoggedIn(enabledCourses)
      // unknown（enabledコース0件）は従来の 'ok' と同じく開始を許す（偽エラーを返さない）。
      if (isLoginBlocking(loginStatus)) {
        sendResponse({
          ok: false,
          reason: loginStatus === 'login_required' ? 'not_logged_in' : 'network_error',
        })
        return
      }
      sendResponse({ ok: true, reason: 'started' })
      // 実処理・最終化・完了通知は SW 側で keep-alive 下に完走させる（popup を閉じても続く）。
      withKeepAlive(runManualUpdate).catch((error) => {
        console.error('[LETUS Task Watcher] full update failed', error)
      })
    })()
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
      // unknown（enabledコース0件）は従来の 'ok' と同じく開始を許す（偽エラーを返さない）。
      if (isLoginBlocking(loginStatus)) {
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
  const COLLECTING_MESSAGES = ['UPSERT_COURSES', 'START_ASSIGNMENT_SCAN', 'START_DEADLINE_SCAN', 'START_FULL_UPDATE']
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
