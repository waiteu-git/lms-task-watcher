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

export function AssignmentMemo({ assignmentId, apiBaseUrl }: Props) {
  const [memo, setMemo] = useState<MemoData>({ priority: 0, memo: '' })
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

  return (
    <div className="assignmentMemo">
      <div className="prioritySelector">
        {([0, 1, 2, 3] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`priorityBtn priority${p} ${memo.priority === p ? 'active' : ''}`}
            onClick={() => void handlePriorityChange(p)}
            title={PRIORITY_LABELS[p]}
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
  )
}
