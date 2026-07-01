import type { ManualAssignment } from '../core/manualAssignment'
import { formatDeadline } from '../utils/date'

export function ManualAssignmentCard({
  assignment,
  onToggleSubmitted,
  onDelete,
}: {
  assignment: ManualAssignment
  onToggleSubmitted: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <article className="manualCard">
      <div className="manualCardTop">
        <span className="dateText">{formatDeadline(assignment.deadline)}</span>
        <span className="manualBadge">手動</span>
      </div>

      <div className="manualCardTitle">
        {assignment.letusUrl ? (
          <a
            href={assignment.letusUrl}
            target="_blank"
            rel="noreferrer"
            className="manualAssignmentLink"
          >
            {assignment.title}
          </a>
        ) : (
          <span>{assignment.title}</span>
        )}
      </div>

      <div className="manualCardMeta">{assignment.courseName}</div>

      {assignment.memo && <div className="manualCardMemo">{assignment.memo}</div>}

      <div className="manualCardFooter">
        <button
          type="button"
          className={`manualSubmitToggle ${assignment.submitted ? 'submitted' : ''}`}
          onClick={() => onToggleSubmitted(assignment.id)}
        >
          {assignment.submitted ? '✓ 提出済み' : '○ 未提出'}
        </button>

        <button
          type="button"
          className="manualDeleteBtn"
          onClick={() => onDelete(assignment.id)}
          aria-label={`${assignment.title}を削除`}
        >
          削除
        </button>
      </div>
    </article>
  )
}
