import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './App.css'
import type { Assignment, Course } from './core/types'
import { getAssignments, getCourses, saveCourses } from './core/storage'

const ASSIGNMENT_SCAN_STATUS_KEY = 'assignmentScanStatus'
const DEADLINE_SCAN_STATUS_KEY = 'deadlineScanStatus'
const LAST_REFRESH_AT_KEY = 'lastSuccessfulRefreshAt'
const AUTO_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000

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
  const remainMinutes = minutes % 60

  if (hours < 24) {
    return remainMinutes === 0 ? `${hours}時間前` : `${hours}時間${remainMinutes}分前`
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

  return `${Math.floor(hours / 24)}日`
}

function isWithin24Hours(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const diff = new Date(deadline).getTime() - Date.now()
  return diff > 0 && diff <= 86_400_000
}

function isFutureAfter24Hours(deadline: string | null): boolean {
  if (!deadline) {
    return false
  }

  const diff = new Date(deadline).getTime() - Date.now()
  return diff > 86_400_000
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

function AssignmentCard({ assignment }: { assignment: Assignment }) {
  function openAssignmentPage() {
    chrome.tabs.create({
      url: assignment.url,
    })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openAssignmentPage()
    }
  }

  return (
    <article
      className={`card ${assignment.lifecycleStatus}`}
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

      <div className="statusPill">{getStatusLabel(assignment)}</div>
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
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [assignmentScanStatus, setAssignmentScanStatus] =
    useState<AssignmentScanStatus>(initialAssignmentScanStatus)
  const [deadlineScanStatus, setDeadlineScanStatus] =
    useState<DeadlineScanStatus>(initialDeadlineScanStatus)
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [message, setMessage] = useState('')
  const hasAutoRefreshCheckedRef = useRef(false)

  async function refreshAll() {
    const [
      savedAssignments,
      savedCourses,
      savedAssignmentScanStatus,
      savedDeadlineScanStatus,
      savedLastRefreshAt,
    ] = await Promise.all([
      getAssignments(),
      getCourses(),
      getAssignmentScanStatus(),
      getDeadlineScanStatus(),
      getLastRefreshAt(),
    ])

    setAssignments(savedAssignments)
    setCourses(savedCourses)
    setAssignmentScanStatus(savedAssignmentScanStatus)
    setDeadlineScanStatus(savedDeadlineScanStatus)
    setLastRefreshAt(savedLastRefreshAt)
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
    if (hasAutoRefreshCheckedRef.current) {
      return
    }

    hasAutoRefreshCheckedRef.current = true

    void (async () => {
      await refreshAll()

      const savedLastRefreshAt = await getLastRefreshAt()
      const selectedCourses = await getCourses()
      const selectedCourseCount = selectedCourses.filter((course) => course.enabled).length

      if (selectedCourseCount === 0) {
        return
      }

      if (!savedLastRefreshAt) {
        return
      }

      const elapsed = Date.now() - new Date(savedLastRefreshAt).getTime()

      if (elapsed >= AUTO_REFRESH_INTERVAL_MS) {
        setMessage('前回更新から2時間以上経過したため、自動更新します。')
        await updateNow()
      }
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
    return assignments.filter((assignment) => {
      const course = courses.find((candidate) => candidate.id === assignment.courseId)

      if (!course) {
        return true
      }

      return course.enabled
    })
  }, [assignments, courses])

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

  const futureAssignments = useMemo(() => {
    return visibleAssignments
      .filter((assignment) => {
        return (
          assignment.deadline &&
          isFutureAfter24Hours(assignment.deadline) &&
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

  const passedAssignments = useMemo(() => {
    return visibleAssignments
      .filter((assignment) => assignment.lifecycleStatus === 'passed')
      .sort(sortByDeadline)
  }, [visibleAssignments])

  const isBackgroundRunning =
    assignmentScanStatus.state === 'running' || deadlineScanStatus.state === 'running'

  async function updateNow() {
    if (selectedCourseCount === 0) {
      setMessage('読み込む科目を選択してください。')
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

      setLastRefreshAt(finishedAt)
      await refreshAll()

      setMessage('更新が完了しました。')
    } catch (error) {
      console.error(error)
      setMessage(String(error))
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

  return (
    <main className="app">
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

      <Section
        title="⏰ 24時間以内"
        count={urgentAssignments.length}
        emptyText="24時間以内の提出物はありません。"
      >
        {urgentAssignments.map((assignment) => (
          <AssignmentCard key={assignment.id} assignment={assignment} />
        ))}
      </Section>

      <Section
        title="📅 今後（近い順）"
        count={futureAssignments.length}
        emptyText="今後の課題はありません。"
      >
        {futureAssignments.map((assignment) => (
          <AssignmentCard key={assignment.id} assignment={assignment} />
        ))}
      </Section>

      <Section
        title="🟡 開始前"
        count={beforeStartAssignments.length}
        emptyText="開始前の課題はありません。"
      >
        {beforeStartAssignments.map((assignment) => (
          <AssignmentCard key={assignment.id} assignment={assignment} />
        ))}
      </Section>

      <Section
        title="✅ 提出済み・完了"
        count={submittedAssignments.length}
        emptyText="提出済みの課題はありません。"
      >
        {submittedAssignments.map((assignment) => (
          <AssignmentCard key={assignment.id} assignment={assignment} />
        ))}
      </Section>

      <Section
        title="⚫ 期限切れ"
        count={passedAssignments.length}
        emptyText="期限切れの課題はありません。"
      >
        {passedAssignments.map((assignment) => (
          <AssignmentCard key={assignment.id} assignment={assignment} />
        ))}
      </Section>

      <details className="settings">
        <summary>読み込む科目の選択</summary>

        <div className="settingsMeta">
          選択中: {selectedCourseCount}/{courses.length} 科目
        </div>

        <div className="courseList">
          {courses.length === 0 ? (
            <p className="emptyText">
              まだ科目がありません。前の画面で授業一覧を読み取ってください。
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
    </main>
  )
}