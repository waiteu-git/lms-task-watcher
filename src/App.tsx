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
  ONE_DAY_MS,
  ONE_HOUR_MS,
  STALE_NOTIFICATION_INTERVAL_MS,
  THREE_HOURS_MS,
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
  saveLastRefreshAt,
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
  getUrgentAssignments,
  isAssignmentVisibleByCourse,
  isOldPassedAssignment,
  isSubmittedAssignment,
  sortByDeadline,
} from './utils/assignment'
import { createNotification, normalizeUpdateError } from './utils/notification'
import { AssignmentCard } from './components/AssignmentCard'
import { CollapsibleSection, Section } from './components/Section'
import { getTheme } from './core/premium'
import { saveSubscriptionCache } from './core/auth'
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
import { ManualAssignmentCard } from './components/ManualAssignmentCard'
import { mergeTimeline } from './utils/timeline'
import {
  getManualUrgent,
  getManualTomorrow,
  getManualThisWeek,
  getManualLater,
  getManualSubmitted,
} from './utils/manualAssignment'

export default function App() {
  const isDashboard = window.location.hash === '#dashboard'

  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [courses, setCourses] = useState<Course[]>([])
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
  const [isSubscriber, setIsSubscriber] = useState(false)
  const [message, setMessage] = useState('')
  const [showOnboarding, setShowOnboarding] = useState(false)
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
      savedManualAssignments,
    ] = await Promise.all([
      getAssignments(),
      getCourses(),
      getIgnoredAssignmentIds(),
      getAssignmentScanStatus(),
      getDeadlineScanStatus(),
      getLastRefreshAt(),
      getManualAssignments(),
    ])

    setAssignments(savedAssignments)
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

    const manualTargets = sourceManualAssignments.filter(
      (assignment) => !assignment.submitted && assignment.deadline,
    )

    type NotifyTarget = { id: string; title: string; courseName: string; deadline: string }

    const allTargets: NotifyTarget[] = [
      ...visibleTargets
        .filter((a): a is Assignment & { deadline: string } => a.deadline !== null)
        .map((a) => ({ id: a.id, title: a.title, courseName: a.courseName, deadline: a.deadline })),
      ...manualTargets.map((a) => ({ id: a.id, title: a.title, courseName: a.courseName, deadline: a.deadline })),
    ]

    for (const target of allTargets) {
      const diff = new Date(target.deadline).getTime() - Date.now()

      if (diff <= 0) {
        continue
      }

      const oneHourKey = `${target.id}:1h`
      const threeHourKey = `${target.id}:3h`
      const oneDayKey = `${target.id}:24h`

      if (diff <= ONE_HOUR_MS && !notifiedSet.has(oneHourKey)) {
        createNotification(
          `letus-task-watcher-deadline-1h-${target.id}-${Date.now()}`,
          '締切まで1時間以内',
          `${target.title}\n${target.courseName}`,
        )

        nextNotifiedKeys.add(oneHourKey)
        changed = true
        continue
      }

      if (diff <= THREE_HOURS_MS && !notifiedSet.has(threeHourKey)) {
        createNotification(
          `letus-task-watcher-deadline-3h-${target.id}-${Date.now()}`,
          '締切まで3時間以内',
          `${target.title}\n${target.courseName}`,
        )

        nextNotifiedKeys.add(threeHourKey)
        changed = true
        continue
      }

      if (diff <= ONE_DAY_MS && !notifiedSet.has(oneDayKey)) {
        createNotification(
          `letus-task-watcher-deadline-24h-${target.id}-${Date.now()}`,
          '締切まで24時間以内',
          `${target.title}\n${target.courseName}`,
        )

        nextNotifiedKeys.add(oneDayKey)
        changed = true
      }
    }

    if (changed) {
      await saveNotifiedDeadlineKeys(Array.from(nextNotifiedKeys))
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshAll()
  }, [])

  useEffect(() => {
    void getTheme().then((savedTheme) => {
      document.documentElement.setAttribute('data-theme', savedTheme)
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
    if (hasCheckedDeadlineNotificationRef.current) {
      return
    }

    hasCheckedDeadlineNotificationRef.current = true

    void (async () => {
      const savedAssignments = await getAssignments()
      const savedCourses = await getCourses()
      const savedIgnoredIds = await getIgnoredAssignmentIds()
      const savedManualAssignments = await getManualAssignments()

      await checkDeadlineWarningNotifications(
        savedAssignments,
        savedCourses,
        savedIgnoredIds,
        savedManualAssignments,
      )
    })()
  }, [])

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
        type: 'START_ASSIGNMENT_SCAN',
        scanLevel: 'standard',
      }) as { ok: boolean; reason: string }

      if (!scanResponse.ok) {
        if (scanResponse.reason === 'not_logged_in') {
          setMessage('LETUSにログインしてからもう一度試してください。')
          return
        }
        throw new Error(scanResponse.reason)
      }

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
        manualAssignments,
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
      if (showOnboarding) {
        await setOnboardingCompleted()
        setShowOnboarding(false)
      }
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
  }, [showOnboarding, manualAssignments])

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
  }, [updateNow])

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
        <OnboardingBanner courses={courses} lastRefreshAt={lastRefreshAt} />
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
              <div key={assignment.id} className="popupCardWrap">
                <AssignmentCard
                  assignment={assignment}
                  compact
                />
              </div>
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
                  <div key={assignment.id} className="popupCardWrap">
                    <AssignmentCard
                      assignment={assignment}
                      compact
                    />
                  </div>
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
                </div>
              ) : (
                <ManualAssignmentCard
                  key={item.assignment.id}
                  assignment={item.assignment}
                  onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                  onDelete={(id) => void handleDeleteManualAssignment(id)}
                />
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
                </div>
              ) : (
                <ManualAssignmentCard
                  key={item.assignment.id}
                  assignment={item.assignment}
                  onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                  onDelete={(id) => void handleDeleteManualAssignment(id)}
                />
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
                </div>
              ) : (
                <ManualAssignmentCard
                  key={item.assignment.id}
                  assignment={item.assignment}
                  onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                  onDelete={(id) => void handleDeleteManualAssignment(id)}
                />
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
                </div>
              ) : (
                <ManualAssignmentCard
                  key={item.assignment.id}
                  assignment={item.assignment}
                  onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}
                  onDelete={(id) => void handleDeleteManualAssignment(id)}
                />
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

          {__DEV_TOOLS__ && (
            <details className="settings devPanel">
              <summary>🛠 開発用: サブスク状態</summary>
              <div className="devPanelBody">
                <span>現在: <strong>{isSubscriber ? '✅ サブスクライバー' : '❌ 非サブスクライバー'}</strong></span>
                <div className="devPanelActions">
                  <button
                    type="button"
                    onClick={async () => {
                      await saveSubscriptionCache('active', null)
                      setIsSubscriber(true)
                    }}
                  >
                    サブスクON
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await chrome.storage.local.remove(['subscriptionStatus', 'subscriptionCheckedAt', 'subscriptionGraceUntil'])
                      setIsSubscriber(false)
                    }}
                  >
                    サブスクOFF
                  </button>
                </div>
              </div>
            </details>
          )}

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
  )
}
