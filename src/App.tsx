import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  ASSIGNMENT_SCAN_STATUS_KEY,
  AUTO_REFRESH_INTERVAL_MS,
  DEADLINE_SCAN_STATUS_KEY,
  FEEDBACK_FORM_URL,
  IGNORED_ASSIGNMENT_IDS_KEY,
  LAST_REFRESH_AT_KEY,
  LAST_STALE_NOTIFICATION_AT_KEY,
  NOTIFIED_DEADLINE_KEYS_KEY,
  OLD_PASSED_DAYS,
  STALE_NOTIFICATION_INTERVAL_MS,
} from './constants'
import {
  getAssignmentScanStatus,
  getDeadlineScanStatus,
  getIgnoredAssignmentIds,
  getLastRefreshAt,
  getLastStaleNotificationAt,
  getNotifiedDeadlineKeys,
  initialAssignmentScanStatus,
  initialDeadlineScanStatus,
  saveIgnoredAssignmentIds,
  saveLastStaleNotificationAt,
  saveNotifiedDeadlineKeys,
  waitForAssignmentScanToFinish,
  waitForDeadlineScanToFinish,
  type AssignmentScanStatus,
  type DeadlineScanStatus,
} from './core/scanStatus'
import {
  formatDateTime,
  formatDeadline,
  getElapsedText,
  isLaterThanThisWeek,
  isTomorrowOrEarlierAfter24Hours,
  isWithin24Hours,
  isWithinThisWeekAfterTomorrow,
} from './utils/date'
import {
  isAssignmentVisibleByCourse,
  isOldPassedAssignment,
  isSubmittedAssignment,
  sortByDeadline,
} from './utils/assignment'
import { createNotification, normalizeUpdateError } from './utils/notification'
import { classifyScanStartResponse, type ScanStartResponse } from './utils/scanResponse'
import { computeDeadlineNotifications, type DeadlineTarget } from './core/deadlineNotify'
import { applyDeadlineOverrides, getDeadlineOverrides } from './core/deadlineOverride'
import { resolveEffectiveTheme } from './core/theme'
import { AssignmentCard } from './components/AssignmentCard'
import { CollapsibleSection, Section } from './components/Section'
import {
  getTheme,
  saveTheme,
  getCourseUpdateNotifyEnabled,
  saveCourseUpdateNotifyEnabled,
  getNotificationRules,
  saveNotificationRules,
  syncToServer,
} from './core/premium'
import { DEFAULT_THRESHOLDS, type NotificationRules } from './background/notificationRules'
import { getOnboardingCompleted, setOnboardingCompleted } from './core/onboarding'
import { OnboardingBanner } from './components/OnboardingBanner'
import {
  getManualAssignments,
  addManualAssignment,
  deleteManualAssignment,
  toggleManualAssignmentSubmitted,
  type ManualAssignment,
} from './core/manualAssignment'
import { MANUAL_ASSIGNMENTS_KEY } from './background/storageKeys'
import { AssignmentMemo } from './components/AssignmentMemo'
import { ManualAssignmentCard } from './components/ManualAssignmentCard'
import { TimetableSection } from './components/TimetableSection'
import { TodayTimetable } from './components/TodayTimetable'
import { CourseUpdatesSection } from './components/CourseUpdatesSection'
import { AssignmentSlotContext } from './core/assignmentSlotContext'
import { getTimetableCapture } from './core/timetableStore'
import { getUnreadUpdates } from './background/courseUpdatesStore'
import { linkAssignmentsToSlots, applyOverrides, extractCourseCodes, type AssignmentSlotInfo } from './core/timetableLink'
import { parseTimetable } from './core/timetable'
import { academicYear } from './core/syllabus'
import { resolveViewSemester, loadCourseOverrides } from './core/timetableView'
import { SyllabusContext, type OpenSyllabus } from './core/syllabusContext'
import { SyllabusModal } from './components/SyllabusModal'
import { mergeTimeline } from './utils/timeline'
import {
  getManualUrgent,
  getManualTomorrow,
  getManualThisWeek,
  getManualLater,
  getManualSubmitted,
} from './utils/manualAssignment'
import { isConsented, saveConsent } from './legal/termsConsent'
import { TermsConsentScreen } from './components/TermsConsentScreen'

