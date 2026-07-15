import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { ManualAssignment, ManualAssignmentPatch } from '../core/manualAssignment'
import type { Course } from '../core/types'
import { formatDeadline } from '../utils/date'

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ManualAssignmentCard({
  assignment,
  courses,
  onToggleSubmitted,
  onUpdate,
  onDelete,
}: {
  assignment: ManualAssignment
  courses: Course[]
  onToggleSubmitted: (id: string) => void
  onUpdate: (id: string, patch: ManualAssignmentPatch) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(assignment.title)
  const [deadline, setDeadline] = useState(toDatetimeLocal(assignment.deadline))
  const [courseId, setCourseId] = useState(assignment.courseId)
  const [memo, setMemo] = useState(assignment.memo)
  const [submitted, setSubmitted] = useState(assignment.submitted)
  const [error, setError] = useState('')

  function openAssignmentPage() {
    if (!assignment.letusUrl) return
    chrome.tabs.create({ url: assignment.letusUrl })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openAssignmentPage()
    }
  }

  function stop(event: MouseEvent<HTMLElement>) {
    event.stopPropagation()
    event.preventDefault()
  }

  function startEditing(event: MouseEvent<HTMLButtonElement>) {
    stop(event)
    setTitle(assignment.title)
    setDeadline(toDatetimeLocal(assignment.deadline))
    setCourseId(assignment.courseId)
    setMemo(assignment.memo)
    setSubmitted(assignment.submitted)
    setError('')
    setEditing(true)
  }

  function submitEdit() {
    const t = title.trim()
    if (!t) { setError('課題名を入力してください。'); return }
    if (!deadline) { setError('締切を入力してください。'); return }
    if (!courseId) { setError('コースを選択してください。'); return }
    const courseName = courses.find((c) => c.id === courseId)?.name ?? assignment.courseName
    onUpdate(assignment.id, {
      title: t,
      deadline: new Date(deadline).toISOString(),
      courseId,
      courseName,
      memo: memo.trim(),
      submitted,
    })
    setEditing(false)
  }

  const isClickable = Boolean(assignment.letusUrl) && !editing

  if (editing) {
    return (
      <article className="manualCard">
        <div className="manualEditForm" onClick={stop}>
          <input
            className="manualEditInput"
            type="text"
            value={title}
            placeholder="課題名"
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="manualEditInput"
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
          <select
            className="manualEditInput"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">コースを選択</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <textarea
            className="manualEditInput"
            value={memo}
            placeholder="メモ（任意）"
            onChange={(e) => setMemo(e.target.value)}
          />
          <label className="manualEditCheck">
            <input
              type="checkbox"
              checked={submitted}
              onChange={(e) => setSubmitted(e.target.checked)}
            />
            提出済み
          </label>
          {error && <div className="manualEditError">{error}</div>}
          <div className="manualEditActions">
            <button
              type="button"
              className="manualDeleteBtn"
              onClick={(e) => { stop(e); onDelete(assignment.id) }}
              aria-label={`${assignment.title}を削除`}
            >
              削除
            </button>
            <button type="button" className="manualEditCancel" onClick={() => setEditing(false)}>
              キャンセル
            </button>
            <button type="button" className="manualEditSave" onClick={submitEdit}>
              更新
            </button>
          </div>
        </div>
      </article>
    )
  }

  return (
    <article
      className="manualCard"
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? openAssignmentPage : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      title={isClickable ? 'クリックしてLETUSの課題ページを開く' : undefined}
    >
      <div className="manualCardTop">
        <span className="dateText">{formatDeadline(assignment.deadline)}</span>
        <span className="manualBadge">手動</span>
      </div>

      <div className="manualCardTitle">{assignment.title}</div>

      <div className="manualCardMeta">{assignment.courseName}</div>

      {assignment.memo && <div className="manualCardMemo">{assignment.memo}</div>}

      <div className="manualCardFooter">
        <button
          type="button"
          className={`manualSubmitToggle ${assignment.submitted ? 'submitted' : ''}`}
          onClick={(e) => { stop(e); onToggleSubmitted(assignment.id) }}
        >
          {assignment.submitted ? '✓ 提出済み' : '○ 未提出'}
        </button>

        <button
          type="button"
          className="manualEditBtn"
          onClick={startEditing}
        >
          編集
        </button>

        <button
          type="button"
          className="manualDeleteBtn"
          onClick={(e) => { stop(e); onDelete(assignment.id) }}
          aria-label={`${assignment.title}を削除`}
        >
          削除
        </button>
      </div>
    </article>
  )
}
