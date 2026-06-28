import type { Course } from '../core/types'
import {
  type ManualAssignment,
  addManualAssignment,
  getManualAssignments,
  toggleManualAssignmentSubmitted,
} from '../core/manualAssignment'

// --- helpers ---

function getCourseFromPage(courses: Course[]): Course | null {
  const url = location.href.split('#')[0]
  return courses.find((c) => c.url.split('#')[0] === url) ?? null
}

function formatDeadline(iso: string): string {
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${m}/${day} ${hh}:${mm}`
}

// --- Hover style injected once into document ---

function injectHoverStyle(): void {
  if (document.getElementById('ltw-style')) return
  const s = document.createElement('style')
  s.id = 'ltw-style'
  s.textContent = '.ltw-btn-host{opacity:1}'
  document.head.appendChild(s)
}

// --- Global popup (single instance, repositioned per click) ---

let _popup: HTMLElement | null = null

function ensurePopup(): HTMLElement {
  if (_popup) return _popup
  _popup = document.createElement('div')
  _popup.id = 'ltw-popup'
  _popup.style.cssText =
    'display:none;position:fixed;z-index:2147483647;background:#fff;' +
    'border:1px solid #d1d5db;border-radius:10px;padding:12px 14px;width:240px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.14);font-family:sans-serif;font-size:12px;'
  document.body.appendChild(_popup)
  document.addEventListener(
    'click',
    (e) => {
      if (_popup && !_popup.contains(e.target as Node)) _popup.style.display = 'none'
    },
    true,
  )
  return _popup
}

function showAddPopup(
  anchor: Element,
  activityName: string,
  activityUrl: string,
  course: Course,
  onAdded: (a: ManualAssignment) => void,
): void {
  const p = ensurePopup()
  p.innerHTML =
    '<div style="font-weight:600;color:#111827;margin-bottom:6px">課題に追加</div>' +
    '<div id="ltw-name" style="color:#6b7280;font-size:11px;margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>' +
    '<input type="datetime-local" id="ltw-dl" style="width:100%;box-sizing:border-box;font-size:12px;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;color:#111827;margin-bottom:6px">' +
    '<textarea id="ltw-memo" placeholder="メモ（任意）" style="width:100%;box-sizing:border-box;font-size:12px;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;color:#111827;resize:none;height:44px;margin-bottom:8px"></textarea>' +
    '<div style="display:flex;gap:6px">' +
    '<button id="ltw-cancel" type="button" style="flex:1;border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:5px;cursor:pointer;font-size:12px;color:#374151">キャンセル</button>' +
    '<button id="ltw-submit" type="button" style="flex:2;background:#2563eb;color:#fff;border:none;border-radius:6px;padding:5px;cursor:pointer;font-size:12px">追加する</button>' +
    '</div><div id="ltw-err" style="color:#dc2626;font-size:11px;margin-top:4px"></div>'

  ;(p.querySelector('#ltw-name') as HTMLElement).textContent = activityName

  p.querySelector('#ltw-cancel')!.addEventListener('click', () => {
    p.style.display = 'none'
  })

  p.querySelector('#ltw-submit')!.addEventListener('click', async () => {
    const deadline = (p.querySelector('#ltw-dl') as HTMLInputElement).value
    const memo = (p.querySelector('#ltw-memo') as HTMLTextAreaElement).value.trim()
    const errEl = p.querySelector('#ltw-err') as HTMLElement
    if (!deadline) {
      errEl.textContent = '締切を入力してください。'
      return
    }
    errEl.textContent = ''
    const assignment: ManualAssignment = {
      id: crypto.randomUUID(),
      courseId: course.id,
      courseName: course.name,
      title: activityName,
      letusUrl: activityUrl,
      deadline: new Date(deadline).toISOString(),
      memo,
      submitted: false,
      createdAt: new Date().toISOString(),
    }
    await addManualAssignment(assignment)
    p.style.display = 'none'
    onAdded(assignment)
  })

  const rect = anchor.getBoundingClientRect()
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - 256)
  const top =
    window.innerHeight - rect.bottom > 220 ? rect.bottom + 6 : rect.top - 222
  p.style.left = `${left}px`
  p.style.top = `${Math.max(8, top)}px`
  p.style.display = 'block'
}

// --- Badge for tracked activities ---

function buildBadge(shadow: ShadowRoot, assignment: ManualAssignment): void {
  const style = document.createElement('style')
  style.textContent =
    ':host{all:initial}' +
    '.b{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:6px;' +
    'font-size:11px;cursor:pointer;white-space:nowrap;border:0.5px solid;font-family:sans-serif;user-select:none}' +
    '.p{background:#fef3c7;color:#78350f;border-color:#fcd34d}' +
    '.s{background:#d1fae5;color:#065f46;border-color:#6ee7b7}' +
    '.o{background:#fee2e2;color:#991b1b;border-color:#fca5a5}'
  shadow.appendChild(style)

  let submitted = assignment.submitted ?? false

  const render = (): void => {
    const old = shadow.querySelector('.b')
    if (old) old.remove()
    const b = document.createElement('span')
    const overdue = new Date(assignment.deadline) < new Date()
    const dl = formatDeadline(assignment.deadline)
    if (submitted) {
      b.className = 'b s'
      b.textContent = `✓ ${dl} · 提出済み`
      b.title = 'クリックで未提出に変更'
    } else if (overdue) {
      b.className = 'b o'
      b.textContent = `! ${dl} · 期限切れ`
      b.title = 'クリックで提出済みに変更'
    } else {
      b.className = 'b p'
      b.textContent = `⏱ ${dl} · 未提出`
      b.title = 'クリックで提出済みに変更'
    }
    b.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      await toggleManualAssignmentSubmitted(assignment.id)
      submitted = !submitted
      render()
    })
    shadow.appendChild(b)
  }
  render()
}

// --- Hover button for untracked activities ---

function buildHoverBtn(
  shadow: ShadowRoot,
  anchor: Element,
  course: Course,
  activityName: string,
  activityUrl: string,
  onAdded: (a: ManualAssignment) => void,
): void {
  const style = document.createElement('style')
  style.textContent =
    ':host{all:initial}' +
    'button{width:22px;height:22px;border-radius:50%;border:1px solid #bfdbfe;background:#eff6ff;' +
    'display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0}' +
    'button:hover{background:#dbeafe}'
  shadow.appendChild(style)

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.title = '課題に追加'
  btn.setAttribute('aria-label', '課題に追加')
  btn.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5">' +
    '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    showAddPopup(anchor, activityName, activityUrl, course, onAdded)
  })
  shadow.appendChild(btn)
}

// --- Process all activity elements ---

function processActivities(
  course: Course,
  manualAssignments: ManualAssignment[],
): void {
  for (const li of document.querySelectorAll<HTMLElement>('li.activity')) {
    const a = li.querySelector<HTMLAnchorElement>('a.aalink')
    const activityItem = li.querySelector<HTMLElement>('[data-activityname]')
    const grid = li.querySelector<HTMLElement>('.activity-grid')
    if (!a || !activityItem || !grid || grid.querySelector('.ltw-btn-host,.ltw-badge-host'))
      continue

    const activityUrl = a.href.split('#')[0]
    const activityName =
      activityItem.dataset.activityname ?? a.textContent?.trim() ?? ''
    const existing = manualAssignments.find(
      (m) => m.letusUrl != null && m.letusUrl.split('#')[0] === activityUrl,
    )

    const host = document.createElement('div')
    host.style.cssText =
      'display:flex;align-items:center;margin-left:auto;padding-left:8px;flex-shrink:0;'
    const shadow = host.attachShadow({ mode: 'closed' })

    if (existing) {
      host.className = 'ltw-badge-host'
      buildBadge(shadow, existing)
    } else {
      host.className = 'ltw-btn-host'
      buildHoverBtn(shadow, li, course, activityName, activityUrl, (newAssignment) => {
        host.className = 'ltw-badge-host'
        while (shadow.firstChild) shadow.removeChild(shadow.firstChild)
        buildBadge(shadow, newAssignment)
      })
    }

    grid.appendChild(host)
  }
}

// --- Entry point ---

export async function initActivityWidget(courses: Course[]): Promise<void> {
  const course = getCourseFromPage(courses)
  if (!course) return

  injectHoverStyle()

  let manualAssignments = await getManualAssignments()
  processActivities(course, manualAssignments)

  let processedCount = document.querySelectorAll('li.activity').length

  const observer = new MutationObserver(async () => {
    const current = document.querySelectorAll('li.activity').length
    if (current > processedCount) {
      processedCount = current
      manualAssignments = await getManualAssignments()
      processActivities(course, manualAssignments)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}
