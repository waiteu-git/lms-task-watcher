# 手動追加課題の編集機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手動追加課題（`manualAssignments`）を追加後に、ポップアップ/ダッシュボードのカードと LETUS ページの手動バッジの両方から編集できるようにする。

**Architecture:** 純ロジックのコア関数 `updateManualAssignment(id, patch)` を追加し、React 層（`ManualAssignmentCard` + `App.tsx`）はそれを利用する。コンテンツスクリプトは import ガード維持のためコアを import せず、手動バッジのクリックを提出トグルから編集フォーム（右下固定 shadow DOM）に変更しインライン実装する。反映は既存の `chrome.storage.local.onChanged` 経路に乗る。

**Tech Stack:** React 19 + TypeScript + Vite、Chrome MV3、`chrome.storage.local`、Vitest（jsdom）。

## Global Constraints

- コンテンツスクリプト（`dist/content.js` / `dist/classTimetable.js`）はバンドル後に `import` 文を残してはならない。新規コア関数をコンテンツから import しない（型のみの import は可）。
- `letusUrl`・`id`・`createdAt` は編集不可（patch 型から除外）。
- 手書きの `dist/` を直接編集しない。ソースを変更して `pnpm build` する。
- 大学サーバへの負荷保護（pacer 180ms 等）に手を入れない。本機能はネットワークを叩かない。
- ブランチは `feature/manual-assignment-edit`（`feature/scanned-deadline-override` の上にスタック済み）。v1.2.2 に同梱。
- テスト実行: `pnpm vitest run src`。ビルド: `pnpm build`（`tsc -b && vite build`）。

---

### Task 1: コア `updateManualAssignment`

**Files:**
- Modify: `src/core/manualAssignment.ts`（末尾に追加）
- Test: `src/core/manualAssignment.test.ts`（末尾に追加）

