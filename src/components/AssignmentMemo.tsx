import { useEffect, useState } from 'react'
import { getMemo, saveMemo, syncToServer, type AssignmentMemo as MemoData } from '../core/premium'

type Props = {
  assignmentId: string
  apiBaseUrl: string
}

const PRIORITY_LABELS: Record<number, string> = {
  0: '優先度なし',
  1: '低',
  2: '中',
  3: '高',
}

const PRIORITY_CLASS: Record<number, string> = {
  0: '',
  1: 'priority1',
  2: 'priority2',
  3: 'priority3',
}

export function AssignmentMemo({ assignmentId, apiBaseUrl }: Props) {
  const [memo, setMemo] = useState<MemoData>({ priority: 0, memo: '' })
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void getMemo(assignmentId).then(setMemo)
  }, [assignmentId])

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

  const hasData = memo.priority > 0 || memo.memo.trim().length > 0

  return (
    <div className="assignmentMemo">
      <button
        type="button"
        className={`memoToggle ${hasData ? 'memoToggleHasData' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {hasData && memo.priority > 0 && (
          <span className={`memoTogglePriority ${PRIORITY_CLASS[memo.priority]}`}>
            {PRIORITY_LABELS[memo.priority]}
          </span>
        )}
        {hasData && memo.memo.trim().length > 0 && (
          <span className="memoToggleSnippet">
            {memo.memo.trim().slice(0, 20)}{memo.memo.trim().length > 20 ? '…' : ''}
          </span>
        )}
        {!hasData && <span className="memoToggleLabel">メモ・優先度</span>}
        <span className="memoToggleArrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="memoBody">
          <div className="prioritySelector">
            {([0, 1, 2, 3] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`priorityBtn priority${p} ${memo.priority === p ? 'active' : ''}`}
                onClick={() => void handlePriorityChange(p)}
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
            rows={3}
          />
        </div>
      )}
    </div>
  )
}
