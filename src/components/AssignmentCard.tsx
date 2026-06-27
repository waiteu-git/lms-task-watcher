import type { KeyboardEvent, MouseEvent } from 'react'
import type { Assignment } from '../core/types'
import { formatDeadline, getRemaining } from '../utils/date'
import { getStatusLabel } from '../utils/assignment'

export function AssignmentCard({
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
