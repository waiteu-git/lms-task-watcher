# 手動課題追加 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LETUSの任意のページから手動で課題を追加・管理できるようにし、スキャン済みの課題ページではステータスインジケーターを表示する。

**Architecture:** `src/content/manualTaskWidget.ts` を新規作成し `src/content/courseDetector.ts` から import してバンドル。フローティングUIはShadow DOMで隔離。ManualAssignment型とストレージ関数を `src/core/manualAssignment.ts` に集約。ダッシュボードは App.tsx に専用セクションを追加。

**Tech Stack:** TypeScript, Shadow DOM（スタイル隔離）, chrome.storage.local, React 19, Vitest

## Global Constraints

- バニラJS禁止（content scriptもTypeScriptで記述してViteでビルドする）
- content scriptはShadow DOMを使ってLETUSのCSSを汚染しない
- フローティングUIは `position: fixed; bottom: 16px; right: 16px`（LETUS本文・リンクとの干渉を避けるため右下固定）
- 手動課題の削除はダッシュボードからのみ（誤削除防止）
- 優先度フィールドはサブスクライバー向けのため本計画では実装しない（将来対応）
- 共有機能も本計画では実装しない（別プランで実施）
- テストは `pnpm exec vitest run` で実行
- ビルドは `pnpm build` で確認

---

## ファイル構成

| 操作 | ファイル | 役割 |
|------|---------|------|
| 新規 | `src/core/manualAssignment.ts` | ManualAssignment型 + chrome.storage CRUD |
| 新規 | `src/core/manualAssignment.test.ts` | ストレージ関数のテスト |
| 新規 | `src/content/manualTaskWidget.ts` | フローティングボタン + フォームUI（Shadow DOM） |
| 新規 | `src/components/ManualAssignmentSection.tsx` | ダッシュボード用セクションコンポーネント |
| 変更 | `src/background/storageKeys.ts` | `MANUAL_ASSIGNMENTS_KEY` を追加 |
| 変更 | `src/content/courseDetector.ts` | manualTaskWidget を import して初期化 |
| 変更 | `src/App.tsx` | ManualAssignment を読み込み・表示 |

---

### Task 1: ManualAssignment型定義とストレージ層

**Files:**
- Create: `src/core/manualAssignment.ts`
- Create: `src/core/manualAssignment.test.ts`
- Modify: `src/background/storageKeys.ts`

**Interfaces:**
- Produces:
  - `ManualAssignment` 型（後続タスクが参照）
  - `getManualAssignments(): Promise<ManualAssignment[]>`
  - `saveManualAssignments(items: ManualAssignment[]): Promise<void>`
  - `addManualAssignment(item: ManualAssignment): Promise<void>`
  - `deleteManualAssignment(id: string): Promise<void>`
  - `MANUAL_ASSIGNMENTS_KEY = 'manualAssignments'`

- [ ] **Step 1: `MANUAL_ASSIGNMENTS_KEY` を storageKeys.ts に追加する**

`src/background/storageKeys.ts` の末尾に追記:
```typescript
export const MANUAL_ASSIGNMENTS_KEY = 'manualAssignments'
```

- [ ] **Step 2: テストファイルを作成して失敗させる**

`src/core/manualAssignment.test.ts` を作成:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStorage: Record<string, unknown> = {}

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: mockStorage[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(mockStorage, obj)
      }),
    },
  },
})

beforeEach(() => {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  vi.clearAllMocks()
})

import {
  getManualAssignments,
  addManualAssignment,
  deleteManualAssignment,
  type ManualAssignment,
} from './manualAssignment'

function makeAssignment(overrides?: Partial<ManualAssignment>): ManualAssignment {
  return {
    id: 'test-id-1',
    courseId: 'course-abc',
    courseName: '数理統計学',
    title: 'レポート第5回',
    letusUrl: 'https://letus.ed.tus.ac.jp/mod/forum/discuss.php?d=123',
    deadline: '2026-07-05T23:59:00.000Z',
    memo: '',
    createdAt: '2026-06-28T00:00:00.000Z',
    ...overrides,
  }
}

describe('getManualAssignments', () => {
  it('ストレージが空の場合は空配列を返す', async () => {
    const result = await getManualAssignments()
    expect(result).toEqual([])
  })
})

