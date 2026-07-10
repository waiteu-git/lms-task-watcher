import type { Assignment, Course } from '../core/types'
import type { ManualAssignment } from '../core/manualAssignment'
import {
  computeBadgeState,
  isSameBadgeState,
  normalizeAssignmentUrl,
  type BadgeState,
} from '../core/badgeState'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function getCourses(): Promise<Course[]> {
  const r = await chrome.storage.local.get('courses') as { courses?: Course[] }
  return r.courses ?? []
}

async function getAssignments(): Promise<Assignment[]> {
  const r = await chrome.storage.local.get('assignments') as { assignments?: Assignment[] }
  return r.assignments ?? []
}

async function getManualAssignments(): Promise<ManualAssignment[]> {
  const r = await chrome.storage.local.get('manualAssignments') as { manualAssignments?: Array<Partial<ManualAssignment> & { id: string }> }
  return (r.manualAssignments ?? []).map((record) => ({
    ...record,
    submitted: record.submitted ?? false,
  })) as ManualAssignment[]
}

async function addManualAssignment(item: ManualAssignment): Promise<void> {
  const r = await chrome.storage.local.get('manualAssignments') as { manualAssignments?: Array<Partial<ManualAssignment> & { id: string }> }
  const current = (r.manualAssignments ?? []).map((record) => ({
    ...record,
    submitted: record.submitted ?? false,
  })) as ManualAssignment[]
  await chrome.storage.local.set({ manualAssignments: [...current, item] })
}

// プレミアムのメモ・優先度機能（src/core/premium.ts）と同じストレージ形式。
// content scriptは自己完結が必須のためロジックをインライン化している。
async function seedAssignmentMemo(assignmentId: string, memo: string): Promise<void> {
  const r = await chrome.storage.local.get('assignmentMemos') as {
    assignmentMemos?: Record<string, { priority: 0 | 1 | 2 | 3; memo: string }>
  }
  const current = r.assignmentMemos ?? {}
  await chrome.storage.local.set({
    assignmentMemos: { ...current, [assignmentId]: { priority: 0, memo } },
  })
}

function createId(): string {
  return crypto.randomUUID()
}

function isCoursePage(): boolean {
  return (
    location.pathname.includes('/course/view.php') &&
    new URLSearchParams(location.search).has('id')
  )
}

function isAssignmentPage(): boolean {
  return (
    location.pathname.includes('/mod/assign/view.php') &&
    new URLSearchParams(location.search).has('id')
  )
}

function buildWidget(courses: Course[], defaultCourseId?: string): void {
  const host = document.createElement('div')
  host.id = 'letus-task-watcher-widget'
  host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;'
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'closed' })
  buildWidgetInto(shadow, courses, undefined, defaultCourseId)
}

function openQuickAddForm(courses: Course[], title: string, url: string, defaultCourseId?: string): void {
  const existingHost = document.getElementById('letus-task-watcher-quickadd')
  if (existingHost) existingHost.remove()

  const host = document.createElement('div')
  host.id = 'letus-task-watcher-quickadd'
  host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;'
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'closed' })
  buildWidgetInto(shadow, courses, { title, url }, defaultCourseId)
}

