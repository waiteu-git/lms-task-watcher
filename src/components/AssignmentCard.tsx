import { useContext, type KeyboardEvent, type MouseEvent } from 'react'
import type { Assignment } from '../core/types'
import { formatDeadline, getRemaining } from '../utils/date'
import { getStatusLabel } from '../utils/assignment'
import { AssignmentSlotContext } from '../core/assignmentSlotContext'
import { SyllabusContext } from '../core/syllabusContext'
import { buildSyllabusUrl, academicYear } from '../core/syllabus'

const DAY_LABEL_SHORT: Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat', string> = {
  mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土',
}

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
  const slotMap = useContext(AssignmentSlotContext)
  const slot = slotMap[assignment.id]
  const openSyllabus = useContext(SyllabusContext)

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
        <span className="dateText">
          {formatDeadline(assignment.deadline)}
          {assignment.deadlineSource === 'title' && (
            <span className="estimatedBadge" title="課題名から推定した締切です">
              （推定）
            </span>
          )}
        </span>
        <span className="remain">{getRemaining(assignment.deadline)}</span>
      </div>

      <div className="title">{assignment.title}</div>
      <div className="course">{assignment.courseName}</div>

      {!compact && slot && (
        <div className="assignmentSlotChips">
          <span className="slotChip slotChipDay">
            {DAY_LABEL_SHORT[slot.day]}{slot.period}
          </span>
          <span className="slotChip">{slot.room}</span>
          {openSyllabus ? (
            <button
              type="button"
              className="slotChip slotChipLink"
              onClick={(e) => {
                e.stopPropagation()
                openSyllabus(academicYear(new Date()), slot.courseCode, assignment.courseName)
              }}
            >
              シラバス
            </button>
          ) : (
            <a
              className="slotChip slotChipLink"
              href={buildSyllabusUrl(slot.courseCode, new Date())}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              シラバス
            </a>
          )}
        </div>
      )}

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