// 自前バックエンドは凍結中（VITE_API_BASE_URL 未設定=空）。空なら syncToServer 等は no-op。
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string ?? ''

export default function App() {
  const isDashboard = window.location.hash === '#dashboard'

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [assignmentSlotMap, setAssignmentSlotMap] = useState<Record<string, AssignmentSlotInfo>>({})
  const [hasTimetable, setHasTimetable] = useState(false)
  const [newBadgeCodes, setNewBadgeCodes] = useState<string[]>([])
  const [syllabusTarget, setSyllabusTarget] = useState<{ year: number; code: string; name: string } | null>(null)
  const openSyllabus: OpenSyllabus = (year, code, name) => setSyllabusTarget({ year, code, name })
  const [ignoredAssignmentIds, setIgnoredAssignmentIds] = useState<string[]>([])
  const [lastHiddenAssignment, setLastHiddenAssignment] =
    useState<Assignment | null>(null)
  const [lastDeletedManualAssignment, setLastDeletedManualAssignment] =
    useState<ManualAssignment | null>(null)
  const [assignmentScanStatus, setAssignmentScanStatus] =
    useState<AssignmentScanStatus>(initialAssignmentScanStatus)
  const [deadlineScanStatus, setDeadlineScanStatus] =
    useState<DeadlineScanStatus>(initialDeadlineScanStatus)
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null)
  const [manualAssignments, setManualAssignments] = useState<ManualAssignment[]>([])
  const [isUpdating, setIsUpdating] = useState(false)
  const [theme, setTheme] = useState('default')
  const [courseUpdateNotifyEnabled, setCourseUpdateNotifyEnabled] = useState(true)
  const [notificationRules, setNotificationRules] = useState<NotificationRules>({
    version: 1,
    defaultThresholds: DEFAULT_THRESHOLDS,
    courseOverrides: {},
  })
  const [message, setMessage] = useState('')
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [consentState, setConsentState] = useState<'loading' | 'needed' | 'ok'>('loading')
  const hasAutoRefreshCheckedRef = useRef(false)
  const hasCheckedDeadlineNotificationRef = useRef(false)

  useEffect(() => {
    void (async () => {
      const now = new Date()
      const year = academicYear(now)
      const semester = await resolveViewSemester(year, now)
      const cap = await getTimetableCapture(year, semester)
      setHasTimetable(cap !== null)
      if (!cap) {
        setAssignmentSlotMap({})
        return
      }
      const overrides = await loadCourseOverrides(year, semester, courses)
      const slots = applyOverrides(parseTimetable(cap.rawTableHtml), overrides)
      const { assignmentInfo } = linkAssignmentsToSlots(slots, courses, assignments)
      setAssignmentSlotMap(assignmentInfo)
    })()
  }, [courses, assignments])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const codes = new Set<string>()
      for (const course of courses) {
        const unread = await getUnreadUpdates(course.id)
        if (unread.length > 0) for (const code of extractCourseCodes(course.name)) codes.add(code)
      }
      if (!cancelled) setNewBadgeCodes(Array.from(codes))
    })()
    return () => { cancelled = true }
  }, [courses])

  async function refreshAll() {
    const [
      savedAssignments,
      savedCourses,
      savedIgnoredAssignmentIds,
      savedAssignmentScanStatus,
      savedDeadlineScanStatus,
      savedLastRefreshAt,
      savedManualAssignments,
      overrides,
    ] = await Promise.all([
      getAssignments(),
      getCourses(),
      getIgnoredAssignmentIds(),
      getAssignmentScanStatus(),
      getDeadlineScanStatus(),
      getLastRefreshAt(),
      getManualAssignments(),
      getDeadlineOverrides(),
    ])

    setAssignments(applyDeadlineOverrides(savedAssignments, overrides))
    setCourses(savedCourses)
    setIgnoredAssignmentIds(savedIgnoredAssignmentIds)
    setAssignmentScanStatus(savedAssignmentScanStatus)
    setDeadlineScanStatus(savedDeadlineScanStatus)
    setLastRefreshAt(savedLastRefreshAt)
    setManualAssignments(savedManualAssignments)
  }

  async function checkDeadlineWarningNotifications(
    sourceAssignments: Assignment[],
    sourceCourses: Course[],
    sourceIgnoredIds: string[],
    sourceManualAssignments: ManualAssignment[],
  ) {
    const ignoredSet = new Set(sourceIgnoredIds)
    // ルールは state ではなく保存値から読む（クロージャで state に依存させず、常に最新を反映）。
    const [notifiedKeys, rules] = await Promise.all([
      getNotifiedDeadlineKeys(),
      getNotificationRules(),
    ])

    const visibleTargets = sourceAssignments.filter(
      (assignment) =>
        !ignoredSet.has(assignment.id) &&
        isAssignmentVisibleByCourse(assignment, sourceCourses) &&
        assignment.deadline &&
        !isSubmittedAssignment(assignment) &&
        assignment.lifecycleStatus !== 'passed',
    )

    const manualTargets = sourceManualAssignments.filter(
      (assignment) => !assignment.submitted && assignment.deadline,
    )

    const targets: DeadlineTarget[] = [
      ...visibleTargets
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

    const notifications = computeDeadlineNotifications(
      targets,
      rules,
      new Set(notifiedKeys),
      Date.now(),
    )
    if (notifications.length === 0) return

    const nextNotifiedKeys = new Set(notifiedKeys)
    for (const n of notifications) {
      createNotification(n.notificationId, n.title, n.message, n.url)
      nextNotifiedKeys.add(n.notifyKey)
    }
    await saveNotifiedDeadlineKeys(Array.from(nextNotifiedKeys))
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshAll()
  }, [])

  useEffect(() => {
    void (async () => {
      const savedTheme = await getTheme()
      setTheme(savedTheme) // data-theme の適用は theme を依存にした別 effect が担当

      const savedRules = await getNotificationRules()
      if (savedRules) setNotificationRules(savedRules)

      setCourseUpdateNotifyEnabled(await getCourseUpdateNotifyEnabled())
    })()
  }, [])

  // テーマの適用: theme が 'auto' の間は OS の prefers-color-scheme に追従し、
  // 明示指定(light/dark)なら固定。theme が変わるたび実効テーマを data-theme に張る。
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.setAttribute('data-theme', resolveEffectiveTheme(theme, mql.matches))
    }
    apply()
    if (theme === 'auto') {
      mql.addEventListener('change', apply)
      return () => mql.removeEventListener('change', apply)
    }
  }, [theme])

  useEffect(() => {
    void isConsented().then((consented) => {
      setConsentState(consented ? 'ok' : 'needed')
    })
  }, [])

  useEffect(() => {
    void getOnboardingCompleted().then((completed) => {
      if (!completed) setShowOnboarding(true)
    })
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
    function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>) {
      if (MANUAL_ASSIGNMENTS_KEY in changes) {
        const newValue = changes[MANUAL_ASSIGNMENTS_KEY].newValue as ManualAssignment[] | undefined
        setManualAssignments(newValue ?? [])
      }
    }

    chrome.storage.local.onChanged.addListener(onStorageChanged)
    return () => chrome.storage.local.onChanged.removeListener(onStorageChanged)
  }, [])

  useEffect(() => {
    if (consentState !== 'ok') {
      return
    }

    if (hasCheckedDeadlineNotificationRef.current) {
      return
    }

    hasCheckedDeadlineNotificationRef.current = true

    void (async () => {
      const savedAssignments = await getAssignments()
      const savedCourses = await getCourses()
      const savedIgnoredIds = await getIgnoredAssignmentIds()
      const savedManualAssignments = await getManualAssignments()
      const overrides = await getDeadlineOverrides()

      await checkDeadlineWarningNotifications(
        applyDeadlineOverrides(savedAssignments, overrides),
        savedCourses,
        savedIgnoredIds,
        savedManualAssignments,
      )
    })()
  }, [consentState])

  const updateNow = useCallback(async () => {
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

      const scanResponse = await chrome.runtime.sendMessage({
        type: 'START_FULL_UPDATE',
      }) as ScanStartResponse

      const scanOutcome = classifyScanStartResponse(scanResponse)
      if (scanOutcome.kind === 'abort') {
        setMessage(scanOutcome.message)
        return
      }
      if (scanOutcome.kind === 'error') {
        throw new Error(scanOutcome.reason)
      }

      // 実処理・最終更新時刻の保存・締切通知・完了通知は service worker 側で走る
      // （ポップアップ/ダッシュボードを閉じても完走する）。ここでは進捗表示のため
      // 両スキャンの状態をポーリングし、完了後に画面を最新化するだけ。
      await waitForAssignmentScanToFinish(refreshAll)
      await waitForDeadlineScanToFinish(refreshAll)

      await refreshAll()
      if (showOnboarding) {
        await setOnboardingCompleted()
        setShowOnboarding(false)
      }
      setMessage('更新が完了しました。')
    } catch (error) {
      // 実処理・最終化・完了/失敗通知は SW 側で継続・完了する（popup のタイムアウトで
      // 誤ってエラー通知を出さない）。ここでは画面表示のみ。
      const normalizedMessage = normalizeUpdateError(error)
      console.error(error)
      setMessage(normalizedMessage)
    } finally {
      setIsUpdating(false)
    }
  }, [showOnboarding])

  useEffect(() => {
    if (consentState !== 'ok') {
      return
    }

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
          `letus-task-watcher-stale`,
          'LETUS Task Watcher',
          `前回更新から${getElapsedText(savedLastRefreshAt)}です。自動更新を開始します。`,
        )

        await saveLastStaleNotificationAt(new Date().toISOString())
      }

      setMessage('前回更新から2時間以上経過したため、自動更新します。')
      await updateNow()
    })()
    // updateNow を依存に含めると useCallback の再生成のたびに実行され得るが、
    // hasAutoRefreshCheckedRef のガードにより本体は consentState==='ok' になった最初の1回しか走らないため意図的に外す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consentState])

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

  const scanErrorMessage = useMemo(() => {
    if (assignmentScanStatus.state === 'error') {
      return normalizeUpdateError(assignmentScanStatus.errorMessage ?? '')
    }
    if (deadlineScanStatus.state === 'error') {
      return normalizeUpdateError(deadlineScanStatus.errorMessage ?? '')
    }
    return null
  }, [assignmentScanStatus, deadlineScanStatus])

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

  const manualUrgent = useMemo(
    () => getManualUrgent(manualAssignments),
    [manualAssignments],
  )

  const manualTomorrow = useMemo(
    () => getManualTomorrow(manualAssignments),
    [manualAssignments],
  )

  const manualThisWeek = useMemo(
    () => getManualThisWeek(manualAssignments),
    [manualAssignments],
  )

  const manualLater = useMemo(
    () => getManualLater(manualAssignments),
    [manualAssignments],
  )

  const manualSubmitted = useMemo(
    () => getManualSubmitted(manualAssignments),
    [manualAssignments],
  )

  const urgentTimeline = useMemo(
    () => mergeTimeline(urgentAssignments, manualUrgent),
    [urgentAssignments, manualUrgent],
  )

  const tomorrowTimeline = useMemo(
    () => mergeTimeline(tomorrowAssignments, manualTomorrow),
    [tomorrowAssignments, manualTomorrow],
  )

  const thisWeekTimeline = useMemo(
    () => mergeTimeline(thisWeekAssignments, manualThisWeek),
    [thisWeekAssignments, manualThisWeek],
  )

  const laterTimeline = useMemo(
    () => mergeTimeline(laterAssignments, manualLater),
    [laterAssignments, manualLater],
  )

  const submittedTimeline = useMemo(
    () => mergeTimeline(submittedAssignments, manualSubmitted),
    [submittedAssignments, manualSubmitted],
  )

  const isBackgroundRunning =
    assignmentScanStatus.state === 'running' ||
    deadlineScanStatus.state === 'running'

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

  const persistNotificationRules = async (next: NotificationRules) => {
    setNotificationRules(next)
    await saveNotificationRules(next)
    if (API_BASE_URL) void syncToServer(API_BASE_URL)
  }

  const toggleDefaultThreshold = (hours: number) => {
    const has = notificationRules.defaultThresholds.includes(hours)
    const nextThresholds = has
      ? notificationRules.defaultThresholds.filter((h) => h !== hours)
      : [...notificationRules.defaultThresholds, hours].sort((a, b) => a - b)
    void persistNotificationRules({ ...notificationRules, defaultThresholds: nextThresholds })
  }

  const toggleCourseOverride = (courseId: string) => {
    const overrides = { ...notificationRules.courseOverrides }
    if (overrides[courseId]) {
      delete overrides[courseId]
    } else {
      overrides[courseId] = { muted: false, thresholds: [...notificationRules.defaultThresholds] }
    }
    void persistNotificationRules({ ...notificationRules, courseOverrides: overrides })
  }

  const toggleCourseMuted = (courseId: string) => {
    const current = notificationRules.courseOverrides[courseId]
    if (!current) return
    const overrides = {
      ...notificationRules.courseOverrides,
      [courseId]: { ...current, muted: !current.muted },
    }
    void persistNotificationRules({ ...notificationRules, courseOverrides: overrides })
  }

  const toggleCourseThreshold = (courseId: string, hours: number) => {
    const current = notificationRules.courseOverrides[courseId]
    if (!current) return
    const has = current.thresholds.includes(hours)
    const nextThresholds = has
      ? current.thresholds.filter((h) => h !== hours)
      : [...current.thresholds, hours].sort((a, b) => a - b)
    const overrides = {
      ...notificationRules.courseOverrides,
      [courseId]: { ...current, thresholds: nextThresholds },
    }
    void persistNotificationRules({ ...notificationRules, courseOverrides: overrides })
  }

  async function toggleCourse(courseId: string) {
    const updatedCourses = courses.map((course) => {
      if (course.id !== courseId) {
        return course
      }

      return {
        ...course,
        enabled: !course.enabled,
        userToggled: true,
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
        userToggled: true,
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
    setMessage('コース選択をリセットしました。')
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

  async function handleDeleteManualAssignment(id: string) {
    const target = manualAssignments.find((a) => a.id === id)
    await deleteManualAssignment(id)
    setManualAssignments((prev) => prev.filter((a) => a.id !== id))
    setLastDeletedManualAssignment(target ?? null)
    setMessage('手動課題を削除しました。')
  }

  async function handleToggleManualSubmitted(id: string) {
    await toggleManualAssignmentSubmitted(id)
    setManualAssignments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, submitted: !a.submitted } : a)),
    )
  }

  async function undoLastDeletedManualAssignment() {
    if (!lastDeletedManualAssignment) {
      return
    }

    await addManualAssignment(lastDeletedManualAssignment)
    setManualAssignments((prev) => [...prev, lastDeletedManualAssignment])
    setLastDeletedManualAssignment(null)
    setMessage('手動課題を元に戻しました。')
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
      MANUAL_ASSIGNMENTS_KEY,
    ])

    setAssignments([])
    setCourses([])
    setIgnoredAssignmentIds([])
    setLastHiddenAssignment(null)
    setAssignmentScanStatus(initialAssignmentScanStatus)
    setDeadlineScanStatus(initialDeadlineScanStatus)
    setLastRefreshAt(null)
    setManualAssignments([])
    setMessage('保存データをすべて初期化しました。')
  }

  function openDashboard() {
    chrome.tabs.create({
      url: chrome.runtime.getURL('index.html#dashboard'),
    })
  }

  function openFeedbackForm() {
    void chrome.tabs.create({ url: FEEDBACK_FORM_URL })
  }

  async function toggleCourseUpdateNotify() {
    const next = !courseUpdateNotifyEnabled
    setCourseUpdateNotifyEnabled(next)
    await saveCourseUpdateNotifyEnabled(next)
  }

  // 通知タイミング設定（ローカル保存の実機能）。
  const notificationRulesSettings = (
    <>
      <div className="notificationRulesSection">
        <p className="premiumSectionLabel">コース内容の更新通知</p>
        <p className="notificationHint">
          登録コースに新しい教材・課題が増えたときに通知します。下の「コース別」でミュートしたコースは通知しません。
        </p>
        <label className="muteToggle">
          <input
            type="checkbox"
            checked={courseUpdateNotifyEnabled}
            onChange={() => void toggleCourseUpdateNotify()}
          />
          <span>コース更新を通知する</span>
        </label>
      </div>

      <div className="notificationRulesSection">
        <p className="premiumSectionLabel">通知タイミング（全体）</p>
        <p className="notificationHint">
          締切の何時間前に通知するかを選べます。科目ごとに個別のタイミングも設定できます。
        </p>
        <div className="thresholdChips">
          {[1, 3, 6, 12, 24, 48, 72].map((hours) => (
            <button
              key={hours}
              type="button"
              className={`thresholdChip ${notificationRules.defaultThresholds.includes(hours) ? 'active' : ''}`}
              onClick={() => toggleDefaultThreshold(hours)}
            >
              {hours}時間前
            </button>
          ))}
        </div>
      </div>

      <div className="notificationRulesSection">
        <p className="premiumSectionLabel">通知タイミング（コース別）</p>
        {courses.length === 0 ? (
          <p className="notificationHint">
            LETUSのコースを開くと、ここでコース別に設定できます。
          </p>
        ) : (
          courses.map((course) => {
            const override = notificationRules.courseOverrides[course.id]
            return (
              <div key={course.id} className="courseRuleRow">
                <label className="courseRuleHead">
                  <input
                    type="checkbox"
                    checked={Boolean(override)}
                    onChange={() => toggleCourseOverride(course.id)}
                  />
                  <span>{course.name}</span>
                </label>
                {override && (
                  <div className="courseRuleBody">
                    <label className="muteToggle">
                      <input
                        type="checkbox"
                        checked={override.muted}
                        onChange={() => toggleCourseMuted(course.id)}
                      />
                      <span>このコースをミュート</span>
                    </label>
                    {!override.muted && (
                      <div className="thresholdChips">
                        {[1, 3, 6, 12, 24, 48, 72].map((hours) => (
                          <button
                            key={hours}
                            type="button"
                            className={`thresholdChip ${override.thresholds.includes(hours) ? 'active' : ''}`}
                            onClick={() => toggleCourseThreshold(course.id, hours)}
                          >
                            {hours}時間前
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </>
  )

  if (consentState === 'loading') {
    return <main className={`app ${isDashboard ? 'dashboard' : 'popup'}`} />
  }

  if (consentState === 'needed') {
    return (
      <main className={`app ${isDashboard ? 'dashboard' : 'popup'}`}>
        <TermsConsentScreen
          onAccept={async () => {
            await saveConsent()
            setConsentState('ok')
          }}
        />
      </main>
    )
  }

  return (
    <AssignmentSlotContext.Provider value={assignmentSlotMap}>
    <SyllabusContext.Provider value={isDashboard ? openSyllabus : null}>
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

      {scanErrorMessage && (
        <div className="errorBanner">
          <strong>更新に失敗しました。前回のデータを表示しています。</strong>
          <span>{scanErrorMessage}</span>
        </div>
      )}

      {message && <p className="message">{message}</p>}

      {lastHiddenAssignment && (
        <div className="undoToast">
          <span>「{lastHiddenAssignment.title}」を非表示にしました。</span>

          <button type="button" onClick={() => void undoLastHiddenAssignment()}>
            元に戻す
          </button>
        </div>
      )}

      {lastDeletedManualAssignment && (
        <div className="undoToast">
          <span>「{lastDeletedManualAssignment.title}」を削除しました。</span>

          <button
            type="button"
            onClick={() => void undoLastDeletedManualAssignment()}
          >
            元に戻す
          </button>
        </div>
      )}

      {!isDashboard && showOnboarding && (
        <OnboardingBanner courses={courses} lastRefreshAt={lastRefreshAt} hasTimetable={hasTimetable} />
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
              <strong>{urgentTimeline.length}</strong>
            </div>

            <div>
              <span>今週</span>
              <strong>
                {tomorrowTimeline.length + thisWeekTimeline.length}
              </strong>
            </div>

            <div>
              <span>対象コース</span>
              <strong>{selectedCourseCount}</strong>
            </div>
          </section>

          <TodayTimetable
            courses={courses}
            assignments={assignments}
            manualAssignments={manualAssignments}
            newCodes={newBadgeCodes}
          />

          <Section
            title="24時間以内"
            count={urgentTimeline.length}
            emptyText="24時間以内の提出物はありません。"
          >
            {urgentTimeline.slice(0, 3).map((item) =>
              item.kind === 'scan' ? (
                <div key={item.assignment.id} className="popupCardWrap">
                  <AssignmentCard assignment={item.assignment} compact />
                </div>
              ) : (
                <div key={item.assignment.id} className="popupCardWrap">
                  <ManualAssignmentCard
                    assignment={item.assignment}
                    onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                    onDelete={(id) => void handleDeleteManualAssignment(id)}
                  />
                </div>
              ),
            )}
          </Section>

          {tomorrowTimeline.length + thisWeekTimeline.length > 0 && (
            <Section
              title="次の課題"
              count={Math.min(
                tomorrowTimeline.length + thisWeekTimeline.length,
                3,
              )}
              emptyText="今後の課題はありません。"
            >
              {[...tomorrowTimeline, ...thisWeekTimeline]
                .slice(0, 3)
                .map((item) =>
                  item.kind === 'scan' ? (
                    <div key={item.assignment.id} className="popupCardWrap">
                      <AssignmentCard assignment={item.assignment} compact />
                    </div>
                  ) : (
                    <div key={item.assignment.id} className="popupCardWrap">
                      <ManualAssignmentCard
                        assignment={item.assignment}
                        onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                        onDelete={(id) => void handleDeleteManualAssignment(id)}
                      />
                    </div>
                  ),
                )}
            </Section>
          )}

          <button
            type="button"
            className="dashboardBtn"
            onClick={openDashboard}
          >
            ダッシュボードを開く
          </button>

          <footer className="feedbackFooter">
            <button type="button" onClick={openFeedbackForm}>
              バグ報告・ご意見
            </button>
          </footer>
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

          <TimetableSection
            courses={courses}
            assignments={assignments}
            manualAssignments={manualAssignments}
            newCodes={newBadgeCodes}
          />

          <CourseUpdatesSection courses={courses} />

          <Section
            title="24時間以内"
            count={urgentTimeline.length}
            emptyText="24時間以内の提出物はありません。"
          >
            {urgentTimeline.map((item) =>
              item.kind === 'scan' ? (
                <div key={item.assignment.id}>
                  <AssignmentCard
                    assignment={item.assignment}
                    canHide
                    onHide={hideAssignment}
                  />
                  <AssignmentMemo assignmentId={item.assignment.id} apiBaseUrl={API_BASE_URL} />
                </div>
              ) : (
                <div key={item.assignment.id}>
                  <ManualAssignmentCard
                    assignment={item.assignment}
                    onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                    onDelete={(id) => void handleDeleteManualAssignment(id)}
                  />
                  <AssignmentMemo assignmentId={item.assignment.id} apiBaseUrl={API_BASE_URL} />
                </div>
              ),
            )}
          </Section>

          <Section
            title="明日まで"
            count={tomorrowTimeline.length}
            emptyText="明日までの課題はありません。"
          >
            {tomorrowTimeline.map((item) =>
              item.kind === 'scan' ? (
                <div key={item.assignment.id}>
                  <AssignmentCard
                    assignment={item.assignment}
                    canHide
                    onHide={hideAssignment}
                  />
                  <AssignmentMemo assignmentId={item.assignment.id} apiBaseUrl={API_BASE_URL} />
                </div>
              ) : (
                <div key={item.assignment.id}>
                  <ManualAssignmentCard
                    assignment={item.assignment}
                    onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                    onDelete={(id) => void handleDeleteManualAssignment(id)}
                  />
                  <AssignmentMemo assignmentId={item.assignment.id} apiBaseUrl={API_BASE_URL} />
                </div>
              ),
            )}
          </Section>

          <Section
            title="今週"
            count={thisWeekTimeline.length}
            emptyText="今週中の課題はありません。"
          >
            {thisWeekTimeline.map((item) =>
              item.kind === 'scan' ? (
                <div key={item.assignment.id}>
                  <AssignmentCard
                    assignment={item.assignment}
                    canHide
                    onHide={hideAssignment}
                  />
                  <AssignmentMemo assignmentId={item.assignment.id} apiBaseUrl={API_BASE_URL} />
                </div>
              ) : (
                <div key={item.assignment.id}>
                  <ManualAssignmentCard
                    assignment={item.assignment}
                    onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                    onDelete={(id) => void handleDeleteManualAssignment(id)}
                  />
                  <AssignmentMemo assignmentId={item.assignment.id} apiBaseUrl={API_BASE_URL} />
                </div>
              ),
            )}
          </Section>

          <Section
            title="それ以降"
            count={laterTimeline.length}
            emptyText="それ以降の課題はありません。"
          >
            {laterTimeline.map((item) =>
              item.kind === 'scan' ? (
                <div key={item.assignment.id}>
                  <AssignmentCard
                    assignment={item.assignment}
                    canHide
                    onHide={hideAssignment}
                  />
                  <AssignmentMemo assignmentId={item.assignment.id} apiBaseUrl={API_BASE_URL} />
                </div>
              ) : (
                <div key={item.assignment.id}>
                  <ManualAssignmentCard
                    assignment={item.assignment}
                    onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                    onDelete={(id) => void handleDeleteManualAssignment(id)}
                  />
                  <AssignmentMemo assignmentId={item.assignment.id} apiBaseUrl={API_BASE_URL} />
                </div>
              ),
            )}
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
            count={submittedTimeline.length}
            emptyText="提出済みの課題はありません。"
          >
            {submittedTimeline.map((item) =>
              item.kind === 'scan' ? (
                <AssignmentCard
                  key={item.assignment.id}
                  assignment={item.assignment}
                  canHide
                  onHide={hideAssignment}
                />
              ) : (
                <ManualAssignmentCard
                  key={item.assignment.id}
                  assignment={item.assignment}
                  onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                  onDelete={(id) => void handleDeleteManualAssignment(id)}
                />
              ),
            )}
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

          <h2 className="settingsHeading">設定</h2>

          <details className="settings">
            <summary>対象コースの選択</summary>

            <div className="settingsMeta">
              対象: {selectedCourseCount}/{courses.length} コース
            </div>

            <p className="courseSelectNote">
              自動選択は時間割の科目コードと一致したLETUSコースのみが対象です。common module など一部の科目は自動で選ばれないことがあります。追跡したい科目が下に無い・OFFのままの場合は手動でONにしてください。
            </p>

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

          <details className="settings">
            <summary>通知設定</summary>
            <div className="premiumSettingsBody">
              {notificationRulesSettings}
            </div>
          </details>

          <div className="displaySettings">
            <span className="displaySettingsLabel">テーマ</span>
            <div className="themeSelector">
              {(['auto', 'default', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`themeBtn ${theme === t ? 'active' : ''}`}
                  onClick={() => {
                    setTheme(t)
                    void saveTheme(t)
                  }}
                >
                  {t === 'auto' ? '自動' : t === 'default' ? 'ライト' : 'ダーク'}
                </button>
              ))}
            </div>
          </div>

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
                コース選択をリセット
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

          <footer className="feedbackFooter">
            <button type="button" onClick={openFeedbackForm}>
              バグ報告・ご意見
            </button>
          </footer>
        </>
      )}
    </main>
    {syllabusTarget && (
      <SyllabusModal
        key={`${syllabusTarget.year}:${syllabusTarget.code}`}
        year={syllabusTarget.year}
        code={syllabusTarget.code}
        courseName={syllabusTarget.name}
        onClose={() => setSyllabusTarget(null)}
      />
    )}
    </SyllabusContext.Provider>
    </AssignmentSlotContext.Provider>
  )
}