function buildWidgetInto(
  shadow: ShadowRoot,
  courses: Course[],
  prefill?: { title: string; url: string },
  defaultCourseId?: string,
): void {
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
        ${courses.map((c) => `<option value="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field">
      <div class="meta" id="wt-url-display">${escapeHtml(prefill?.url ?? location.href)}</div>
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

  if (defaultCourseId) {
    ;(shadow.getElementById('wt-course') as HTMLSelectElement).value = defaultCourseId
  }

  if (prefill) {
    ;(shadow.getElementById('wt-title') as HTMLInputElement).value = prefill.title
    panel.classList.add('open')
  }

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
      letusUrl: prefill?.url ?? location.href,
      deadline: new Date(deadline).toISOString(),
      memo,
      createdAt: new Date().toISOString(),
      submitted: false,
    }

    await addManualAssignment(item)
    if (memo) {
      await seedAssignmentMemo(item.id, memo)
    }
    closePanel()

    ;(shadow.getElementById('wt-title') as HTMLInputElement).value = ''
    ;(shadow.getElementById('wt-deadline') as HTMLInputElement).value = ''
    ;(shadow.getElementById('wt-memo') as HTMLTextAreaElement).value = ''
    ;(shadow.getElementById('wt-course') as HTMLSelectElement).selectedIndex = 0
  })
}

const BADGE_TARGET_MODULE_TYPES = ['assign', 'resource', 'folder', 'url', 'page', 'forum', 'quiz']

function findAssignmentLinks(): HTMLAnchorElement[] {
  const selector = BADGE_TARGET_MODULE_TYPES.map(
    (type) => `a[href*="/mod/${type}/view.php"]`,
  ).join(',')
  return Array.from(document.querySelectorAll<HTMLAnchorElement>(selector))
}

function createBadgeHost(): { host: HTMLElement; shadow: ShadowRoot } {
  const host = document.createElement('span')
  host.style.cssText = 'position:absolute;right:6px;transform:translateY(-50%);z-index:1;'
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; font-family: sans-serif; }
    .badge {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11px; padding: 2px 9px; border-radius: 999px;
      border: 1px solid transparent; font-weight: 700;
      background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);
      color: #fff; white-space: nowrap; cursor: default;
      box-shadow: 0 1px 3px rgba(245,158,11,.35);
    }
    .badge.clickable { cursor: pointer; transition: filter .12s ease; }
    .badge.clickable:hover { filter: brightness(1.08); }
    .badge.submitted {
      background: linear-gradient(135deg, #059669 0%, #34d399 100%);
      box-shadow: 0 1px 3px rgba(5,150,105,.35);
    }
    .badge.unadded {
      background: linear-gradient(135deg, #7e14ff 0%, #47bfff 100%);
      box-shadow: 0 1px 4px rgba(126,20,255,.4);
    }
  `
  shadow.appendChild(style)

  return { host, shadow }
}

async function toggleManualSubmitted(id: string): Promise<void> {
  const r = await chrome.storage.local.get('manualAssignments') as { manualAssignments?: Array<Partial<ManualAssignment> & { id: string }> }
  const current = (r.manualAssignments ?? []).map((record) => ({
    ...record,
    submitted: record.submitted ?? false,
  })) as ManualAssignment[]
  const updated = current.map((a) => (a.id === id ? { ...a, submitted: !a.submitted } : a))
  await chrome.storage.local.set({ manualAssignments: updated })
}

/** 描画済みバッジ。ストレージ更新時にDOMを作り直さず中身だけ差し替えるために保持する。 */
type BadgeEntry = { link: HTMLAnchorElement; url: string; badge: HTMLSpanElement; state: BadgeState | null }

const badgeEntries: BadgeEntry[] = []

function applyBadgeState(
  entry: BadgeEntry,
  state: BadgeState,
  courses: Course[],
  currentCourseId?: string,
): void {
  if (entry.state && isSameBadgeState(entry.state, state)) return
  entry.state = state

  const badge = entry.badge
  // click ハンドラは状態ごとに異なるため、ノードを差し替えて過去のリスナを捨てる。
  const fresh = badge.cloneNode(false) as HTMLSpanElement
  badge.replaceWith(fresh)
  entry.badge = fresh

  if (state.kind === 'scanned') {
    const icon = state.submitted ? '✓' : '！'
    fresh.className = `badge ${state.submitted ? 'submitted' : ''}`
    fresh.textContent = state.deadline ? `${formatDeadlineShort(state.deadline)} ${icon}` : icon
    return
  }

  if (state.kind === 'manual') {
    fresh.className = `badge clickable ${state.submitted ? 'submitted' : ''}`
    fresh.textContent = `${formatDeadlineShort(state.deadline)} ${state.submitted ? '✓' : '！'}`
    fresh.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      await toggleManualSubmitted(state.id)
      // 保存後の storage.onChanged で再描画されるため、ここでDOMは触らない。
    })
    return
  }

  fresh.className = 'badge unadded clickable'
  fresh.textContent = '+'
  fresh.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    openQuickAddForm(courses, entry.link.textContent ?? '', entry.url, currentCourseId)
  })
}

function buildCourseBadges(
  courses: Course[],
  assignments: Assignment[],
  manualAssignments: ManualAssignment[],
  currentCourseId?: string,
): void {
  for (const link of findAssignmentLinks()) {
    let url: string
    try {
      url = normalizeAssignmentUrl(new URL(link.href, location.href).toString())
    } catch {
      continue
    }

    if (link.dataset.letusTaskWatcherBadge === 'true') continue
    link.dataset.letusTaskWatcherBadge = 'true'

    const { host, shadow } = createBadgeHost()
    const badge = document.createElement('span')
    shadow.appendChild(badge)

    const entry: BadgeEntry = { link, url, badge, state: null }
    badgeEntries.push(entry)
    applyBadgeState(entry, computeBadgeState(url, assignments, manualAssignments), courses, currentCourseId)

    const row = (link.closest('li, tr') ?? link.parentElement) as HTMLElement | null
    if (row) {
      if (getComputedStyle(row).position === 'static') {
        row.style.position = 'relative'
      }
      const rowRect = row.getBoundingClientRect()
      const linkRect = link.getBoundingClientRect()
      const topPx = linkRect.top - rowRect.top + linkRect.height / 2
      host.style.top = `${topPx}px`
      row.appendChild(host)
    } else {
      link.insertAdjacentElement('afterend', host)
    }
  }
}

