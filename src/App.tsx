import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import './App.css'
import type { Assignment, Course } from './core/types'
import {
  clearAssignmentCandidates,
  clearAssignments,
  clearCourses,
  getAssignments,
  getCourses,
  saveCourses,
} from './core/storage'

const ASSIGNMENT_SCAN_STATUS_KEY = 'assignmentScanStatus'
const DEADLINE_SCAN_STATUS_KEY = 'deadlineScanStatus'
const LAST_REFRESH_AT_KEY = 'lastSuccessfulRefreshAt'
const LAST_STALE_NOTIFICATION_AT_KEY = 'lastStaleRefreshNotificationAt'
const IGNORED_ASSIGNMENT_IDS_KEY = 'ignoredAssignmentIds'
const NOTIFIED_DEADLINE_KEYS_KEY = 'notifiedDeadlineKeys'

const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000
const STALE_NOTIFICATION_INTERVAL_MS = 60 * 60 * 1000
const THREE_HOURS_MS = 3 * 60 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS
const OLD_PASSED_DAYS = 30

type ScanState = 'idle' | 'running' | 'completed' | 'error'

type AssignmentScanStatus = {
  state: ScanState
  startedAt: string | null
  finishedAt: string | null
  totalCourses: number
  completedCourses: number
  currentCourseName: string
  detectedCount: number
  errorMessage: string | null
}

type DeadlineScanStatus = {
  state: ScanState
  startedAt: string | null
  finishedAt: string | null
  totalItems: number
  completedItems: number
  currentItemTitle: string
  detectedCount: number
  errorMessage: string | null
}

const initialAssignmentScanStatus: AssignmentScanStatus = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  totalCourses: 0,
  completedCourses: 0,
  currentCourseName: '',
  detectedCount: 0,
  errorMessage: null,
}

const initialDeadlineScanStatus: DeadlineScanStatus = {
  state: 'idle',
  startedAt: null,
  finishedAt: null,
  totalItems: 0,
  completedItems: 0,
  currentItemTitle: '',
  detectedCount: 0,
  errorMessage: null,
}