describe('addManualAssignment', () => {
  it('課題を追加できる', async () => {
    const a = makeAssignment()
    await addManualAssignment(a)
    const result = await getManualAssignments()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('test-id-1')
  })

  it('複数追加できる', async () => {
    await addManualAssignment(makeAssignment({ id: 'id-1', title: 'A' }))
    await addManualAssignment(makeAssignment({ id: 'id-2', title: 'B' }))
    const result = await getManualAssignments()
    expect(result).toHaveLength(2)
  })
})

describe('deleteManualAssignment', () => {
  it('指定IDの課題を削除できる', async () => {
    await addManualAssignment(makeAssignment({ id: 'keep' }))
    await addManualAssignment(makeAssignment({ id: 'delete-me' }))
    await deleteManualAssignment('delete-me')
    const result = await getManualAssignments()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('keep')
  })

  it('存在しないIDを削除しても壊れない', async () => {
    await addManualAssignment(makeAssignment())
    await deleteManualAssignment('non-existent')
    const result = await getManualAssignments()
    expect(result).toHaveLength(1)
  })
})
```

- [ ] **Step 3: テストを実行して失敗を確認する**

```
pnpm exec vitest run src/core/manualAssignment.test.ts
```

Expected: `Cannot find module './manualAssignment'`

- [ ] **Step 4: `src/core/manualAssignment.ts` を実装する**

```typescript
import { MANUAL_ASSIGNMENTS_KEY } from '../background/storageKeys'

export type ManualAssignment = {
  id: string
  courseId: string
  courseName: string
  title: string
  letusUrl: string | null
  deadline: string
  memo: string
  createdAt: string
}

type ManualAssignmentsStorage = {
  manualAssignments?: ManualAssignment[]
}

export async function getManualAssignments(): Promise<ManualAssignment[]> {
  const result = (await chrome.storage.local.get(
    MANUAL_ASSIGNMENTS_KEY,
  )) as ManualAssignmentsStorage
  return result.manualAssignments ?? []
}

export async function saveManualAssignments(
  items: ManualAssignment[],
): Promise<void> {
  await chrome.storage.local.set({ [MANUAL_ASSIGNMENTS_KEY]: items })
}

export async function addManualAssignment(
  item: ManualAssignment,
): Promise<void> {
  const current = await getManualAssignments()
  await saveManualAssignments([...current, item])
}

export async function deleteManualAssignment(id: string): Promise<void> {
  const current = await getManualAssignments()
  await saveManualAssignments(current.filter((a) => a.id !== id))
}
```

- [ ] **Step 5: テストを実行してパスを確認する**

```
pnpm exec vitest run src/core/manualAssignment.test.ts
```

Expected: 全テスト PASS

- [ ] **Step 6: ビルドが通ることを確認する**

```
pnpm build
```

Expected: エラーなし

- [ ] **Step 7: コミットする**

```bash
git add src/background/storageKeys.ts src/core/manualAssignment.ts src/core/manualAssignment.test.ts
git commit -m "feat(core): add ManualAssignment type and storage CRUD"
```

---

### Task 2: Content Script — フローティングボタン + 課題追加フォーム

**Files:**
- Create: `src/content/manualTaskWidget.ts`
- Modify: `src/content/courseDetector.ts`

**Interfaces:**
- Consumes:
  - `addManualAssignment(item: ManualAssignment): Promise<void>` （Task 1）
  - `getManualAssignments(): Promise<ManualAssignment[]>` （Task 1）
  - `getCourses(): Promise<Course[]>` （既存 `src/core/storage.ts`）
  - `ManualAssignment` 型 （Task 1）
- Produces: Shadow DOM内のフローティングUI（LETUSページに描画）

**テスト方針:** Shadow DOMとchrome APIに強く依存するためVitestによる自動テスト対象外。`pnpm build` でビルドし、Chromeで拡張機能を読み込んで手動確認する。

- [ ] **Step 1: `src/content/manualTaskWidget.ts` を作成する**

```typescript
import type { Course } from '../core/types'
import { getCourses } from '../core/storage'
import { addManualAssignment, type ManualAssignment } from '../core/manualAssignment'

function createId(): string {
  return crypto.randomUUID()
}

