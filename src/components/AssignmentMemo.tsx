import { useEffect, useRef, useState } from 'react'
import { getMemo, saveMemo, syncToServer, type AssignmentMemo as MemoData } from '../core/premium'

type Props = {
  assignmentId: string
  apiBaseUrl: string
}

const PRIORITY_LABELS: Record<0 | 1 | 2 | 3, string> = {
  0: 'なし',
  1: '低',
  2: '中',
  3: '高',
}

const PRIORITY_CLASS: Record<0 | 1 | 2 | 3, string> = {
  0: '',
  1: 'priority1',
  2: 'priority2',
  3: 'priority3',
}

export function AssignmentMemo({ assignmentId, apiBaseUrl }: Props) {
  const [memo, setMemo] = useState<MemoData>({ priority: 0, memo: '' })
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void getMemo(assignmentId).then(setMemo)
  }, [assignmentId])

  function stopProp(e: React.SyntheticEvent) {
    e.stopPropagation()
  }

  async function handlePriorityChange(priority: 0 | 1 | 2 | 3) {
    const updated = { ...memo, priority }
    setMemo(updated)
    setSaving(true)
    await saveMemo(assignmentId, updated)
    void syncToServer(apiBaseUrl)
    setSaving(false)
  }

  async function handleMemoChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const updated = { ...memo, memo: e.target.value }
    setMemo(updated)
    await saveMemo(assignmentId, updated)
    void syncToServer(apiBaseUrl)
  }

  const hasPriority = memo.priority > 0
  const hasMemoText = memo.memo.trim().length > 0

  return (
    <div ref={containerRef} className="memoContainer" onClick={stopProp}>
      <button
        type="button"
        className="memoToggleBtn"
        onClick={(e) => { stopProp(e); setOpen((v) => !v) }}
        aria-expanded={open}
      >
        <span className="memoToggleBtnIcon">✎</span>
        {hasPriority && (
          <span className={`memoPriorityChip ${PRIORITY_CLASS[memo.priority as 0|1|2|3]}`}>
            {PRIORITY_LABELS[memo.priority as 0|1|2|3]}
          </span>
        )}
        {hasMemoText && !open && (
          <span className="memoSnippet">
            {memo.memo.trim().slice(0, 24)}{memo.memo.trim().length > 24 ? '…' : ''}
          </span>
        )}
        <span className="memoToggleBtnArrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="memoPanel" onClick={stopProp}>
          <div className="prioritySelector">
            {([0, 1, 2, 3] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`priorityBtn priority${p} ${memo.priority === p ? 'active' : ''}`}
                onClick={(e) => { stopProp(e); void handlePriorityChange(p) }}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
            {saving && <span className="savingIndicator">保存中…</span>}
          </div>
          <textarea
            className="memoInput"
            placeholder="メモを入力..."
            value={memo.memo}
            onChange={handleMemoChange}
            onClick={stopProp}
            rows={3}
          />
        </div>
      )}
    </div>
  )
}
