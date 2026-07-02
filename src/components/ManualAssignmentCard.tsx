import type { KeyboardEvent, MouseEvent } from 'react'
import type { ManualAssignment } from '../core/manualAssignment'
import { formatDeadline } from '../utils/date'

export function ManualAssignmentCard({
  assignment,
  onToggleSubmitted,
  onDelete,
  isSubscriber = false,
}: {
  assignment: ManualAssignment
  onToggleSubmitted: (id: string) => void
  onDelete: (id: string) => void
  isSubscriber?: boolean
}) {
  function openAssignmentPage() {
    if (!assignment.letusUrl) {
      return
    }

    chrome.tabs.create({
      url: assignment.letusUrl,
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openAssignmentPage()
    }
  }

  function handleToggleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    event.preventDefault()
    onToggleSubmitted(assignment.id)
  }

  function handleDeleteClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    event.preventDefault()
    onDelete(assignment.id)
  }

  const isClickable = Boolean(assignment.letusUrl)

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

      {assignment.memo && !isSubscriber && <div className="manualCardMemo">{assignment.memo}</div>}

      <div className="manualCardFooter">
        <button
          type="button"
          className={`manualSubmitToggle ${assignment.submitted ? 'submitted' : ''}`}
          onClick={handleToggleClick}
        >
          {assignment.submitted ? '✓ 提出済み' : '○ 未提出'}
        </button>

        <button
          type="button"
          className="manualDeleteBtn"
          onClick={handleDeleteClick}
          aria-label={`${assignment.title}を削除`}
        >
          削除
        </button>
      </div>
    </article>
  )
}
