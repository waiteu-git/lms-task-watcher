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