function buildWidget(courses: Course[]): void {
  const host = document.createElement('div')
  host.id = 'letus-task-watcher-widget'
  host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;'
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; font-family: sans-serif; font-size: 13px; }
    .btn {
      display: flex; align-items: center; gap: 6px;
      background: #fff; border: 1px solid #d1d5db;
      border-radius: 20px; padding: 6px 12px; cursor: pointer;
      color: #374151; box-shadow: 0 1px 4px rgba(0,0,0,.12);
      white-space: nowrap;
    }
    .btn:hover { background: #f9fafb; }
    .label { display: none; }
    .btn:hover .label { display: inline; }
    .form-panel {
      display: none; position: absolute; bottom: 44px; right: 0;
      background: #fff; border: 1px solid #d1d5db; border-radius: 12px;
      padding: 14px 16px; width: 280px;
      box-shadow: 0 2px 12px rgba(0,0,0,.12);
    }
    .form-panel.open { display: block; }
    .form-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px;
    }
    .form-title { font-weight: 600; font-size: 13px; color: #111827; }
    .close-btn { background: none; border: none; cursor: pointer; color: #6b7280; font-size: 16px; }
    .field { margin-bottom: 8px; }
    input, select, textarea {
      width: 100%; box-sizing: border-box; font-size: 12px;
      border: 1px solid #d1d5db; border-radius: 6px;
      padding: 6px 8px; color: #111827; background: #fff;
    }
    textarea { resize: none; height: 48px; }
    .meta { font-size: 11px; color: #9ca3af; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; gap: 6px; margin-top: 10px; }
    .cancel { flex: 1; border: 1px solid #d1d5db; background: #fff; border-radius: 6px; padding: 6px; cursor: pointer; font-size: 12px; }
    .submit {
      flex: 2; background: #2563eb; color: #fff; border: none;
      border-radius: 6px; padding: 6px; cursor: pointer; font-size: 12px;
    }
    .submit:disabled { opacity: .5; cursor: not-allowed; }
    .error { color: #dc2626; font-size: 11px; margin-top: 6px; }
  `
  shadow.appendChild(style)

  const btn = document.createElement('button')
  btn.className = 'btn'
  btn.type = 'button'
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    <span class="label">課題を追加</span>
  `
  shadow.appendChild(btn)

  const panel = document.createElement('div')
  panel.className = 'form-panel'
  panel.innerHTML = `
    <div class="form-header">
      <span class="form-title">課題を追加</span>
      <button class="close-btn" type="button" aria-label="閉じる">✕</button>
    </div>
    <div class="field">
      <input id="wt-title" type="text" placeholder="課題名" required />
    </div>
    <div class="field">
      <input id="wt-deadline" type="datetime-local" required />
    </div>
    <div class="field">
      <select id="wt-course">
        <option value="">コースを選択</option>
        ${courses.map((c) => `<option value="${c.id}" data-name="${c.name}">${c.name}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <div class="meta" id="wt-url-display">${location.href}</div>
    </div>
    <div class="field">
      <textarea id="wt-memo" placeholder="メモ（任意）"></textarea>
    </div>
    <div class="actions">
      <button class="cancel" type="button">キャンセル</button>
      <button class="submit" type="button">追加する</button>
    </div>
    <div class="error" id="wt-error"></div>
  `
  shadow.appendChild(panel)

  function openPanel(): void {
    panel.classList.add('open')
  }
  function closePanel(): void {
    panel.classList.remove('open')
  }

  btn.addEventListener('click', openPanel)
  panel.querySelector('.close-btn')!.addEventListener('click', closePanel)
  panel.querySelector('.cancel')!.addEventListener('click', closePanel)

  panel.querySelector('.submit')!.addEventListener('click', async () => {
    const title = (shadow.getElementById('wt-title') as HTMLInputElement).value.trim()
    const deadline = (shadow.getElementById('wt-deadline') as HTMLInputElement).value
    const courseSelect = shadow.getElementById('wt-course') as HTMLSelectElement
    const courseId = courseSelect.value
    const courseName = courseSelect.selectedOptions[0]?.dataset.name ?? ''
    const memo = (shadow.getElementById('wt-memo') as HTMLTextAreaElement).value.trim()
    const errorEl = shadow.getElementById('wt-error')!

    if (!title) { errorEl.textContent = '課題名を入力してください。'; return }
    if (!deadline) { errorEl.textContent = '締切を入力してください。'; return }
    if (!courseId) { errorEl.textContent = 'コースを選択してください。'; return }
    errorEl.textContent = ''

    const item: ManualAssignment = {
      id: createId(),
      courseId,
      courseName,
      title,
      letusUrl: location.href,
      deadline: new Date(deadline).toISOString(),
      memo,
      createdAt: new Date().toISOString(),
    }

    await addManualAssignment(item)
    closePanel()

    ;(shadow.getElementById('wt-title') as HTMLInputElement).value = ''
    ;(shadow.getElementById('wt-deadline') as HTMLInputElement).value = ''
    ;(shadow.getElementById('wt-memo') as HTMLTextAreaElement).value = ''
  })
}

export async function initManualTaskWidget(): Promise<void> {
  if (document.getElementById('letus-task-watcher-widget')) return

  const courses = await getCourses()
  const enabledCourses = courses.filter((c) => c.enabled)

  if (enabledCourses.length === 0) return

  buildWidget(enabledCourses)
}
```

- [ ] **Step 2: `src/content/courseDetector.ts` から `initManualTaskWidget` を呼ぶ**

`courseDetector.ts` の `run()` 関数末尾に追記し、ファイル先頭に import を追加する:

```typescript
// ファイル先頭（既存 import の後）に追加
import { initManualTaskWidget } from './manualTaskWidget'

// run() 関数末尾に追加
void initManualTaskWidget()
```

`run()` 関数全体（変更後の形）:
```typescript
function run(): void {
  const courses = detectCourses()

  if (courses.length > 0) {
    console.log(`[LETUS Task Watcher] detected ${courses.length} courses`)

    chrome.runtime.sendMessage({ type: 'UPSERT_COURSES', courses }, (response: unknown) => {
      if (chrome.runtime.lastError) {
        console.warn('[LETUS Task Watcher] failed to send courses:', chrome.runtime.lastError.message)
        return
      }
      console.log('[LETUS Task Watcher] courses upserted:', response)
    })
  }

  void initManualTaskWidget()
}
```

- [ ] **Step 3: ビルドする**

```
pnpm build
```

Expected: エラーなし（`dist/content.js` が更新される）

- [ ] **Step 4: 手動確認**

1. `chrome://extensions/` → 「パッケージ化されていない拡張機能を読み込む」→ `dist/` を指定
2. LETUSにログインし、任意のページを開く
3. 右下に小さなボタンが表示されることを確認
4. ボタンをクリックするとフォームが展開されることを確認
5. 課題名・締切・コースを入力して「追加する」を押す
6. `chrome.storage.local` に `manualAssignments` が保存されることをDevToolsで確認:
   `Application → Storage → chrome.storage.local`

- [ ] **Step 5: コミットする**

```bash
git add src/content/manualTaskWidget.ts src/content/courseDetector.ts
git commit -m "feat(content): add floating manual task widget to LETUS pages"
```

---

### Task 3: Content Script — スキャン済みステータスインジケーター

**Files:**
- Modify: `src/content/manualTaskWidget.ts`

**Interfaces:**
- Consumes:
  - `getManualAssignments(): Promise<ManualAssignment[]>` （Task 1）
  - `chrome.storage.local` から `assignments`（既存スキャン済み課題）を直接取得
- Produces: スキャン済みの場合、フローティングボタンをインジケーターに差し替え

**テスト方針:** 手動確認のみ。

- [ ] **Step 1: `src/core/storage.ts` から `getAssignments` をインポートして使えるか確認する**

`getAssignments` は既存 `src/core/storage.ts` にある。content script から import 可能（同じバンドルに含まれる）。

- [ ] **Step 2: `initManualTaskWidget` にスキャン済み判定を追加する**

`src/content/manualTaskWidget.ts` を以下のように更新する（関数を追記）:

ファイル先頭の import に `getAssignments` を追加:
```typescript
import { getCourses, getAssignments } from '../core/storage'
```

`initManualTaskWidget` 関数を以下に差し替える:
```typescript
export async function initManualTaskWidget(): Promise<void> {
  if (document.getElementById('letus-task-watcher-widget')) return

  const [courses, assignments] = await Promise.all([
    getCourses(),
    getAssignments(),
  ])

  const enabledCourses = courses.filter((c) => c.enabled)
  if (enabledCourses.length === 0) return

  const currentUrl = location.href.split('#')[0]
  const matchedAssignment = assignments.find((a) => {
    if (!a.url) return false
    const assignmentUrl = a.url.split('#')[0]
    return assignmentUrl === currentUrl
  })

  if (matchedAssignment) {
    buildScannedIndicator(matchedAssignment)
  } else {
    buildWidget(enabledCourses)
  }
}
```

ファイル末尾に `buildScannedIndicator` 関数を追加:
```typescript
function buildScannedIndicator(assignment: { title: string; deadline: string | null }): void {
  const host = document.createElement('div')
  host.id = 'letus-task-watcher-widget'
  host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;'
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; font-family: sans-serif; font-size: 13px; }
    .indicator {
      display: flex; align-items: center; gap: 8px;
      background: #f0fdf4; border: 1px solid #86efac;
      border-radius: 10px; padding: 8px 12px; cursor: pointer;
    }
    .icon { color: #16a34a; font-size: 16px; }
    .label { font-size: 12px; }
    .title { font-weight: 600; color: #15803d; }
    .deadline { color: #16a34a; opacity: .85; }
  `
  shadow.appendChild(style)

  const deadlineText = assignment.deadline
    ? formatDeadlineShort(assignment.deadline)
    : '締切未取得'

  const el = document.createElement('div')
  el.className = 'indicator'
  el.title = 'ダッシュボードで確認'
  el.innerHTML = `
    <span class="icon">✓</span>
    <div class="label">
      <div class="title">登録済み</div>
      <div class="deadline">締切 ${deadlineText}</div>
    </div>
  `
  el.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' })
  })
  shadow.appendChild(el)
}

function formatDeadlineShort(isoString: string): string {
  const d = new Date(isoString)
  const m = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${day} ${hh}:${mm}`
}
```

`OPEN_DASHBOARD` メッセージのハンドラーが background にない場合は `chrome.tabs.create({ url: chrome.runtime.getURL('index.html#dashboard') })` を content から直接呼ぶよう変更する:

```typescript
el.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('index.html#dashboard') })
})
```

- [ ] **Step 3: ビルドする**

```
pnpm build
```

Expected: エラーなし

- [ ] **Step 4: 手動確認**

1. 拡張機能を再読み込み
2. スキャン済みの課題ページ（`/mod/assign/view.php?id=XXX` 等）を開く
3. 右下に「✓ 登録済み / 締切 X/XX XX:XX」インジケーターが表示されることを確認
4. インジケーターをクリックするとダッシュボードが開くことを確認
5. スキャンされていないページ（フォーラム等）ではフローティングボタンが表示されることを確認

- [ ] **Step 5: コミットする**

```bash
git add src/content/manualTaskWidget.ts
git commit -m "feat(content): show scanned status indicator on registered assignment pages"
```

---

### Task 4: ダッシュボード — 手動追加課題セクション + 削除機能

**Files:**
- Create: `src/components/ManualAssignmentSection.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes:
  - `getManualAssignments(): Promise<ManualAssignment[]>` （Task 1）
  - `deleteManualAssignment(id: string): Promise<void>` （Task 1）
  - `MANUAL_ASSIGNMENTS_KEY` （Task 1、storage変化検知用）
  - `ManualAssignment` 型 （Task 1）
- Produces: ダッシュボードに「手動追加した課題」セクション

- [ ] **Step 1: `src/components/ManualAssignmentSection.tsx` を作成する**

```tsx
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
```

- [ ] **Step 2: `App.tsx` に ManualAssignment のstate・読み込み・削除を追加する**

`App.tsx` の import 群に追加:
```typescript
import {
  getManualAssignments,
  deleteManualAssignment,
  type ManualAssignment,
} from './core/manualAssignment'
import { MANUAL_ASSIGNMENTS_KEY } from './background/storageKeys'
import { ManualAssignmentSection } from './components/ManualAssignmentSection'
```

`App()` 関数内の state 宣言に追加:
```typescript
const [manualAssignments, setManualAssignments] = useState<ManualAssignment[]>([])
```

`refreshAll` 関数に追加（`Promise.all` の中に `getManualAssignments()` を追加）:
```typescript
async function refreshAll() {
  const [
    savedAssignments,
    savedCourses,
    savedIgnoredAssignmentIds,
    savedAssignmentScanStatus,
    savedDeadlineScanStatus,
    savedLastRefreshAt,
    savedManualAssignments,        // ← 追加
  ] = await Promise.all([
    getAssignments(),
    getCourses(),
    getIgnoredAssignmentIds(),
    getAssignmentScanStatus(),
    getDeadlineScanStatus(),
    getLastRefreshAt(),
    getManualAssignments(),        // ← 追加
  ])

  setAssignments(savedAssignments)
  setCourses(savedCourses)
  setIgnoredAssignmentIds(savedIgnoredAssignmentIds)
  setAssignmentScanStatus(savedAssignmentScanStatus)
  setDeadlineScanStatus(savedDeadlineScanStatus)
  setLastRefreshAt(savedLastRefreshAt)
  setManualAssignments(savedManualAssignments)  // ← 追加
}
```

`storage.onChanged` リスナーで content script から追加された場合に反映させるため、既存の `useEffect` ポーリング（1秒インターバル）が `manualAssignments` も含む `refreshAll` を呼んでいるためそのまま反映される。ただし content script から追加した場合にも即時反映するよう、`chrome.storage.onChanged` リスナーを追加する:

```typescript
useEffect(() => {
  function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>) {
    if (MANUAL_ASSIGNMENTS_KEY in changes) {
      const newValue = changes[MANUAL_ASSIGNMENTS_KEY].newValue as ManualAssignment[] | undefined
      setManualAssignments(newValue ?? [])
    }
  }

  chrome.storage.local.onChanged.addListener(onStorageChanged)
  return () => chrome.storage.local.onChanged.removeListener(onStorageChanged)
}, [])
```

手動削除ハンドラーを追加:
```typescript
async function handleDeleteManualAssignment(id: string) {
  await deleteManualAssignment(id)
  setManualAssignments((prev) => prev.filter((a) => a.id !== id))
}
```

ダッシュボードの JSX 内（`{isDashboard && (` ブロック内、コース選択 `<details>` の直前）に追加:
```tsx
<ManualAssignmentSection
  assignments={manualAssignments}
  onDelete={(id) => void handleDeleteManualAssignment(id)}
/>
```

- [ ] **Step 3: ビルドしてエラーがないことを確認する**

```
pnpm build
```

Expected: エラーなし

- [ ] **Step 4: 手動確認**

1. 拡張機能を再読み込み
2. LETUSのページでフローティングボタンから課題を追加
3. ダッシュボードを開く（`index.html#dashboard`）
4. 「手動追加した課題」セクションに追加した課題が表示されることを確認
5. 「削除」ボタンを押すとリストから消えることを確認
6. LETUSのURLが入っている場合はタイトルがリンクになっていることを確認
7. 「手動」バッジが表示されることを確認

- [ ] **Step 5: `App.css` に手動課題セクションのスタイルを追加する**

`App.css` の末尾に追記（既存スタイルの命名規則に合わせて記述）:
```css
.manualAssignmentSection {
  margin: 1.5rem 0;
}

.manualAssignmentHeading {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.manualAssignmentCount {
  font-size: 0.75rem;
  background: var(--color-surface-2, #f3f4f6);
  border-radius: 999px;
  padding: 1px 8px;
}

.manualAssignmentList {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.manualAssignmentItem {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 8px;
  background: var(--color-surface, #fff);
}

.manualAssignmentMain {
  flex: 1;
  min-width: 0;
}

.manualAssignmentTitle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
}

.manualAssignmentLink {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.manualBadge {
  font-size: 0.625rem;
  background: #dbeafe;
  color: #1d4ed8;
  border-radius: 4px;
  padding: 1px 5px;
  white-space: nowrap;
}

.manualAssignmentMeta {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #6b7280);
}

.manualAssignmentMemo {
  font-size: 0.75rem;
  color: var(--color-text-secondary, #6b7280);
  margin-top: 0.25rem;
}

.manualDeleteBtn {
  font-size: 0.75rem;
  color: #dc2626;
  background: none;
  border: 1px solid #fca5a5;
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.manualDeleteBtn:hover {
  background: #fef2f2;
}
```

- [ ] **Step 6: 最終ビルドと確認**

```
pnpm build
```

- [ ] **Step 7: コミットする**

```bash
git add src/components/ManualAssignmentSection.tsx src/App.tsx src/App.css
git commit -m "feat(dashboard): add manual assignment section with delete support"
```
