type Course = { id: string; name: string; url: string; enabled: boolean; lmsType: 'unknown' | 'letus' | 'moodle' | 'manaba' | 'webclass' | 'generic'; createdAt: string; updatedAt: string }
type Assignment = { id: string; courseId: string; courseName: string; title: string; url: string; deadline: string | null; deadlineText: string; sourceText: string; submissionStatus: 'unknown' | 'not_submitted' | 'submitted' | 'completed'; lifecycleStatus: 'active' | 'new' | 'changed' | 'before_start' | 'submitted' | 'passed' | 'missing' | 'archived'; detectedAt: string; firstSeenAt: string; lastSeenAt: string; lastCheckedAt: string }
type ManualAssignment = {
  id: string
  courseId: string
  courseName: string
  title: string
  letusUrl: string | null
  deadline: string
  memo: string
  submitted: boolean
  createdAt: string
}

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
    closePanel()

    ;(shadow.getElementById('wt-title') as HTMLInputElement).value = ''
    ;(shadow.getElementById('wt-deadline') as HTMLInputElement).value = ''
    ;(shadow.getElementById('wt-memo') as HTMLTextAreaElement).value = ''
    ;(shadow.getElementById('wt-course') as HTMLSelectElement).selectedIndex = 0
  })
}

function normalizeAssignmentUrl(url: string): string {
  return url.split('#')[0]
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
  host.style.cssText = 'position:absolute;right:6px;transform:translateY(-50%);z-index:2147483000;'
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; font-family: sans-serif; }
    .badge {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 11px; padding: 2px 9px; border-radius: 999px;
      border: 1px solid transparent; font-weight: 700;
      background: linear-gradient(135deg, #7e14ff 0%, #47bfff 100%);
      color: #fff; white-space: nowrap; cursor: default;
      box-shadow: 0 1px 3px rgba(126,20,255,.35);
    }
    .badge.clickable { cursor: pointer; transition: filter .12s ease; }
    .badge.clickable:hover { filter: brightness(1.08); }
    .badge.submitted {
      background: linear-gradient(135deg, #059669 0%, #34d399 100%);
      box-shadow: 0 1px 3px rgba(5,150,105,.35);
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

function isScannedSubmitted(assignment: Assignment): boolean {
  return (
    assignment.lifecycleStatus === 'submitted' ||
    assignment.submissionStatus === 'submitted' ||
    assignment.submissionStatus === 'completed'
  )
}

function buildCourseBadges(
  courses: Course[],
  assignments: Assignment[],
  manualAssignments: ManualAssignment[],
  currentCourseId?: string,
): void {
  const links = findAssignmentLinks()

  for (const link of links) {
    let url: string
    try {
      url = normalizeAssignmentUrl(new URL(link.href, location.href).toString())
    } catch {
      continue
    }

    if (link.dataset.letusTaskWatcherBadge === 'true') continue
    link.dataset.letusTaskWatcherBadge = 'true'

    const scanned = assignments.find(
      (a) => a.url && normalizeAssignmentUrl(a.url) === url,
    )
    const manual = manualAssignments.find(
      (a) => a.letusUrl && normalizeAssignmentUrl(a.letusUrl) === url,
    )

    const { host, shadow } = createBadgeHost()
    const badge = document.createElement('span')

    if (scanned) {
      const submitted = isScannedSubmitted(scanned)
      const icon = submitted ? '✓' : '！'
      badge.className = `badge ${submitted ? 'submitted' : ''}`
      badge.textContent = scanned.deadline
        ? `${formatDeadlineShort(scanned.deadline)} ${icon}`
        : icon
    } else if (manual) {
      let currentSubmitted = manual.submitted
      badge.className = `badge clickable ${currentSubmitted ? 'submitted' : ''}`
      badge.textContent = `${formatDeadlineShort(manual.deadline)} ${currentSubmitted ? '✓' : '！'}`
      badge.addEventListener('click', async (event) => {
        event.preventDefault()
        event.stopPropagation()
        await toggleManualSubmitted(manual.id)
        currentSubmitted = !currentSubmitted
        badge.classList.toggle('submitted', currentSubmitted)
        badge.textContent = `${formatDeadlineShort(manual.deadline)} ${currentSubmitted ? '✓' : '！'}`
      })
    } else {
      badge.className = 'badge unadded clickable'
      badge.textContent = '+'
      badge.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        openQuickAddForm(courses, link.textContent ?? '', url, currentCourseId)
      })
    }

    shadow.appendChild(badge)

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

export async function initManualTaskWidget(): Promise<void> {
  if (!isCoursePage() && !isAssignmentPage()) return

  const [courses, assignments, manualAssignments] = await Promise.all([
    getCourses(),
    getAssignments(),
    getManualAssignments(),
  ])

  const enabledCourses = courses.filter((c) => c.enabled)
  if (enabledCourses.length === 0) return

  if (isCoursePage()) {
    const currentUrl = normalizeAssignmentUrl(location.href)
    const currentCourseId = enabledCourses.find(
      (c) => normalizeAssignmentUrl(c.url) === currentUrl,
    )?.id

    buildCourseBadges(enabledCourses, assignments, manualAssignments, currentCourseId)
    if (!document.getElementById('letus-task-watcher-widget')) {
      buildWidget(enabledCourses, currentCourseId)
    }
    return
  }

  if (document.getElementById('letus-task-watcher-widget')) return

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

function buildScannedIndicator(assignment: Assignment): void {
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
    void chrome.tabs.create({ url: chrome.runtime.getURL('index.html#dashboard') })
  })
  shadow.appendChild(el)
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