**Interfaces:**
- Consumes: 既存の `getManualAssignments()` / `saveManualAssignments(items)`、`type ManualAssignment`。
- Produces:
  - `type ManualAssignmentPatch = Partial<Pick<ManualAssignment, 'title' | 'deadline' | 'courseId' | 'courseName' | 'memo' | 'submitted'>>`
  - `updateManualAssignment(id: string, patch: ManualAssignmentPatch): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`src/core/manualAssignment.test.ts` の末尾（130 行目の後）に追記。先頭の import 文（21-27 行）に `updateManualAssignment` と `type ManualAssignmentPatch` を加える。

先頭 import を次に変更:

```ts
import {
  getManualAssignments,
  addManualAssignment,
  deleteManualAssignment,
  toggleManualAssignmentSubmitted,
  updateManualAssignment,
  type ManualAssignment,
  type ManualAssignmentPatch,
} from './manualAssignment'
```

ファイル末尾に追加:

```ts
describe('updateManualAssignment', () => {
  it('指定IDの課題だけ patch を適用し、他は変えない', async () => {
    await addManualAssignment(makeAssignment({ id: 'a', title: '旧A' }))
    await addManualAssignment(makeAssignment({ id: 'b', title: '旧B' }))
    await updateManualAssignment('a', { title: '新A' })
    const result = await getManualAssignments()
    expect(result.find((x) => x.id === 'a')?.title).toBe('新A')
    expect(result.find((x) => x.id === 'b')?.title).toBe('旧B')
  })

  it('patch に含まれないフィールドは元の値を保持する', async () => {
    await addManualAssignment(
      makeAssignment({ id: 'a', title: '旧', memo: '元メモ', submitted: false }),
    )
    await updateManualAssignment('a', { title: '新' })
    const result = await getManualAssignments()
    const a = result.find((x) => x.id === 'a')!
    expect(a.title).toBe('新')
    expect(a.memo).toBe('元メモ')
    expect(a.submitted).toBe(false)
    expect(a.letusUrl).toBe(makeAssignment().letusUrl)
    expect(a.createdAt).toBe(makeAssignment().createdAt)
  })

  it('複数フィールドを一度に更新できる', async () => {
    await addManualAssignment(makeAssignment({ id: 'a' }))
    const patch: ManualAssignmentPatch = {
      title: 'T',
      deadline: '2026-08-01T00:00:00.000Z',
      courseId: 'c9',
      courseName: 'コース9',
      memo: 'm',
      submitted: true,
    }
    await updateManualAssignment('a', patch)
    const a = (await getManualAssignments()).find((x) => x.id === 'a')!
    expect(a).toMatchObject(patch)
  })

  it('存在しないIDでは既存データが変化しない', async () => {
    await addManualAssignment(makeAssignment({ id: 'a', title: '旧' }))
    await updateManualAssignment('non-existent', { title: '新' })
    const result = await getManualAssignments()
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('旧')
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm vitest run src/core/manualAssignment.test.ts`
Expected: FAIL（`updateManualAssignment` / `ManualAssignmentPatch` が未定義）

- [ ] **Step 3: 最小実装を書く**

`src/core/manualAssignment.ts` の末尾（60 行目の後）に追加:

```ts
export type ManualAssignmentPatch = Partial<
  Pick<ManualAssignment, 'title' | 'deadline' | 'courseId' | 'courseName' | 'memo' | 'submitted'>
>

export async function updateManualAssignment(
  id: string,
  patch: ManualAssignmentPatch,
): Promise<void> {
  const current = await getManualAssignments()
  const updated = current.map((a) => (a.id === id ? { ...a, ...patch } : a))
  await saveManualAssignments(updated)
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `pnpm vitest run src/core/manualAssignment.test.ts`
Expected: PASS（全 4 ケース含む既存テストも緑）

- [ ] **Step 5: コミット**

```bash
git add src/core/manualAssignment.ts src/core/manualAssignment.test.ts
git commit -m "feat(manual): 手動課題の部分更新 updateManualAssignment を追加"
```

---

### Task 2: コンテンツ 手動バッジ→編集フォーム

**Files:**
- Modify: `src/content/manualTaskWidget.ts`（`applyBadgeState` の `manual` 分岐、`openManualEditForm` 新規、インライン `updateManualInline` 新規）
- Test: `src/content/manualTaskWidget.test.ts`（末尾に追加）

**Interfaces:**
- Consumes: 既存インライン `getManualAssignments()`（29 行）、`toLocalInputValue(iso)`（62 行）、`escapeHtml`（10 行）、`formatDeadlineShort`、`Course`（`../core/types`、型のみ import 済み）、`deleteManualAssignment` は content には無いのでインライン `deleteManualInline` も追加。
- Produces: `openManualEditForm(assignment: ManualAssignment, courses: Course[]): void`、`updateManualInline(id, patch): Promise<void>`、`deleteManualInline(id): Promise<void>`（このファイル内 private）。

- [ ] **Step 1: 失敗するテストを書く**

`src/content/manualTaskWidget.test.ts` の末尾（108-109 行の `describe` 閉じ）内に、`describe('LETUSページのバッジ', ...)` の中の新しい `it` として追加。手動課題を紐づけ、バッジに `✎` が出ること、クリックで編集フォームが開き課題名が prefill されること、課題名を変えて「更新」で storage が更新されることを検証する。

`describe('LETUSページのバッジ', () => { ... })` ブロックの末尾（既存の 2 つの `it` の後、`})` の直前）に追加:

`installChromeStub` は `vi.stubGlobal('chrome', ...)` 済みで `{ write }` のみ返すため、更新後の store は `globalThis.chrome.storage.local.get('manualAssignments')` で読む。

```ts
  it('手動課題バッジは ✎ を表示し、クリックで編集フォームが開いて更新できる', async () => {
    const roots = captureShadowRoots()
    installChromeStub({
      courses: [{ id: 'c1', name: '9973337 電気数学', url: 'https://letus.ed.tus.ac.jp/course/view.php?id=1', enabled: true, lmsType: 'letus', createdAt: '', updatedAt: '' }],
      assignments: [],
      manualAssignments: [{
        id: 'm1', courseId: 'c1', courseName: '9973337 電気数学', title: '手動レポート',
        letusUrl: ASSIGNMENT_URL, deadline: '2026-07-20T14:00:00.000Z', memo: '', submitted: false,
        createdAt: '2026-07-10T00:00:00.000Z',
      }],
    })

    const { initManualTaskWidget } = await import('./manualTaskWidget')
    await initManualTaskWidget()

    // バッジに鉛筆マーク
    expect(badgeText(roots)).toContain('✎')

    // バッジをクリック → 編集フォームが開く（handler が async のため flush する）
    const badge = roots.flatMap((r) => Array.from(r.querySelectorAll('.badge')))[0] as HTMLElement
    badge.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const titleInput = roots
      .map((r) => r.getElementById('me-title') as HTMLInputElement | null)
      .find(Boolean) as HTMLInputElement
    expect(titleInput.value).toBe('手動レポート')

    // 課題名を変更して「更新」
    titleInput.value = '手動レポート（改）'
    const updateBtn = roots
      .flatMap((r) => Array.from(r.querySelectorAll('.update')))
      .find(Boolean) as HTMLButtonElement
    updateBtn.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const { manualAssignments } = (await globalThis.chrome.storage.local.get(
      'manualAssignments',
    )) as { manualAssignments: Array<{ id: string; title: string }> }
    expect(manualAssignments.find((x) => x.id === 'm1')?.title).toBe('手動レポート（改）')
  })
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `pnpm vitest run src/content/manualTaskWidget.test.ts`
Expected: FAIL（バッジに `✎` が無い／`#me-title` が存在しない）

- [ ] **Step 3: インラインの更新・削除ヘルパを追加**

`src/content/manualTaskWidget.ts` の `toggleManualSubmitted`（390-398 行）の直後に追加:

```ts
async function updateManualInline(
  id: string,
  patch: Partial<Pick<ManualAssignment, 'title' | 'deadline' | 'courseId' | 'courseName' | 'memo' | 'submitted'>>,
): Promise<void> {
  const r = await chrome.storage.local.get('manualAssignments') as { manualAssignments?: Array<Partial<ManualAssignment> & { id: string }> }
  const current = (r.manualAssignments ?? []).map((record) => ({
    ...record,
    submitted: record.submitted ?? false,
  })) as ManualAssignment[]
  const updated = current.map((a) => (a.id === id ? { ...a, ...patch } : a))
  await chrome.storage.local.set({ manualAssignments: updated })
}

async function deleteManualInline(id: string): Promise<void> {
  const r = await chrome.storage.local.get('manualAssignments') as { manualAssignments?: Array<Partial<ManualAssignment> & { id: string }> }
  const current = (r.manualAssignments ?? []) as Array<{ id: string }>
  await chrome.storage.local.set({ manualAssignments: current.filter((a) => a.id !== id) })
}
```

- [ ] **Step 4: `openManualEditForm` を追加**

`openDeadlineEditor`（138-193 行）の直後に追加。`openDeadlineEditor` と同じ右下固定・closed shadow DOM パターン。

```ts
function openManualEditForm(assignment: ManualAssignment, courses: Course[]): void {
  const existing = document.getElementById('letus-task-watcher-manual-editor')
  if (existing) existing.remove()

  const host = document.createElement('div')
  host.id = 'letus-task-watcher-manual-editor'
  host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;'
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; font-family: sans-serif; font-size: 13px; }
    .panel { background:#fff; border:1px solid #d1d5db; border-radius:12px; padding:14px 16px; width:280px; box-shadow:0 2px 12px rgba(0,0,0,.15); }
    .head { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
    .title { font-weight:600; font-size:13px; color:#111827; }
    .x { background:none; border:none; cursor:pointer; color:#6b7280; font-size:16px; }
    .field { margin-bottom:8px; }
    input, select, textarea { width:100%; box-sizing:border-box; font-size:12px; border:1px solid #d1d5db; border-radius:6px; padding:6px 8px; color:#111827; background:#fff; }
    textarea { resize:none; height:44px; }
    .check { display:flex; align-items:center; gap:6px; font-size:12px; color:#374151; }
    .check input { width:auto; }
    .actions { display:flex; gap:6px; margin-top:12px; }
    .del { border:1px solid #fecaca; background:#fff; color:#dc2626; border-radius:6px; padding:6px 10px; cursor:pointer; font-size:11px; }
    .cancel { flex:1; border:1px solid #d1d5db; background:#fff; border-radius:6px; padding:6px; cursor:pointer; font-size:12px; color:#374151; }
    .update { flex:1; background:#2563eb; color:#fff; border:none; border-radius:6px; padding:6px; cursor:pointer; font-size:12px; }
    .err { color:#dc2626; font-size:11px; margin-top:6px; }
  `
  shadow.appendChild(style)

  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.innerHTML = `
    <div class="head"><span class="title">課題を編集</span><button class="x" type="button" aria-label="閉じる">✕</button></div>
    <div class="field"><input id="me-title" type="text" placeholder="課題名" value="${escapeHtml(assignment.title)}" /></div>
    <div class="field"><input id="me-deadline" type="datetime-local" /></div>
    <div class="field">
      <select id="me-course">
        ${courses.map((c) => `<option value="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><textarea id="me-memo" placeholder="メモ（任意）">${escapeHtml(assignment.memo)}</textarea></div>
    <div class="field check"><label class="check"><input id="me-submitted" type="checkbox" />提出済み</label></div>
    <div class="actions">
      <button class="del" type="button">削除</button>
      <button class="cancel" type="button">キャンセル</button>
      <button class="update" type="button">更新</button>
    </div>
    <div class="err" id="me-err"></div>
  `
  shadow.appendChild(panel)

  ;(shadow.getElementById('me-deadline') as HTMLInputElement).value = toLocalInputValue(assignment.deadline)
  ;(shadow.getElementById('me-course') as HTMLSelectElement).value = assignment.courseId
  ;(shadow.getElementById('me-submitted') as HTMLInputElement).checked = assignment.submitted

  const close = () => host.remove()
  panel.querySelector('.x')!.addEventListener('click', close)
  panel.querySelector('.cancel')!.addEventListener('click', close)

  panel.querySelector('.update')!.addEventListener('click', async () => {
    const title = (shadow.getElementById('me-title') as HTMLInputElement).value.trim()
    const deadlineLocal = (shadow.getElementById('me-deadline') as HTMLInputElement).value
    const courseSelect = shadow.getElementById('me-course') as HTMLSelectElement
    const courseId = courseSelect.value
    const courseName = courseSelect.selectedOptions[0]?.dataset.name ?? ''
    const memo = (shadow.getElementById('me-memo') as HTMLTextAreaElement).value.trim()
    const submitted = (shadow.getElementById('me-submitted') as HTMLInputElement).checked
    const errEl = shadow.getElementById('me-err')!

    if (!title) { errEl.textContent = '課題名を入力してください。'; return }
    if (!deadlineLocal) { errEl.textContent = '締切を入力してください。'; return }
    if (!courseId) { errEl.textContent = 'コースを選択してください。'; return }

    await updateManualInline(assignment.id, {
      title,
      deadline: new Date(deadlineLocal).toISOString(),
      courseId,
      courseName,
      memo,
      submitted,
    })
    close()
    // 保存後の storage.onChanged でバッジは再描画される。
  })

  panel.querySelector('.del')!.addEventListener('click', async () => {
    await deleteManualInline(assignment.id)
    close()
  })
}
```

- [ ] **Step 5: 手動バッジのクリックを編集フォームに変更**

`applyBadgeState` の `state.kind === 'manual'` 分岐（435-445 行）を置換:

```ts
  if (state.kind === 'manual') {
    fresh.className = `badge clickable ${state.submitted ? 'submitted' : ''}`
    fresh.textContent = `${formatDeadlineShort(state.deadline)} ${state.submitted ? '✓' : '！'} ✎`
    fresh.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      const item = (await getManualAssignments()).find((a) => a.id === state.id)
      if (item) openManualEditForm(item, courses)
    })
    return
  }
```

- [ ] **Step 6: テストを実行して成功を確認**

Run: `pnpm vitest run src/content/manualTaskWidget.test.ts`
Expected: PASS（新規 `it` と既存 2 件）

- [ ] **Step 7: ビルドして import ガードを確認**

```bash
pnpm build
grep -c "^import\|[^a-zA-Z]import " dist/content.js || echo "no import (OK)"
```
Expected: `dist/content.js` に `import` 文が無い（`grep -c` が 0、または "no import (OK)"）。もし import が出たら、コアや共有モジュールを content から import していないか見直す。

- [ ] **Step 8: コミット**

```bash
git add src/content/manualTaskWidget.ts src/content/manualTaskWidget.test.ts
git commit -m "feat(badge): 手動課題バッジのクリックを編集フォームに変更"
```

---

### Task 3: React `ManualAssignmentCard` インライン編集 + `App.tsx` 配線

**Files:**
- Modify: `src/components/ManualAssignmentCard.tsx`（props 追加、編集ボタン、インライン編集フォーム）
- Modify: `src/App.tsx`（import に `updateManualAssignment`/`ManualAssignmentPatch` 追加、`handleUpdateManualAssignment` 追加、全 `<ManualAssignmentCard>` に `courses`/`onUpdate` を渡す）

**Interfaces:**
- Consumes: `updateManualAssignment` / `type ManualAssignmentPatch`（Task 1）、`type Course`（`../core/types`）。
- Produces: `ManualAssignmentCard` の新 props `courses: Course[]`、`onUpdate: (id: string, patch: ManualAssignmentPatch) => void`。

このタスクは表示コンポーネントの変更で、プロジェクトに React コンポーネントのテスト基盤（React Testing Library）が無いため単体テストは追加しない。検証は型チェック（`tsc`）と実機確認で行う。ロジックの核は Task 1 で単体テスト済み。

- [ ] **Step 1: `ManualAssignmentCard.tsx` を書き換える**

`src/components/ManualAssignmentCard.tsx` 全体を次に置換:

```tsx
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
      <article className="manualCard manualCardEditing">
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
            <button type="button" className="manualDeleteBtn" onClick={() => onDelete(assignment.id)}>
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
```

- [ ] **Step 2: `App.tsx` の import に更新関数を追加**

`src/App.tsx` の `./core/manualAssignment` からの import ブロック（`deleteManualAssignment,` と `toggleManualAssignmentSubmitted,` を含む、78-79 行付近）に追加。該当 import 文を次のように変更（`updateManualAssignment` と `type ManualAssignmentPatch` を追加）:

```tsx
  deleteManualAssignment,
  toggleManualAssignmentSubmitted,
  updateManualAssignment,
  type ManualAssignmentPatch,
```

- [ ] **Step 3: `App.tsx` に更新ハンドラを追加**

`handleToggleManualSubmitted`（866-871 行）の直後に追加:

```tsx
  async function handleUpdateManualAssignment(id: string, patch: ManualAssignmentPatch) {
    await updateManualAssignment(id, patch)
    setManualAssignments((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    )
  }
```

- [ ] **Step 4: 全 `<ManualAssignmentCard>` に props を渡す**

`src/App.tsx` 内の全ての `<ManualAssignmentCard>`（`onToggleSubmitted={(id) => void handleToggleManualSubmitted(id)}` を持つ箇所、計 7 箇所）に、`courses` と `onUpdate` を追加する。各箇所で既存の `onToggleSubmitted={...}` 行の直後に次の 2 行を挿入:

```tsx
                    courses={courses}
                    onUpdate={(id, patch) => void handleUpdateManualAssignment(id, patch)}
```

（インデントは各 JSX の既存 props に合わせる。すべての `<ManualAssignmentCard` 出現箇所に漏れなく追加すること。`grep -n "<ManualAssignmentCard" src/App.tsx` で件数を確認し、全件に `courses` と `onUpdate` が付いていることを目視確認する。）

- [ ] **Step 5: スタイルを追加**

編集フォーム用の最小スタイルを、`ManualAssignmentCard` のスタイルが定義されている CSS に追加する。まず定義場所を特定:

```bash
grep -rn "manualCardFooter\|manualSubmitToggle\|manualDeleteBtn" src --include=*.css
```

見つかった CSS ファイル（例: `src/App.css`）の末尾に追加:

```css
.manualEditBtn {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.manualEditBtn:hover { background: #f9fafb; }
.manualEditForm { display: flex; flex-direction: column; gap: 6px; }
.manualEditInput {
  width: 100%;
  box-sizing: border-box;
  font-size: 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 6px 8px;
}
.manualEditForm textarea.manualEditInput { resize: none; height: 44px; }
.manualEditCheck { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.manualEditError { color: #dc2626; font-size: 11px; }
.manualEditActions { display: flex; gap: 6px; margin-top: 4px; }
.manualEditActions .manualDeleteBtn { margin-right: auto; }
.manualEditCancel {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.manualEditSave {
  background: #2563eb;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
```

- [ ] **Step 6: 型チェック＋ビルド**

Run: `pnpm build`
Expected: `tsc -b` が型エラーなく通り、`vite build` が成功する。エラーが出たら props の受け渡し漏れ・import 漏れを修正。

- [ ] **Step 7: 全テスト実行（回帰確認）**

Run: `pnpm vitest run src`
Expected: 全 PASS。

- [ ] **Step 8: コミット**

```bash
git add src/components/ManualAssignmentCard.tsx src/App.tsx src/App.css
git commit -m "feat(ui): 手動課題カードにインライン編集を追加"
```

（Step 5 で CSS ファイルが `App.css` 以外だった場合は、`git add` のパスをそのファイルに合わせる。）

---

## 実機確認（全タスク完了後）

1. `pnpm build` → `dist/` を拡張機能として再読み込み。
2. LETUS のコースページで手動追加課題のバッジに `✎` が出ること。クリックで右下に編集フォームが開き、課題名・締切・コース・メモ・提出済みが prefill されること。変更→更新でバッジが更新されること。削除でバッジが「+」に戻ること。
3. ポップアップ／ダッシュボードの手動カードで「編集」ボタン→インラインフォーム→更新が反映されること。提出トグル・削除が従来通り動くこと。
4. 一方の面（バッジ）で編集した内容が、もう一方の面（カード）に `storage.onChanged` 経由で反映されること。