function formatDeadline(deadline: string | null): string {
  if (!deadline) {
    return '期限なし'
  }

  const date = new Date(deadline)

  if (Number.isNaN(date.getTime())) {
    return '期限なし'
  }

  return `${date.getMonth() + 1}/${date.getDate()} ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '未更新'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '未更新'
  }

  return `${date.getMonth() + 1}/${date.getDate()} ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function getElapsedText(value: string | null): string {
  if (!value) {
    return '未更新'
  }

  const diff = Date.now() - new Date(value).getTime()

  if (diff < 0 || Number.isNaN(diff)) {
    return '不明'
  }

  const minutes = Math.floor(diff / 60_000)

  if (minutes < 1) {
    return 'たった今'
  }

  if (minutes < 60) {
    return `${minutes}分前`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  if (hours < 24) {
    return remainingMinutes === 0
      ? `${hours}時間前`
      : `${hours}時間${remainingMinutes}分前`
  }

  const days = Math.floor(hours / 24)

  return `${days}日前`
}

function getRemaining(deadline: string | null): string {
  if (!deadline) {
    return ''
  }

  const diff = new Date(deadline).getTime() - Date.now()

  if (diff <= 0) {
    return '期限切れ'
  }

  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)

  if (hours < 24) {
    return `${hours}時間${minutes}分`
  }

  return `${Math.floor(hours / 24)}日後`
}

function getEndOfTomorrow(): number {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function isWithin24Hours(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const diff = new Date(deadline).getTime() - Date.now()

  return diff > 0 && diff <= ONE_DAY_MS
}

function isTomorrowOrEarlierAfter24Hours(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const time = new Date(deadline).getTime()
  const diff = time - Date.now()

  return diff > ONE_DAY_MS && time <= getEndOfTomorrow()
}

function isWithinThisWeekAfterTomorrow(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const time = new Date(deadline).getTime()
  const diff = time - Date.now()

  return diff > ONE_DAY_MS && time > getEndOfTomorrow() && diff <= SEVEN_DAYS_MS
}

function isLaterThanThisWeek(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const diff = new Date(deadline).getTime() - Date.now()

  return diff > SEVEN_DAYS_MS
}

function isOldPassedAssignment(assignment: Assignment): boolean {
  if (assignment.lifecycleStatus !== 'passed' || !assignment.deadline) {
    return false
  }

  const diff = Date.now() - new Date(assignment.deadline).getTime()

  return diff >= OLD_PASSED_DAYS * ONE_DAY_MS
}

function isSubmittedAssignment(assignment: Assignment): boolean {
  return (
    assignment.lifecycleStatus === 'submitted' ||
    assignment.submissionStatus === 'submitted' ||
    assignment.submissionStatus === 'completed'
  )
}

function sortByDeadline(a: Assignment, b: Assignment): number {
  const aTime = a.deadline
    ? new Date(a.deadline).getTime()
    : Number.POSITIVE_INFINITY

  const bTime = b.deadline
    ? new Date(b.deadline).getTime()
    : Number.POSITIVE_INFINITY

  return aTime - bTime
}

function getStatusLabel(assignment: Assignment): string {
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

function isAssignmentVisibleByCourse(
  assignment: Assignment,
  courses: Course[],
): boolean {
  const course = courses.find((candidate) => candidate.id === assignment.courseId)

  if (!course) {
    return true
  }

  return course.enabled
}

function getUrgentAssignments(
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

function createNotification(id: string, title: string, message: string): void {
  chrome.notifications.create(
    id,
    {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title,
      message,
      priority: 2,
    },
    () => {
      if (chrome.runtime.lastError) {
        console.warn(
          '[LETUS Task Watcher] notification failed:',
          chrome.runtime.lastError.message,
        )
      }
    },
  )
}

function normalizeUpdateError(error: unknown): string {
  const rawMessage = String(error)

  if (rawMessage.includes('already_running')) {
    return 'すでに更新処理が実行中です。少し待ってから再度試してください。'
  }

  if (rawMessage.includes('timeout') || rawMessage.includes('タイムアウト')) {
    return '更新が時間内に完了しませんでした。LETUSにログインしているか、通信状態を確認してください。'
  }

  if (rawMessage.includes('Failed to fetch') || rawMessage.includes('NetworkError')) {
    return 'LETUSへの通信に失敗しました。ネットワーク接続またはLETUSのログイン状態を確認してください。'
  }

  if (rawMessage.includes('課題候補検索')) {
    return '課題候補の検索中に問題が発生しました。対象コースやLETUSのログイン状態を確認してください。'
  }

  if (rawMessage.includes('締切読み取り')) {
    return '締切情報の読み取り中に問題が発生しました。LETUSのページ構成が変わっている可能性があります。'
  }

  return rawMessage
}

function AssignmentCard({
  assignment,
  compact = false,
  canHide = false,
  onHide,
}: {
  assignment: Assignment
  compact?: boolean
  canHide?: boolean
  onHide?: (assignmentId: string) => void
}) {
  function openAssignmentPage() {
    if (!assignment.url) {
      return
    }

    chrome.tabs.create({
      url: assignment.url,
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openAssignmentPage()
    }
  }

  function handleHideClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    event.preventDefault()

    if (onHide) {
      onHide(assignment.id)
    }
  }

  return (
    <article
      className={`card ${compact ? 'compactCard' : ''} ${
        assignment.lifecycleStatus
      }`}
      role="button"
      tabIndex={0}
      onClick={openAssignmentPage}
      onKeyDown={handleKeyDown}
      title="クリックしてLETUSの課題ページを開く"
    >
      <div className="topRow">
        <span className="dateText">{formatDeadline(assignment.deadline)}</span>
        <span className="remain">{getRemaining(assignment.deadline)}</span>
      </div>

      <div className="title">{assignment.title}</div>
      <div className="course">{assignment.courseName}</div>

      {!compact && (
        <div className="cardFooter">
          <div className="statusPill">{getStatusLabel(assignment)}</div>

          {canHide && (
            <button
              type="button"
              className="hideAssignmentButton"
              onClick={handleHideClick}
              title="この課題をリストから非表示にする"
            >
              非表示
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function Section({
  title,
  count,
  children,
  emptyText,
}: {
  title: string
  count: number
  children: ReactNode
  emptyText: string
}) {
  return (
    <section className="section">
      <div className="sectionHeader">
        <h2>{title}</h2>
        <span className="sectionCount">{count}件</span>
      </div>

      {count === 0 ? <p className="emptyText">{emptyText}</p> : children}
    </section>
  )
}

function CollapsibleSection({
  title,
  count,
  children,
  emptyText,
  defaultOpen = false,
}: {
  title: string
  count: number
  children: ReactNode
  emptyText: string
  defaultOpen?: boolean
}) {
  return (
    <details className="collapsibleSection" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <span>{count}件</span>
      </summary>

      {count === 0 ? <p className="emptyText">{emptyText}</p> : children}
    </details>
  )
}

async function getAssignmentScanStatus(): Promise<AssignmentScanStatus> {
  const result = (await chrome.storage.local.get(
    ASSIGNMENT_SCAN_STATUS_KEY,
  )) as {
    assignmentScanStatus?: AssignmentScanStatus
  }

  return result.assignmentScanStatus ?? initialAssignmentScanStatus
}

async function getDeadlineScanStatus(): Promise<DeadlineScanStatus> {
  const result = (await chrome.storage.local.get(DEADLINE_SCAN_STATUS_KEY)) as {
    deadlineScanStatus?: DeadlineScanStatus
  }

  return result.deadlineScanStatus ?? initialDeadlineScanStatus
}

async function getLastRefreshAt(): Promise<string | null> {
  const result = (await chrome.storage.local.get(LAST_REFRESH_AT_KEY)) as {
    lastSuccessfulRefreshAt?: string
  }

  return result.lastSuccessfulRefreshAt ?? null
}

async function saveLastRefreshAt(value: string): Promise<void> {
  await chrome.storage.local.set({
    lastSuccessfulRefreshAt: value,
  })
}

async function getLastStaleNotificationAt(): Promise<string | null> {
  const result = (await chrome.storage.local.get(
    LAST_STALE_NOTIFICATION_AT_KEY,
  )) as {
    lastStaleRefreshNotificationAt?: string
  }

  return result.lastStaleRefreshNotificationAt ?? null
}

async function saveLastStaleNotificationAt(value: string): Promise<void> {
  await chrome.storage.local.set({
    lastStaleRefreshNotificationAt: value,
  })
}

async function getIgnoredAssignmentIds(): Promise<string[]> {
  const result = (await chrome.storage.local.get(IGNORED_ASSIGNMENT_IDS_KEY)) as {
    ignoredAssignmentIds?: string[]
  }

  return result.ignoredAssignmentIds ?? []
}

async function saveIgnoredAssignmentIds(ignoredAssignmentIds: string[]) {
  await chrome.storage.local.set({
    ignoredAssignmentIds,
  })
}

async function getNotifiedDeadlineKeys(): Promise<string[]> {
  const result = (await chrome.storage.local.get(NOTIFIED_DEADLINE_KEYS_KEY)) as {
    notifiedDeadlineKeys?: string[]
  }

  return result.notifiedDeadlineKeys ?? []
}

async function saveNotifiedDeadlineKeys(notifiedDeadlineKeys: string[]) {
  await chrome.storage.local.set({
    notifiedDeadlineKeys,
  })
}

async function waitForAssignmentScanToFinish(
  onTick: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 180_000) {
    const status = await getAssignmentScanStatus()
    await onTick()

    if (status.state === 'completed') {
      return
    }

    if (status.state === 'error') {
      throw new Error(status.errorMessage ?? '課題候補検索でエラー')
    }

    await new Promise((resolve) => setTimeout(resolve, 800))
  }

  throw new Error('課題候補検索がタイムアウトしました')
}

async function waitForDeadlineScanToFinish(
  onTick: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 240_000) {
    const status = await getDeadlineScanStatus()
    await onTick()

    if (status.state === 'completed') {
      return
    }

    if (status.state === 'error') {
      throw new Error(status.errorMessage ?? '締切読み取りでエラー')
    }

    await new Promise((resolve) => setTimeout(resolve, 800))
  }

  throw new Error('締切読み取りがタイムアウトしました')
}

export default function App() {
  const isDashboard = window.location.hash === '#dashboard'

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [ignoredAssignmentIds, setIgnoredAssignmentIds] = useState<string[]>([])
  const [lastHiddenAssignment, setLastHiddenAssignment] =
    useState<Assignment | null>(null)
  const [assignmentScanStatus, setAssignmentScanStatus] =
    useState<AssignmentScanStatus>(initialAssignmentScanStatus)
  const [deadlineScanStatus, setDeadlineScanStatus] =
    useState<DeadlineScanStatus>(initialDeadlineScanStatus)
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [message, setMessage] = useState('')
  const hasAutoRefreshCheckedRef = useRef(false)
  const hasCheckedDeadlineNotificationRef = useRef(false)

  async function refreshAll() {
    const [
      savedAssignments,
      savedCourses,
      savedIgnoredAssignmentIds,
      savedAssignmentScanStatus,
      savedDeadlineScanStatus,
      savedLastRefreshAt,
    ] = await Promise.all([
      getAssignments(),
      getCourses(),
      getIgnoredAssignmentIds(),
      getAssignmentScanStatus(),
      getDeadlineScanStatus(),
      getLastRefreshAt(),
    ])

    setAssignments(savedAssignments)
    setCourses(savedCourses)
    setIgnoredAssignmentIds(savedIgnoredAssignmentIds)
    setAssignmentScanStatus(savedAssignmentScanStatus)
    setDeadlineScanStatus(savedDeadlineScanStatus)
    setLastRefreshAt(savedLastRefreshAt)
  }

  async function checkDeadlineWarningNotifications(
    sourceAssignments: Assignment[],
    sourceCourses: Course[],
    sourceIgnoredIds: string[],
  ) {
    const ignoredSet = new Set(sourceIgnoredIds)
    const notifiedKeys = await getNotifiedDeadlineKeys()
    const notifiedSet = new Set(notifiedKeys)
    const nextNotifiedKeys = new Set(notifiedKeys)
    let changed = false

    const visibleTargets = sourceAssignments
      .filter((assignment) => {
        return (
          !ignoredSet.has(assignment.id) &&
          isAssignmentVisibleByCourse(assignment, sourceCourses) &&
          assignment.deadline &&
          !isSubmittedAssignment(assignment) &&
          assignment.lifecycleStatus !== 'passed'
        )
      })
      .sort(sortByDeadline)

    for (const assignment of visibleTargets) {
      if (!assignment.deadline) {
        continue
      }

      const diff = new Date(assignment.deadline).getTime() - Date.now()

      if (diff <= 0) {
        continue
      }

      const oneHourKey = `${assignment.id}:1h`
      const threeHourKey = `${assignment.id}:3h`

      if (diff <= ONE_HOUR_MS && !notifiedSet.has(oneHourKey)) {
        createNotification(
          `letus-task-watcher-deadline-1h-${assignment.id}-${Date.now()}`,
          '締切まで1時間以内',
          `${assignment.title}\n${assignment.courseName}`,
        )

        nextNotifiedKeys.add(oneHourKey)
        changed = true
        continue
      }

      if (diff <= THREE_HOURS_MS && !notifiedSet.has(threeHourKey)) {
        createNotification(
          `letus-task-watcher-deadline-3h-${assignment.id}-${Date.now()}`,
          '締切まで3時間以内',
          `${assignment.title}\n${assignment.courseName}`,
        )

        nextNotifiedKeys.add(threeHourKey)
        changed = true
      }
    }

    if (changed) {
      await saveNotifiedDeadlineKeys(Array.from(nextNotifiedKeys))
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  useEffect(() => {
    const timerId = window.setInterval(() => {
      void refreshAll()
    }, 1_000)

    return () => {
      window.clearInterval(timerId)
    }
  }, [])

  useEffect(() => {
    if (hasCheckedDeadlineNotificationRef.current) {
      return
    }

    hasCheckedDeadlineNotificationRef.current = true

    void (async () => {
      const savedAssignments = await getAssignments()
      const savedCourses = await getCourses()
      const savedIgnoredIds = await getIgnoredAssignmentIds()

      await checkDeadlineWarningNotifications(
        savedAssignments,
        savedCourses,
        savedIgnoredIds,
      )
    })()
  }, [])

  useEffect(() => {
    if (hasAutoRefreshCheckedRef.current) {
      return
    }

    hasAutoRefreshCheckedRef.current = true

    void (async () => {
      await refreshAll()

      const savedLastRefreshAt = await getLastRefreshAt()
      const savedCourses = await getCourses()
      const selectedCourseCount = savedCourses.filter(
        (course) => course.enabled,
      ).length

      if (selectedCourseCount === 0 || !savedLastRefreshAt) {
        return
      }

      const elapsed = Date.now() - new Date(savedLastRefreshAt).getTime()

      if (elapsed < AUTO_REFRESH_INTERVAL_MS) {
        return
      }

      const lastStaleNotificationAt = await getLastStaleNotificationAt()
      const staleNotificationElapsed = lastStaleNotificationAt
        ? Date.now() - new Date(lastStaleNotificationAt).getTime()
        : Number.POSITIVE_INFINITY

      if (staleNotificationElapsed >= STALE_NOTIFICATION_INTERVAL_MS) {
        createNotification(
          `letus-task-watcher-stale-${Date.now()}`,
          'LETUS Task Watcher',
          `前回更新から${getElapsedText(savedLastRefreshAt)}です。自動更新を開始します。`,
        )

        await saveLastStaleNotificationAt(new Date().toISOString())
      }

      setMessage('前回更新から2時間以上経過したため、自動更新します。')
      await updateNow()
    })()
  }, [])

  const selectedCourseCount = useMemo(() => {
    return courses.filter((course) => course.enabled).length
  }, [courses])

  const assignmentProgress = useMemo(() => {
    if (assignmentScanStatus.totalCourses <= 0) {
      return 0
    }

    return Math.round(
      (assignmentScanStatus.completedCourses /
        assignmentScanStatus.totalCourses) *
        100,
    )
  }, [assignmentScanStatus])

  const deadlineProgress = useMemo(() => {
    if (deadlineScanStatus.totalItems <= 0) {
      return 0
    }

    return Math.round(
      (deadlineScanStatus.completedItems / deadlineScanStatus.totalItems) * 100,
    )
  }, [deadlineScanStatus])

  const totalProgress = useMemo(() => {
    if (assignmentScanStatus.state === 'running') {
      return Math.min(assignmentProgress * 0.45, 45)
    }

    if (deadlineScanStatus.state === 'running') {
      return 45 + Math.min(deadlineProgress * 0.55, 55)
    }

    if (
      assignmentScanStatus.state === 'completed' &&
      deadlineScanStatus.state === 'completed'
    ) {
      return 100
    }

    return 0
  }, [
    assignmentProgress,
    deadlineProgress,
    assignmentScanStatus,
    deadlineScanStatus,
  ])

  const workingLabel = useMemo(() => {
    if (assignmentScanStatus.state === 'running') {
      return `課題候補検索中 ${assignmentScanStatus.completedCourses}/${assignmentScanStatus.totalCourses}`
    }

    if (deadlineScanStatus.state === 'running') {
      return `締切読み取り中 ${deadlineScanStatus.completedItems}/${deadlineScanStatus.totalItems}`
    }

    if (isUpdating) {
      return '更新準備中'
    }

    return ''
  }, [assignmentScanStatus, deadlineScanStatus, isUpdating])

  const visibleAssignments = useMemo(() => {
    const ignoredSet = new Set(ignoredAssignmentIds)

    return assignments.filter((assignment) => {
      if (ignoredSet.has(assignment.id)) {
        return false
      }

      return isAssignmentVisibleByCourse(assignment, courses)
    })
  }, [assignments, courses, ignoredAssignmentIds])

  const ignoredAssignments = useMemo(() => {
    const ignoredSet = new Set(ignoredAssignmentIds)

    return assignments
      .filter((assignment) => ignoredSet.has(assignment.id))
      .sort(sortByDeadline)
  }, [assignments, ignoredAssignmentIds])

  const missingIgnoredAssignmentCount = useMemo(() => {
    return Math.max(ignoredAssignmentIds.length - ignoredAssignments.length, 0)
  }, [ignoredAssignmentIds.length, ignoredAssignments.length])

  const urgentAssignments = useMemo(() => {
    return visibleAssignments
      .filter((assignment) => {
        return (
          assignment.deadline &&
          isWithin24Hours(assignment.deadline) &&
          !isSubmittedAssignment(assignment) &&
          assignment.lifecycleStatus !== 'passed'
        )
      })
      .sort(sortByDeadline)
  }, [visibleAssignments])

  const tomorrowAssignments = useMemo(() => {
    return visibleAssignments
      .filter((assignment) => {
        return (
          assignment.deadline &&
          isTomorrowOrEarlierAfter24Hours(assignment.deadline) &&
          !isSubmittedAssignment(assignment) &&
          assignment.lifecycleStatus !== 'passed' &&
          assignment.lifecycleStatus !== 'before_start'
        )
      })
      .sort(sortByDeadline)
  }, [visibleAssignments])

  const thisWeekAssignments = useMemo(() => {
    return visibleAssignments
      .filter((assignment) => {
        return (
          assignment.deadline &&
          isWithinThisWeekAfterTomorrow(assignment.deadline) &&
          !isSubmittedAssignment(assignment) &&
          assignment.lifecycleStatus !== 'passed' &&
          assignment.lifecycleStatus !== 'before_start'
        )
      })
      .sort(sortByDeadline)
  }, [visibleAssignments])

  const laterAssignments = useMemo(() => {
    return visibleAssignments
      .filter((assignment) => {
        return (
          assignment.deadline &&
          isLaterThanThisWeek(assignment.deadline) &&
          !isSubmittedAssignment(assignment) &&
          assignment.lifecycleStatus !== 'passed' &&
          assignment.lifecycleStatus !== 'before_start'
        )
      })
      .sort(sortByDeadline)
  }, [visibleAssignments])

  const beforeStartAssignments = useMemo(() => {
    return visibleAssignments
      .filter((assignment) => {
        return (
          assignment.lifecycleStatus === 'before_start' &&
          !isSubmittedAssignment(assignment)
        )
      })
      .sort(sortByDeadline)
  }, [visibleAssignments])

  const submittedAssignments = useMemo(() => {
    return visibleAssignments.filter(isSubmittedAssignment).sort(sortByDeadline)
  }, [visibleAssignments])

  const activePassedAssignments = useMemo(() => {
    return visibleAssignments
      .filter((assignment) => {
        return (
          assignment.lifecycleStatus === 'passed' &&
          !isOldPassedAssignment(assignment)
        )
      })
      .sort(sortByDeadline)
  }, [visibleAssignments])

  const oldPassedAssignments = useMemo(() => {
    return visibleAssignments
      .filter((assignment) => isOldPassedAssignment(assignment))
      .sort(sortByDeadline)
  }, [visibleAssignments])

  const isBackgroundRunning =
    assignmentScanStatus.state === 'running' ||
    deadlineScanStatus.state === 'running'

  async function updateNow() {
    const currentCourses = await getCourses()
    const currentSelectedCourseCount = currentCourses.filter(
      (course) => course.enabled,
    ).length

    if (currentSelectedCourseCount === 0) {
      setMessage('対象コースを選択してください。')
      return
    }

    try {
      setIsUpdating(true)
      setMessage('更新を開始しました。')

      await chrome.storage.local.remove([
        ASSIGNMENT_SCAN_STATUS_KEY,
        DEADLINE_SCAN_STATUS_KEY,
      ])

      await chrome.runtime.sendMessage({
        type: 'START_ASSIGNMENT_SCAN',
        scanLevel: 'standard',
      })

      await waitForAssignmentScanToFinish(refreshAll)

      await chrome.runtime.sendMessage({
        type: 'START_DEADLINE_SCAN',
      })

      await waitForDeadlineScanToFinish(refreshAll)

      const finishedAt = new Date().toISOString()
      await saveLastRefreshAt(finishedAt)

      const latestAssignments = await getAssignments()
      const latestCourses = await getCourses()
      const latestIgnoredIds = await getIgnoredAssignmentIds()

      const visibleLatestAssignments = latestAssignments.filter(
        (assignment) => !latestIgnoredIds.includes(assignment.id),
      )

      const urgent = getUrgentAssignments(visibleLatestAssignments, latestCourses)

      setAssignments(latestAssignments)
      setCourses(latestCourses)
      setIgnoredAssignmentIds(latestIgnoredIds)
      setLastRefreshAt(finishedAt)

      await checkDeadlineWarningNotifications(
        latestAssignments,
        latestCourses,
        latestIgnoredIds,
      )

      if (urgent.length > 0) {
        const first = urgent[0]

        createNotification(
          `letus-task-watcher-update-urgent-${Date.now()}`,
          `24時間以内の課題: ${urgent.length}件`,
          `${first.title}\n${first.courseName}`,
        )
      } else {
        createNotification(
          `letus-task-watcher-update-completed-${Date.now()}`,
          'LETUS Task Watcher',
          '更新が完了しました。24時間以内の未提出課題はありません。',
        )
      }

      await refreshAll()
      setMessage('更新が完了しました。')
    } catch (error) {
      const normalizedMessage = normalizeUpdateError(error)

      console.error(error)

      createNotification(
        `letus-task-watcher-update-error-${Date.now()}`,
        'LETUS Task Watcher',
        '更新中にエラーが発生しました。拡張機能を開いて状態を確認してください。',
      )

      setMessage(normalizedMessage)
    } finally {
      setIsUpdating(false)
    }
  }

  async function stopUpdating() {
    setIsUpdating(false)

    await chrome.storage.local.remove([
      ASSIGNMENT_SCAN_STATUS_KEY,
      DEADLINE_SCAN_STATUS_KEY,
    ])

    setAssignmentScanStatus(initialAssignmentScanStatus)
    setDeadlineScanStatus(initialDeadlineScanStatus)
    setMessage('更新状態を停止しました。裏側の処理が残る場合は少し待ってから再実行してください。')
  }

  async function toggleCourse(courseId: string) {
    const updatedCourses = courses.map((course) => {
      if (course.id !== courseId) {
        return course
      }

      return {
        ...course,
        enabled: !course.enabled,
        updatedAt: new Date().toISOString(),
      }
    })

    setCourses(updatedCourses)
    await saveCourses(updatedCourses)
  }

  async function setAllCoursesEnabled(enabled: boolean) {
    const updatedCourses = courses.map((course) => {
      return {
        ...course,
        enabled,
        updatedAt: new Date().toISOString(),
      }
    })

    setCourses(updatedCourses)
    await saveCourses(updatedCourses)

    setMessage(
      enabled
        ? 'すべての対象コースをONにしました。'
        : 'すべての対象コースをOFFにしました。',
    )
  }

  async function resetCourseSelection() {
    await setAllCoursesEnabled(false)
    setMessage('対象コース設定をリセットしました。')
  }

  async function hideAssignment(assignmentId: string) {
    const targetAssignment = assignments.find(
      (assignment) => assignment.id === assignmentId,
    )

    const updatedIgnoredIds = Array.from(
      new Set([...ignoredAssignmentIds, assignmentId]),
    )

    setIgnoredAssignmentIds(updatedIgnoredIds)
    setLastHiddenAssignment(targetAssignment ?? null)
    await saveIgnoredAssignmentIds(updatedIgnoredIds)
    setMessage('課題をリストから非表示にしました。')
  }

  async function restoreHiddenAssignment(assignmentId: string) {
    const updatedIgnoredIds = ignoredAssignmentIds.filter(
      (ignoredAssignmentId) => ignoredAssignmentId !== assignmentId,
    )

    setIgnoredAssignmentIds(updatedIgnoredIds)
    await saveIgnoredAssignmentIds(updatedIgnoredIds)
    setMessage('非表示にした課題を再表示しました。')
  }

  async function undoLastHiddenAssignment() {
    if (!lastHiddenAssignment) {
      return
    }

    await restoreHiddenAssignment(lastHiddenAssignment.id)
    setLastHiddenAssignment(null)
  }

  async function resetHiddenAssignments() {
    setIgnoredAssignmentIds([])
    await saveIgnoredAssignmentIds([])
    setLastHiddenAssignment(null)
    setMessage('非表示にした課題をすべて再表示しました。')
  }

  async function clearTaskData() {
    await clearAssignments()
    await clearAssignmentCandidates()
    await chrome.storage.local.remove([
      ASSIGNMENT_SCAN_STATUS_KEY,
      DEADLINE_SCAN_STATUS_KEY,
      LAST_REFRESH_AT_KEY,
      NOTIFIED_DEADLINE_KEYS_KEY,
    ])

    setAssignments([])
    setAssignmentScanStatus(initialAssignmentScanStatus)
    setDeadlineScanStatus(initialDeadlineScanStatus)
    setLastRefreshAt(null)
    setMessage('課題データと更新状態を削除しました。')
  }

  async function resetScanStatus() {
    await chrome.storage.local.remove([
      ASSIGNMENT_SCAN_STATUS_KEY,
      DEADLINE_SCAN_STATUS_KEY,
    ])

    setAssignmentScanStatus(initialAssignmentScanStatus)
    setDeadlineScanStatus(initialDeadlineScanStatus)
    setMessage('更新状態をリセットしました。')
  }

  async function resetAllData() {
    await clearAssignments()
    await clearAssignmentCandidates()
    await clearCourses()
    await chrome.storage.local.remove([
      ASSIGNMENT_SCAN_STATUS_KEY,
      DEADLINE_SCAN_STATUS_KEY,
      LAST_REFRESH_AT_KEY,
      LAST_STALE_NOTIFICATION_AT_KEY,
      IGNORED_ASSIGNMENT_IDS_KEY,
      NOTIFIED_DEADLINE_KEYS_KEY,
    ])

    setAssignments([])
    setCourses([])
    setIgnoredAssignmentIds([])
    setLastHiddenAssignment(null)
    setAssignmentScanStatus(initialAssignmentScanStatus)
    setDeadlineScanStatus(initialDeadlineScanStatus)
    setLastRefreshAt(null)
    setMessage('保存データをすべて初期化しました。')
  }

  function openDashboard() {
    chrome.tabs.create({
      url: chrome.runtime.getURL('index.html#dashboard'),
    })
  }

  return (
    <main className={`app ${isDashboard ? 'dashboard' : 'popup'}`}>
      <div className="top">
        <button
          type="button"
          className="updateBtn"
          onClick={updateNow}
          disabled={isUpdating || isBackgroundRunning}
        >
          今すぐ更新
        </button>

        <div className="refreshInfo">
          <span>前回: {formatDateTime(lastRefreshAt)}</span>
          <span>{getElapsedText(lastRefreshAt)}</span>
        </div>

        {(isUpdating || isBackgroundRunning) && (
          <>
            <div className="spinner" />
            <div className="progressWrap">
              <div className="progressText">{workingLabel}</div>
              <div className="bar">
                <div className="barFill" style={{ width: `${totalProgress}%` }} />
              </div>
            </div>

            <button type="button" className="stopBtn" onClick={stopUpdating}>
              停止
            </button>
          </>
        )}
      </div>

      {message && <p className="message">{message}</p>}

      {lastHiddenAssignment && (
        <div className="undoToast">
          <span>「{lastHiddenAssignment.title}」を非表示にしました。</span>

          <button type="button" onClick={() => void undoLastHiddenAssignment()}>
            元に戻す
          </button>
        </div>
      )}

      {!isDashboard && (
        <>
          {selectedCourseCount === 0 && (
            <section className="warningCard">
              <strong>対象コースが選択されていません</strong>

              <span>
                ダッシュボードから読み込む対象コースを選択してください。
              </span>

              <button type="button" onClick={openDashboard}>
                ダッシュボードを開く
              </button>
            </section>
          )}

          <section className="miniSummary">
            <div>
              <span>24時間以内</span>
              <strong>{urgentAssignments.length}</strong>
            </div>

            <div>
              <span>今週</span>
              <strong>
                {tomorrowAssignments.length + thisWeekAssignments.length}
              </strong>
            </div>

            <div>
              <span>対象コース</span>
              <strong>{selectedCourseCount}</strong>
            </div>
          </section>

          <Section
            title="24時間以内"
            count={urgentAssignments.length}
            emptyText="24時間以内の提出物はありません。"
          >
            {urgentAssignments.slice(0, 3).map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                compact
              />
            ))}
          </Section>

          {tomorrowAssignments.length + thisWeekAssignments.length > 0 && (
            <Section
              title="次の課題"
              count={Math.min(
                tomorrowAssignments.length + thisWeekAssignments.length,
                3,
              )}
              emptyText="今後の課題はありません。"
            >
              {[...tomorrowAssignments, ...thisWeekAssignments]
                .slice(0, 3)
                .map((assignment) => (
                  <AssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    compact
                  />
                ))}
            </Section>
          )}

          <button
            type="button"
            className="dashboardBtn"
            onClick={openDashboard}
          >
            ダッシュボードを開く
          </button>
        </>
      )}

      {isDashboard && (
        <>
          <section className="dashboardHeader">
            <div>
              <p className="eyebrow">Dashboard</p>
              <h1>課題ダッシュボード</h1>
            </div>

            <p>
              課題の詳細確認、対象コースの選択、開始前・提出済み・期限切れの確認はこちらで行います。
              不要な課題はカード右下の「非表示」からリストから外せます。
            </p>
          </section>

          <section className="miniSummary dashboardSummary">
            <div>
              <span>24時間以内</span>
              <strong>{urgentAssignments.length}</strong>
            </div>

            <div>
              <span>明日まで</span>
              <strong>{tomorrowAssignments.length}</strong>
            </div>

            <div>
              <span>今週</span>
              <strong>{thisWeekAssignments.length}</strong>
            </div>

            <div>
              <span>提出済み</span>
              <strong>{submittedAssignments.length}</strong>
            </div>

            <div>
              <span>期限切れ</span>
              <strong>
                {activePassedAssignments.length + oldPassedAssignments.length}
              </strong>
            </div>
          </section>

          <Section
            title="24時間以内"
            count={urgentAssignments.length}
            emptyText="24時間以内の提出物はありません。"
          >
            {urgentAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                canHide
                onHide={hideAssignment}
              />
            ))}
          </Section>

          <Section
            title="明日まで"
            count={tomorrowAssignments.length}
            emptyText="明日までの課題はありません。"
          >
            {tomorrowAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                canHide
                onHide={hideAssignment}
              />
            ))}
          </Section>

          <Section
            title="今週"
            count={thisWeekAssignments.length}
            emptyText="今週中の課題はありません。"
          >
            {thisWeekAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                canHide
                onHide={hideAssignment}
              />
            ))}
          </Section>

          <Section
            title="それ以降"
            count={laterAssignments.length}
            emptyText="それ以降の課題はありません。"
          >
            {laterAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                canHide
                onHide={hideAssignment}
              />
            ))}
          </Section>

          <CollapsibleSection
            title="開始前"
            count={beforeStartAssignments.length}
            emptyText="開始前の課題はありません。"
          >
            {beforeStartAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                canHide
                onHide={hideAssignment}
              />
            ))}
          </CollapsibleSection>

          <CollapsibleSection
            title="提出済み・完了"
            count={submittedAssignments.length}
            emptyText="提出済みの課題はありません。"
          >
            {submittedAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                canHide
                onHide={hideAssignment}
              />
            ))}
          </CollapsibleSection>

          <CollapsibleSection
            title="期限切れ"
            count={activePassedAssignments.length}
            emptyText="期限切れの課題はありません。"
          >
            {activePassedAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                canHide
                onHide={hideAssignment}
              />
            ))}
          </CollapsibleSection>

          <CollapsibleSection
            title={`${OLD_PASSED_DAYS}日以上前の期限切れ`}
            count={oldPassedAssignments.length}
            emptyText={`${OLD_PASSED_DAYS}日以上前の期限切れ課題はありません。`}
          >
            {oldPassedAssignments.map((assignment) => (
              <AssignmentCard
                key={assignment.id}
                assignment={assignment}
                canHide
                onHide={hideAssignment}
              />
            ))}
          </CollapsibleSection>

          <details className="settings" open>
            <summary>対象コースの選択</summary>

            <div className="settingsMeta">
              対象: {selectedCourseCount}/{courses.length} コース
            </div>

            <div className="courseBulkActions">
              <button
                type="button"
                onClick={() => void setAllCoursesEnabled(true)}
              >
                すべてON
              </button>

              <button
                type="button"
                onClick={() => void setAllCoursesEnabled(false)}
              >
                すべてOFF
              </button>
            </div>

            <div className="courseList">
              {courses.length === 0 ? (
                <p className="emptyText">
                  まだ対象コースがありません。授業一覧を読み取ってから選択してください。
                </p>
              ) : (
                courses.map((course) => (
                  <label key={course.id} className="courseRow">
                    <input
                      type="checkbox"
                      checked={course.enabled}
                      onChange={() => void toggleCourse(course.id)}
                    />

                    <span>{course.name}</span>
                  </label>
                ))
              )}
            </div>
          </details>

          <CollapsibleSection
            title="非表示にした課題"
            count={ignoredAssignmentIds.length}
            emptyText="非表示中の課題はありません。"
          >
            <div className="hiddenPanel">
              <div className="hiddenPanelHeader">
                <div>
                  <strong>非表示にした課題</strong>
                  <span>
                    {ignoredAssignmentIds.length}件
                    {missingIgnoredAssignmentCount > 0 &&
                      `（現在の取得結果にない課題 ${missingIgnoredAssignmentCount}件を含む）`}
                  </span>
                </div>

                <button
                  type="button"
                  className="resetHiddenButton"
                  onClick={resetHiddenAssignments}
                  disabled={ignoredAssignmentIds.length === 0}
                >
                  すべて再表示
                </button>
              </div>

              {ignoredAssignments.length === 0 ? (
                <p className="hiddenEmptyText">
                  現在の取得結果に含まれる非表示課題はありません。
                </p>
              ) : (
                <ul className="hiddenAssignmentList">
                  {ignoredAssignments.map((assignment) => (
                    <li key={assignment.id} className="hiddenAssignmentItem">
                      <div className="hiddenAssignmentText">
                        <span className="hiddenAssignmentTitle">
                          {assignment.title}
                        </span>

                        <span className="hiddenAssignmentMeta">
                          {assignment.courseName}・{formatDeadline(assignment.deadline)}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="restoreHiddenButton"
                        onClick={() =>
                          void restoreHiddenAssignment(assignment.id)
                        }
                      >
                        戻す
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CollapsibleSection>

          <details className="settings">
            <summary>データ管理</summary>

            <div className="dataManagement">
              <button type="button" onClick={clearTaskData}>
                課題データを削除
              </button>

              <button type="button" onClick={resetScanStatus}>
                更新状態をリセット
              </button>

              <button type="button" onClick={resetCourseSelection}>
                対象コース設定をリセット
              </button>

              <button type="button" onClick={resetHiddenAssignments}>
                非表示リストをリセット
              </button>

              <button
                type="button"
                className="dangerDataButton"
                onClick={resetAllData}
              >
                すべての保存データを初期化
              </button>
            </div>
          </details>
        </>
      )}
    </main>
  )
}
