import type { ManualAssignment } from '../core/manualAssignment'

type Props = {
  assignments: ManualAssignment[]
  onDelete: (id: string) => void
}

function formatDeadline(isoString: string): string {
  const d = new Date(isoString)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${y}/${m}/${day} ${hh}:${mm}`
}

export function ManualAssignmentSection({ assignments, onDelete }: Props) {
  if (assignments.length === 0) return null

  return (
    <section className="manualAssignmentSection">
      <h2 className="manualAssignmentHeading">
        手動追加した課題
        <span className="manualAssignmentCount">{assignments.length}</span>
      </h2>

      <ul className="manualAssignmentList">
        {assignments.map((a) => (
          <li key={a.id} className="manualAssignmentItem">
            <div className="manualAssignmentMain">
              <div className="manualAssignmentTitle">
                {a.letusUrl ? (
                  <a
                    href={a.letusUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="manualAssignmentLink"
                  >
                    {a.title}
                  </a>
                ) : (
                  <span>{a.title}</span>
                )}
                <span className="manualBadge">手動</span>
              </div>

              <div className="manualAssignmentMeta">
                {a.courseName} · 締切 {formatDeadline(a.deadline)}
              </div>

              {a.memo && (
                <div className="manualAssignmentMemo">{a.memo}</div>
              )}
            </div>

            <button
              type="button"
              className="manualDeleteBtn"
              onClick={() => onDelete(a.id)}
              aria-label={`${a.title}を削除`}
            >
              削除
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