/** 描画済みバッジを最新のストレージ内容で塗り直す。 */
function refreshCourseBadges(
  courses: Course[],
  assignments: Assignment[],
  manualAssignments: ManualAssignment[],
  currentCourseId?: string,
): void {
  for (const entry of badgeEntries) {
    applyBadgeState(entry, computeBadgeState(entry.url, assignments, manualAssignments), courses, currentCourseId)
  }
}

function findCurrentCourseId(courses: Course[]): string | undefined {
  const currentUrl = normalizeAssignmentUrl(location.href)
  return courses.find((c) => normalizeAssignmentUrl(c.url) === currentUrl)?.id
}

export async function initManualTaskWidget(): Promise<void> {
  if (!isCoursePage() && !isAssignmentPage()) return

  const [courses, assignments, manualAssignments] = await Promise.all([
    getCourses(),
    getAssignments(),
    getManualAssignments(),
  ])

  if (courses.length === 0) return

  if (isCoursePage()) {
    const currentCourseId = findCurrentCourseId(courses)
    buildCourseBadges(courses, assignments, manualAssignments, currentCourseId)
    if (!document.getElementById('letus-task-watcher-widget')) {
      buildWidget(courses, currentCourseId)
    }
    watchStorage()
    return
  }

  if (document.getElementById('letus-task-watcher-widget')) return

  const state = computeBadgeState(location.href, assignments, manualAssignments)
  if (state.kind === 'scanned') {
    buildScannedIndicator(state)
    watchStorage()
  } else {
    buildWidget(courses)
  }
}

/**
 * バックグラウンドのスキャンが提出状態を更新しても、描画済みのLETUSページは古いままだった
 * （popup/dashboard は開き直し＋onChanged 購読で更新される）。ストレージ更新を購読して塗り直す。
 * bfcache（戻る）復帰では content script が再実行されないため pageshow でも取り直す。
 */
let storageWatched = false
function watchStorage(): void {
  if (storageWatched) return
  storageWatched = true

  chrome.storage.local.onChanged.addListener((changes) => {
    if (!('assignments' in changes || 'manualAssignments' in changes || 'courses' in changes)) return
    void repaint()
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void repaint()
  })
}

async function repaint(): Promise<void> {
  const [courses, assignments, manualAssignments] = await Promise.all([
    getCourses(),
    getAssignments(),
    getManualAssignments(),
  ])

  if (isCoursePage()) {
    const currentCourseId = findCurrentCourseId(courses)
    // 遅延描画で後から現れたリンクも拾う
    buildCourseBadges(courses, assignments, manualAssignments, currentCourseId)
    refreshCourseBadges(courses, assignments, manualAssignments, currentCourseId)
    return
  }

  const state = computeBadgeState(location.href, assignments, manualAssignments)
  if (state.kind === 'scanned') updateScannedIndicator(state)
}

type ScannedBadgeState = Extract<BadgeState, { kind: 'scanned' }>

let indicatorEl: HTMLDivElement | null = null

function buildScannedIndicator(state: ScannedBadgeState): void {
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
      background: #fffbeb; border: 1px solid #fcd34d;
      border-radius: 10px; padding: 8px 12px; cursor: pointer;
    }
    .indicator.submitted { background: #f0fdf4; border-color: #86efac; }
    .icon { color: #d97706; font-size: 16px; }
    .indicator.submitted .icon { color: #16a34a; }
    .label { font-size: 12px; }
    .title { font-weight: 600; color: #b45309; }
    .indicator.submitted .title { color: #15803d; }
    .deadline { color: #b45309; opacity: .85; }
    .indicator.submitted .deadline { color: #16a34a; opacity: .85; }
  `
  shadow.appendChild(style)

  const el = document.createElement('div')
  el.title = 'ダッシュボードで確認'
  el.innerHTML = `
    <span class="icon"></span>
    <div class="label">
      <div class="title"></div>
      <div class="deadline"></div>
    </div>
  `
  el.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' })
  })
  shadow.appendChild(el)

  indicatorEl = el
  updateScannedIndicator(state)
}

function updateScannedIndicator(state: ScannedBadgeState): void {
  const el = indicatorEl
  if (!el) return

  el.className = `indicator ${state.submitted ? 'submitted' : ''}`
  el.querySelector('.icon')!.textContent = state.submitted ? '✓' : '！'
  el.querySelector('.title')!.textContent = state.submitted ? '提出済み' : '未提出'
  el.querySelector('.deadline')!.textContent =
    `締切 ${state.deadline ? formatDeadlineShort(state.deadline) : '未取得'}`
}

function formatDeadlineShort(isoString: string): string {
  if (!isoString) return '締切未取得'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return '締切未取得'
  const m = d.getMonth() + 1
  const day = d.getDate()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${day} ${hh}:${mm}`
}
