# CLASS時間割連携（収集＋グリッド表示＋科目連携）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLASSの学生時間割表をpassiveに取り込み、ダッシュボードに時間割グリッドとして表示し、7桁科目コードでLETUS課題と突合して課題カードに教室・時限・シラバスのチップを出す。

**Architecture:** content scriptは表示中の`table.classTable`の生HTML＋学期＋年度を`chrome.storage.local`へ保存するだけ（dumb grabber、パースしない）。パースは移植済み`src/core/timetable.ts`をアプリ側で実行。突合・オーバーライド適用・学期判定は純関数`src/core/timetableLink.ts`。ストレージI/Oは`src/core/timetableStore.ts`。UIは`src/components/TimetableSection.tsx`と課題カードのチップ。

**Tech Stack:** React 19 + TypeScript + Vite、`node-html-parser`（移植済みパーサが使用、アプリ側のみ）、`chrome.storage.local`、vitest。

## Global Constraints

- 対象: `C:\dev\lms-task-watcher`（branch `develop`）。全タスクここで作業。
- 設計書: `docs/superpowers/specs/2026-07-07-class-timetable-integration-design.md`。
- 収集は **passive-only**。学期セレクタのdriving（値変更＋search押下）は実装しない。
- content scriptは`node-html-parser`を**import しない**。パースはアプリ側のみ。
- content scriptは`timetableStore.ts`を**import しない**（Rollupの共有チャンク化で`import`文が出力され classic content script として壊れるのを避けるため）。ストレージキーを直書きして`chrome.storage.local.set`する。
- 収集対象は`table.classTable`と時限時刻エリアのみ。成績等には一切アクセスしない。
- ストレージキー: 時間割=`timetable:{year}:{semester}`、オーバーライド=`timetableOverrides:{year}:{semester}:{courseCode}`、表示選択=`timetableView`。`semester`は`'zenki' | 'kouki'`。
- 検証コマンド: `pnpm exec tsc -b`・`pnpm build`・`pnpm exec vitest run src`。
- vitestテストは`import { describe, it, expect } from 'vitest'`を明示（globals未設定）。
- コミットのフッタは `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

## File Structure

- Create: `src/core/timetableLink.ts` — 純関数（型定義・コード抽出・学期判定・オーバーライド適用・突合）。
- Create: `src/core/timetableLink.test.ts` — 上記のvitest。
- Create: `src/core/timetableStore.ts` — `chrome.storage.local`のI/Oラッパ。
- Create: `src/core/timetableStore.test.ts` — chromeスタブでのvitest。
- Create: `src/content/classTimetable.ts` — content script（dumb grabber＋トースト）。
- Create: `src/components/TimetableSection.tsx` — ダッシュボードの時間割セクション。
- Modify: `public/manifest.json` — `host_permissions`＋`content_scripts`追加。
- Modify: `vite.config.ts` — `classTimetable`エントリ追加。
- Modify: `src/App.tsx` — `TimetableSection`配置＋課題カードのチップ。
- Modify: `src/App.css` — 時間割グリッド・チップのCSS。
- 変更しない: `src/core/timetable.ts`・`src/core/syllabus.ts`（移植済み・テスト済み）。

---

### Task 1: 純関数 — コード抽出・学期判定

**Files:**
- Create: `src/core/timetableLink.ts`
- Test: `src/core/timetableLink.test.ts`

**Interfaces:**
- Consumes: `TimetableSlot`, `DayOfWeek`（`./timetable`）、`Course`, `Assignment`（`./types`）。
- Produces:
  - `type Semester = 'zenki' | 'kouki'`
  - `type TimetableOverride = { room?: string }`
  - `type SemesterCapture = { semester: Semester; capturedAt: string }`
  - `type AssignmentSlotInfo = { day: DayOfWeek; period: number; room: string; isRemote: boolean; courseCode: string }`
  - `extractCourseCodes(letusCourseName: string): string[]`（全7桁コード。統合コースは複数）
  - `extractCourseCode(letusCourseName: string): string | null`（先頭1件、`extractCourseCodes(...)[0] ?? null`）
  - `resolveSemester(now: Date, captured: SemesterCapture[]): Semester`

- [ ] **Step 1: 失敗するテストを書く**

`src/core/timetableLink.test.ts` を作成:

```ts
import { describe, it, expect } from 'vitest'
import { extractCourseCode, extractCourseCodes, resolveSemester } from './timetableLink'

describe('extractCourseCodes', () => {
  it('コース名に埋め込まれた7桁コードを全て抽出する', () => {
    expect(extractCourseCodes('9973337 基礎電気数学及び演習')).toEqual(['9973337'])
    expect(extractCourseCodes('統合 9973337 / 9973344')).toEqual(['9973337', '9973344'])
  })
  it('7桁が無ければ空配列', () => {
    expect(extractCourseCodes('基礎電気数学及び演習')).toEqual([])
    expect(extractCourseCodes('99733370 号')).toEqual([]) // 8桁は取らない
  })
})

describe('extractCourseCode', () => {
  it('先頭の7桁コードを返す', () => {
    expect(extractCourseCode('9973337 基礎電気数学及び演習')).toBe('9973337')
    expect(extractCourseCode('基礎電気数学及び演習 [9973337]')).toBe('9973337')
  })
  it('7桁が無ければ null', () => {
    expect(extractCourseCode('基礎電気数学及び演習')).toBeNull()
    expect(extractCourseCode('99733370 号')).toBeNull()
  })
})

describe('resolveSemester', () => {
  it('取得済みがあれば capturedAt が最新の学期', () => {
    const captured = [
      { semester: 'zenki' as const, capturedAt: '2026-04-10T00:00:00Z' },
      { semester: 'kouki' as const, capturedAt: '2026-10-01T00:00:00Z' },
    ]
    expect(resolveSemester(new Date(2026, 6, 5), captured)).toBe('kouki')
  })
  it('取得済みが空なら日付で判定（4–9月=前期）', () => {
    expect(resolveSemester(new Date(2026, 3, 1), [])).toBe('zenki') // 4月
    expect(resolveSemester(new Date(2026, 8, 30), [])).toBe('zenki') // 9月
  })
  it('取得済みが空なら日付で判定（10–3月=後期）', () => {
    expect(resolveSemester(new Date(2026, 9, 1), [])).toBe('kouki') // 10月
    expect(resolveSemester(new Date(2026, 1, 15), [])).toBe('kouki') // 2月
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/core/timetableLink.test.ts`
Expected: FAIL（`timetableLink` が存在しない）

- [ ] **Step 3: 最小実装**

`src/core/timetableLink.ts` を作成:

```ts
import type { TimetableSlot, DayOfWeek } from './timetable'
import type { Course, Assignment } from './types'

export type Semester = 'zenki' | 'kouki'
export type TimetableOverride = { room?: string }
export type SemesterCapture = { semester: Semester; capturedAt: string }
export type AssignmentSlotInfo = {
  day: DayOfWeek
  period: number
  room: string
  isRemote: boolean
  courseCode: string
}

/** LETUSコース名に埋め込まれた全7桁科目コードを抽出する（統合コースは複数）。 */
export function extractCourseCodes(letusCourseName: string): string[] {
  const matches = letusCourseName.match(/(?<!\d)\d{7}(?!\d)/g)
  return matches ? Array.from(new Set(matches)) : []
}

/** 先頭の7桁コード。無ければ null。 */
export function extractCourseCode(letusCourseName: string): string | null {
  return extractCourseCodes(letusCourseName)[0] ?? null
}

/** 既定表示学期。取得済みがあれば capturedAt 最新、無ければ日付（4–9月=前期）。 */
export function resolveSemester(now: Date, captured: SemesterCapture[]): Semester {
  if (captured.length > 0) {
    const latest = captured.reduce((a, b) => (a.capturedAt >= b.capturedAt ? a : b))
    return latest.semester
  }
  const month = now.getMonth()
  return month >= 3 && month <= 8 ? 'zenki' : 'kouki'
}
```

参照されない `TimetableSlot`/`Course`/`Assignment`/`AssignmentSlotInfo` は Task 2 で使うため import/export のまま残す（Task 2 と同一ファイル）。

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/core/timetableLink.test.ts`
Expected: PASS（9アサーション）

- [ ] **Step 5: コミット**

```bash
git add src/core/timetableLink.ts src/core/timetableLink.test.ts
git commit -m "feat(ext): add course-code extraction and semester resolution"
```

---

### Task 2: 純関数 — オーバーライド適用・課題突合

**Files:**
- Modify: `src/core/timetableLink.ts`
- Test: `src/core/timetableLink.test.ts`

**Interfaces:**
- Consumes: Task 1 の型、`TimetableSlot`（`./timetable`）、`Course`, `Assignment`（`./types`）。
- Produces:
  - `applyOverrides(slots: TimetableSlot[], overrides: Record<string, TimetableOverride>): TimetableSlot[]`
  - `linkAssignmentsToSlots(slots: TimetableSlot[], courses: Course[], assignments: Assignment[]): { assignmentInfo: Record<string, AssignmentSlotInfo>; courseCodeCounts: Record<string, number> }`

- [ ] **Step 1: 失敗するテストを追記**

`src/core/timetableLink.test.ts` の末尾に追記:

```ts
import { applyOverrides, linkAssignmentsToSlots } from './timetableLink'
import type { TimetableSlot } from './timetable'
import type { Course, Assignment } from './types'

function slot(day: TimetableSlot['day'], period: number, courseCode: string, room: string): TimetableSlot {
  return {
    day,
    period,
    classes: [{ courseCode, name: 'X', teachers: [], room, isRemote: room.includes('遠隔'), credits: null, badges: [] }],
  }
}

function course(id: string, name: string): Course {
  return { id, name, url: '', enabled: true, lmsType: 'letus', createdAt: '', updatedAt: '' }
}

function assignment(id: string, courseId: string): Assignment {
  return {
    id, courseId, courseName: '', title: '', url: '', deadline: null, deadlineText: '',
    deadlineSource: null, sourceText: '', submissionStatus: 'unknown', lifecycleStatus: 'active',
    detectedAt: '', firstSeenAt: '', lastSeenAt: '', lastCheckedAt: '',
  }
}

describe('applyOverrides', () => {
  it('courseCode 一致のコマの room を上書きし isRemote を再判定する', () => {
    const slots = [slot('mon', 1, '9973337', '445教室')]
    const result = applyOverrides(slots, { '9973337': { room: '遠隔（オンライン）' } })
    expect(result[0].classes[0].room).toBe('遠隔（オンライン）')
    expect(result[0].classes[0].isRemote).toBe(true)
  })
  it('オーバーライドが無いコマは変えない', () => {
    const slots = [slot('mon', 1, '9973337', '445教室')]
    const result = applyOverrides(slots, {})
    expect(result[0].classes[0].room).toBe('445教室')
  })
})

describe('linkAssignmentsToSlots', () => {
  it('7桁コードで課題をコマに紐づけ、件数を数える', () => {
    const slots = [slot('mon', 1, '9973337', '445教室')]
    const courses = [course('c1', '9973337 基礎電気数学')]
    const assignments = [assignment('a1', 'c1'), assignment('a2', 'c1')]
    const { assignmentInfo, courseCodeCounts } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1']).toEqual({ day: 'mon', period: 1, room: '445教室', isRemote: false, courseCode: '9973337' })
    expect(courseCodeCounts['9973337']).toBe(2)
  })
  it('コード抽出できないコースの課題は紐づかない', () => {
    const slots = [slot('mon', 1, '9973337', '445教室')]
    const courses = [course('c1', 'コード無しコース')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo, courseCodeCounts } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(assignmentInfo['a1']).toBeUndefined()
    expect(courseCodeCounts['9973337']).toBe(0)
  })
  it('統合コース（複数コード）は各コードのコマに件数が乗り、先頭一致コマにチップが付く', () => {
    const slots = [slot('mon', 1, '9973337', '445教室'), slot('tue', 4, '9973344', '444教室')]
    const courses = [course('c1', '統合 9973337 / 9973344')]
    const assignments = [assignment('a1', 'c1')]
    const { assignmentInfo, courseCodeCounts } = linkAssignmentsToSlots(slots, courses, assignments)
    expect(courseCodeCounts['9973337']).toBe(1)
    expect(courseCodeCounts['9973344']).toBe(1)
    expect(assignmentInfo['a1'].courseCode).toBe('9973337')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/core/timetableLink.test.ts`
Expected: FAIL（`applyOverrides`/`linkAssignmentsToSlots` 未定義）

- [ ] **Step 3: 最小実装を追記**

`src/core/timetableLink.ts` の末尾に追記:

```ts
export function applyOverrides(
  slots: TimetableSlot[],
  overrides: Record<string, TimetableOverride>,
): TimetableSlot[] {
  return slots.map((s) => ({
    ...s,
    classes: s.classes.map((c) => {
      const ov = overrides[c.courseCode]
      if (!ov || ov.room === undefined) return c
      return { ...c, room: ov.room, isRemote: ov.room.includes('遠隔') }
    }),
  }))
}

export function linkAssignmentsToSlots(
  slots: TimetableSlot[],
  courses: Course[],
  assignments: Assignment[],
): { assignmentInfo: Record<string, AssignmentSlotInfo>; courseCodeCounts: Record<string, number> } {
  const courseIdToCodes: Record<string, string[]> = {}
  for (const c of courses) {
    const codes = extractCourseCodes(c.name)
    if (codes.length > 0) courseIdToCodes[c.id] = codes
  }

  const codeToSlot: Record<string, AssignmentSlotInfo> = {}
  for (const s of slots) {
    for (const c of s.classes) {
      if (!(c.courseCode in codeToSlot)) {
        codeToSlot[c.courseCode] = {
          day: s.day, period: s.period, room: c.room, isRemote: c.isRemote, courseCode: c.courseCode,
        }
      }
    }
  }

  const assignmentInfo: Record<string, AssignmentSlotInfo> = {}
  const courseCodeCounts: Record<string, number> = {}
  for (const s of slots) for (const c of s.classes) courseCodeCounts[c.courseCode] ??= 0

  for (const a of assignments) {
    const codes = courseIdToCodes[a.courseId]
    if (!codes) continue
    // 統合コース: そのコースが持つ全コードのコマに件数を計上
    for (const code of codes) if (code in courseCodeCounts) courseCodeCounts[code] += 1
    // チップは時間割に存在する先頭一致コマに付ける
    const matched = codes.find((code) => code in codeToSlot)
    if (matched) assignmentInfo[a.id] = codeToSlot[matched]
  }

  return { assignmentInfo, courseCodeCounts }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/core/timetableLink.test.ts`
Expected: PASS（全ケース緑）

- [ ] **Step 5: コミット**

```bash
git add src/core/timetableLink.ts src/core/timetableLink.test.ts
git commit -m "feat(ext): add override merge and assignment-to-slot linking"
```

---

### Task 3: ストレージ層 `timetableStore.ts`

**Files:**
- Create: `src/core/timetableStore.ts`
- Test: `src/core/timetableStore.test.ts`

**Interfaces:**
- Consumes: `Semester`, `TimetableOverride`, `SemesterCapture`（`./timetableLink`）。
- Produces:
  - `type TimetableCapture = { rawTableHtml: string; jigenText: string; capturedAt: string }`
  - `saveTimetableCapture(year: number, semester: Semester, cap: TimetableCapture): Promise<void>`
  - `getTimetableCapture(year: number, semester: Semester): Promise<TimetableCapture | null>`
  - `listCapturedSemesters(year: number): Promise<SemesterCapture[]>`
  - `getOverride(year: number, semester: Semester, courseCode: string): Promise<TimetableOverride | null>`
  - `setOverride(year: number, semester: Semester, courseCode: string, ov: TimetableOverride): Promise<void>`
  - `getPreferredView(): Promise<{ year: number; semester: Semester } | null>`
  - `setPreferredView(year: number, semester: Semester): Promise<void>`
- 注: キー文字列は Global Constraints と一致させる。content script（Task 4）はこのモジュールをimportせず同じキーを直書きするため、キー生成規則を本タスクの定数と揃える。

- [ ] **Step 1: 失敗するテストを書く**

`src/core/timetableStore.test.ts` を作成:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveTimetableCapture, getTimetableCapture, listCapturedSemesters, setOverride, getOverride, setPreferredView, getPreferredView } from './timetableStore'

const store: Record<string, unknown> = {}
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (keys: string | string[]) => {
        const arr = Array.isArray(keys) ? keys : [keys]
        const out: Record<string, unknown> = {}
        for (const k of arr) if (k in store) out[k] = store[k]
        return Promise.resolve(out)
      },
      set: (obj: Record<string, unknown>) => { Object.assign(store, obj); return Promise.resolve() },
    },
  },
})

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

describe('timetableStore', () => {
  it('capture を保存・取得できる', async () => {
    await saveTimetableCapture(2026, 'zenki', { rawTableHtml: '<table></table>', jigenText: '野田', capturedAt: '2026-04-10T00:00:00Z' })
    const got = await getTimetableCapture(2026, 'zenki')
    expect(got?.jigenText).toBe('野田')
    expect(await getTimetableCapture(2026, 'kouki')).toBeNull()
  })
  it('取得済み学期を列挙する', async () => {
    await saveTimetableCapture(2026, 'zenki', { rawTableHtml: '', jigenText: '', capturedAt: '2026-04-10T00:00:00Z' })
    await saveTimetableCapture(2026, 'kouki', { rawTableHtml: '', jigenText: '', capturedAt: '2026-10-01T00:00:00Z' })
    const list = await listCapturedSemesters(2026)
    expect(list.map((c) => c.semester).sort()).toEqual(['kouki', 'zenki'])
  })
  it('オーバーライドを保存・取得できる', async () => {
    await setOverride(2026, 'zenki', '9973337', { room: '別教室' })
    expect((await getOverride(2026, 'zenki', '9973337'))?.room).toBe('別教室')
    expect(await getOverride(2026, 'zenki', '0000000')).toBeNull()
  })
  it('表示選択を保存・取得できる', async () => {
    await setPreferredView(2026, 'kouki')
    expect(await getPreferredView()).toEqual({ year: 2026, semester: 'kouki' })
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/core/timetableStore.test.ts`
Expected: FAIL（`timetableStore` 未定義）

- [ ] **Step 3: 最小実装**

`src/core/timetableStore.ts` を作成:

```ts
import type { Semester, TimetableOverride, SemesterCapture } from './timetableLink'

export type TimetableCapture = { rawTableHtml: string; jigenText: string; capturedAt: string }

const VIEW_KEY = 'timetableView'
const timetableKey = (year: number, semester: Semester) => `timetable:${year}:${semester}`
const overrideKey = (year: number, semester: Semester, courseCode: string) =>
  `timetableOverrides:${year}:${semester}:${courseCode}`

export async function saveTimetableCapture(year: number, semester: Semester, cap: TimetableCapture): Promise<void> {
  await chrome.storage.local.set({ [timetableKey(year, semester)]: cap })
}

export async function getTimetableCapture(year: number, semester: Semester): Promise<TimetableCapture | null> {
  const key = timetableKey(year, semester)
  const res = (await chrome.storage.local.get(key)) as Record<string, TimetableCapture | undefined>
  return res[key] ?? null
}

export async function listCapturedSemesters(year: number): Promise<SemesterCapture[]> {
  const out: SemesterCapture[] = []
  for (const semester of ['zenki', 'kouki'] as const) {
    const cap = await getTimetableCapture(year, semester)
    if (cap) out.push({ semester, capturedAt: cap.capturedAt })
  }
  return out
}

export async function getOverride(year: number, semester: Semester, courseCode: string): Promise<TimetableOverride | null> {
  const key = overrideKey(year, semester, courseCode)
  const res = (await chrome.storage.local.get(key)) as Record<string, TimetableOverride | undefined>
  return res[key] ?? null
}

export async function setOverride(year: number, semester: Semester, courseCode: string, ov: TimetableOverride): Promise<void> {
  await chrome.storage.local.set({ [overrideKey(year, semester, courseCode)]: ov })
}

export async function getPreferredView(): Promise<{ year: number; semester: Semester } | null> {
  const res = (await chrome.storage.local.get(VIEW_KEY)) as Record<string, { year: number; semester: Semester } | undefined>
  return res[VIEW_KEY] ?? null
}

export async function setPreferredView(year: number, semester: Semester): Promise<void> {
  await chrome.storage.local.set({ [VIEW_KEY]: { year, semester } })
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/core/timetableStore.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/timetableStore.ts src/core/timetableStore.test.ts
git commit -m "feat(ext): add timetable storage layer (captures, overrides, view)"
```

---

### Task 4: content script＋manifest＋vite

**Files:**
- Create: `src/content/classTimetable.ts`
- Modify: `public/manifest.json`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: なし（`timetableStore` も `node-html-parser` も import しない。`chrome.storage.local` を直書き）。
- Produces: `chrome.storage.local` の `timetable:{year}:{semester}` キー（`{ rawTableHtml, jigenText, capturedAt }`）。
- 注: DOM抽出・`MutationObserver`は自動テスト対象外（実CLASS DOMで検証）。本タスクの機械検証は `pnpm build` 成功と `dist/classTimetable.js` 生成。

- [ ] **Step 1: content script を作成**

`src/content/classTimetable.ts` を作成:

```ts
// CLASS学生時間割表(Kmd008)を passive に取り込む dumb grabber。
// パースはしない（node-html-parserを含めない）。timetableStoreも import しない
// （Rollup共有チャンク化で import 文が出力され classic content script が壊れるのを避ける）。

console.log('[LETUS Task Watcher] CLASS timetable content script loaded')

function detectSemester(): 'zenki' | 'kouki' | null {
  const sel = document.querySelector<HTMLSelectElement>('select[name*="gakki"], select[id*="gakki"]')
  if (sel) {
    if (sel.value === '1') return 'zenki'
    if (sel.value === '2') return 'kouki'
    const text = sel.selectedOptions[0]?.textContent ?? ''
    if (text.includes('前期')) return 'zenki'
    if (text.includes('後期')) return 'kouki'
  }
  const body = document.body.textContent ?? ''
  if (body.includes('後期')) return 'kouki'
  if (body.includes('前期')) return 'zenki'
  return null
}

function detectYear(): number {
  const m = (document.body.textContent ?? '').match(/(20\d{2})\s*年度/)
  if (m) return Number(m[1])
  const now = new Date()
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
}

function findJigenText(): string {
  const el = Array.from(document.querySelectorAll('*')).find(
    (e) => /\d+\s*限\s*\d{1,2}:\d{2}/.test(e.textContent ?? '') && e.children.length === 0,
  )
  return el?.textContent?.trim() ?? ''
}

function showToast(message: string): void {
  const div = document.createElement('div')
  div.textContent = message
  div.style.cssText =
    'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#1d9e75;color:#fff;' +
    'padding:10px 16px;border-radius:8px;font-size:13px;font-family:sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2)'
  document.body.appendChild(div)
  setTimeout(() => div.remove(), 3000)
}

let lastHtml = ''

function capture(): void {
  const table = document.querySelector('table.classTable')
  if (!table) return
  const html = table.outerHTML
  if (html === lastHtml) return
  const semester = detectSemester()
  if (!semester) return
  lastHtml = html

  const year = detectYear()
  const key = `timetable:${year}:${semester}`
  const value = { rawTableHtml: html, jigenText: findJigenText(), capturedAt: new Date().toISOString() }
  void chrome.storage.local.set({ [key]: value }).then(() => {
    showToast('時間割を取り込みました')
  })
}

const observer = new MutationObserver(() => capture())
observer.observe(document.documentElement, { childList: true, subtree: true })
capture()
```

- [ ] **Step 2: `manifest.json` に権限とcontent script を追加**

`public/manifest.json` の `host_permissions` を次に置き換える:

```json
  "host_permissions": [
    "https://letus.ed.tus.ac.jp/*",
    "https://class.admin.tus.ac.jp/*",
    "https://api.waiteu.dev/*"
  ],
```

`content_scripts` を次に置き換える:

```json
  "content_scripts": [
    {
      "matches": ["https://letus.ed.tus.ac.jp/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://class.admin.tus.ac.jp/*"],
      "js": ["classTimetable.js"],
      "run_at": "document_idle"
    }
  ],
```

- [ ] **Step 3: `vite.config.ts` にエントリを追加**

`rollupOptions.input` に次を追加（`content` 行の直後）:

```ts
        classTimetable: resolve(__dirname, 'src/content/classTimetable.ts'),
```

`entryFileNames` を次に置き換える（`content` の分岐の直後に `classTimetable` を追加）:

```ts
        entryFileNames: (chunk) => {
          if (chunk.name === 'background') return 'background.js'
          if (chunk.name === 'content') return 'content.js'
          if (chunk.name === 'classTimetable') return 'classTimetable.js'
          return 'assets/[name]-[hash].js'
        },
```

- [ ] **Step 4: ビルドで生成を確認**

Run: `pnpm build`
Expected: 成功し、`dist/classTimetable.js` が生成される。`grep -c "import " dist/classTimetable.js` が 0（classic script として import 文が残っていない）。

Run: `pnpm exec tsc -b`
Expected: エラーなし

- [ ] **Step 5: 手動確認手順を残す（実CLASS DOM）**

以下を WORKLOG に手順として残し、ユーザー環境での確認事項とする（この場でのSSO操作はしない）:
- `dist/` を拡張として再読込 → CLASSにログイン → 履修→学生時間割表(`Kmd008`)を開く → トースト「時間割を取り込みました」が出る → DevToolsで `chrome.storage.local.get(null)` に `timetable:{年度}:{学期}` が入る。

- [ ] **Step 6: コミット**

```bash
git add src/content/classTimetable.ts public/manifest.json vite.config.ts
git commit -m "feat(ext): collect CLASS timetable via passive content script"
```

---

### Task 5: 時間割グリッド `TimetableSection`

**Files:**
- Create: `src/components/TimetableSection.tsx`
- Modify: `src/App.tsx`（配置）
- Modify: `src/App.css`（グリッドCSS）

**Interfaces:**
- Consumes: `courses: Course[]`, `assignments: Assignment[]`（App.tsx の state）。`parseTimetable`（`../core/timetable`）、`getTimetableCapture`, `listCapturedSemesters`, `getPreferredView`, `setPreferredView`, `getOverride`, `setOverride`（`../core/timetableStore`）、`resolveSemester`, `applyOverrides`, `linkAssignmentsToSlots`, `extractCourseCodes`（`../core/timetableLink`）、`buildSyllabusUrl`, `academicYear`（`../core/syllabus`）。
- Produces: `<TimetableSection courses={courses} assignments={assignments} />`。

- [ ] **Step 1: コンポーネントを作成**

`src/components/TimetableSection.tsx` を作成:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { Course, Assignment } from '../core/types'
import type { DayOfWeek, TimetableSlot } from '../core/timetable'
import { parseTimetable } from '../core/timetable'
import { getTimetableCapture, listCapturedSemesters, getPreferredView, setPreferredView, getOverride, setOverride } from '../core/timetableStore'
import type { Semester } from '../core/timetableLink'
import { resolveSemester, applyOverrides, linkAssignmentsToSlots, extractCourseCodes } from '../core/timetableLink'
import { buildSyllabusUrl, academicYear } from '../core/syllabus'

const DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri']
const DAY_LABELS: Record<DayOfWeek, string> = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土' }
const JS_DAY_TO_DOW: Record<number, DayOfWeek | undefined> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri' }
const PERIODS = [1, 2, 3, 4, 5, 6, 7]

export function TimetableSection({ courses, assignments }: { courses: Course[]; assignments: Assignment[] }) {
  const now = new Date()
  const year = academicYear(now)
  const [semester, setSemester] = useState<Semester | null>(null)
  const [captured, setCaptured] = useState<Semester[]>([])
  const [rawHtml, setRawHtml] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, { room?: string }>>({})
  const [open, setOpen] = useState(true)

  useEffect(() => {
    void (async () => {
      const list = await listCapturedSemesters(year)
      setCaptured(list.map((c) => c.semester))
      const pref = await getPreferredView()
      const initial = pref?.semester ?? resolveSemester(now, list)
      setSemester(initial)
    })()
  }, [year])

  useEffect(() => {
    if (!semester) return
    void (async () => {
      const cap = await getTimetableCapture(year, semester)
      setRawHtml(cap?.rawTableHtml ?? null)
      const codes = new Set(courses.flatMap((c) => extractCourseCodes(c.name)))
      const ov: Record<string, { room?: string }> = {}
      for (const code of codes) {
        const o = await getOverride(year, semester, code)
        if (o) ov[code] = o
      }
      setOverrides(ov)
    })()
  }, [semester, year, courses])

  const slots: TimetableSlot[] = useMemo(() => {
    if (!rawHtml) return []
    return applyOverrides(parseTimetable(rawHtml), overrides)
  }, [rawHtml, overrides])

  const { courseCodeCounts } = useMemo(
    () => linkAssignmentsToSlots(slots, courses, assignments),
    [slots, courses, assignments],
  )

  const grid = useMemo(() => {
    const m = new Map<string, TimetableSlot['classes'][number]>()
    for (const s of slots) for (const c of s.classes) m.set(`${s.day}:${s.period}`, c)
    return m
  }, [slots])

  const todayDow = JS_DAY_TO_DOW[now.getDay()]

  async function chooseSemester(s: Semester) {
    setSemester(s)
    await setPreferredView(year, s)
  }

  async function editRoom(courseCode: string, current: string) {
    if (!semester) return
    const next = window.prompt('教室を編集', current)
    if (next === null) return
    await setOverride(year, semester, courseCode, { room: next })
    setOverrides((prev) => ({ ...prev, [courseCode]: { room: next } }))
  }

  const maxPeriod = slots.reduce((max, s) => Math.max(max, s.period), 5)
  const rows = PERIODS.filter((p) => p <= Math.max(5, maxPeriod))

  return (
    <section className="timetableSection">
      <div className="timetableHeader">
        <button type="button" className="timetableToggle" onClick={() => setOpen((v) => !v)}>
          時間割 <span className="timetableYear">{year} {semester === 'kouki' ? '後期' : '前期'}</span>
          <span>{open ? '▲' : '▼'}</span>
        </button>
        <div className="semesterToggle">
          {(['zenki', 'kouki'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`semesterBtn ${semester === s ? 'active' : ''}`}
              disabled={!captured.includes(s)}
              onClick={() => void chooseSemester(s)}
            >
              {s === 'zenki' ? '前期' : '後期'}
            </button>
          ))}
        </div>
      </div>

      {open && (
        rawHtml === null ? (
          <p className="timetableEmpty">
            CLASSの「履修 → 学生時間割表」を開くと、この学期の時間割を自動で取り込みます。
          </p>
        ) : slots.length === 0 ? (
          <p className="timetableEmpty">時間割を読み取れませんでした。ページを再読込して再度お試しください。</p>
        ) : (
          <div className="timetableGrid" style={{ gridTemplateColumns: `28px repeat(${DAYS.length}, 1fr)` }}>
            <div />
            {DAYS.map((d) => (
              <div key={d} className={`timetableDayHead ${d === todayDow ? 'today' : ''}`}>{DAY_LABELS[d]}</div>
            ))}
            {rows.map((period) => (
              <div key={`row-${period}`} style={{ display: 'contents' }}>
                <div className="timetablePeriodHead">{period}</div>
                {DAYS.map((d) => {
                  const c = grid.get(`${d}:${period}`)
                  if (!c) return <div key={`${d}:${period}`} className={`timetableCell empty ${d === todayDow ? 'today' : ''}`} />
                  const count = courseCodeCounts[c.courseCode] ?? 0
                  return (
                    <div key={`${d}:${period}`} className={`timetableCell ${d === todayDow ? 'today' : ''}`}>
                      <div className="timetableCellName">{c.name}</div>
                      <div className="timetableCellRoom">{c.room}</div>
                      <div className="timetableCellMeta">
                        {count > 0 && <span className="timetableCount">課題{count}</span>}
                        {c.courseCode && (
                          <a className="timetableSyllabus" href={buildSyllabusUrl(c.courseCode, now)} target="_blank" rel="noreferrer" title="シラバス">📖</a>
                        )}
                        <button type="button" className="timetableEditRoom" title="教室を編集" onClick={() => void editRoom(c.courseCode, c.room)}>✎</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )
      )}
    </section>
  )
}
```

- [ ] **Step 2: `App.tsx` に配置する**

`src/App.tsx` の import 群に追加:

```tsx
import { TimetableSection } from './components/TimetableSection'
```

ダッシュボードのサマリ直後に配置する。挿入位置を特定:

Run: `grep -n "miniSummary dashboardSummary" src/App.tsx`

その `<section className="miniSummary dashboardSummary"> … </section>` の**閉じ** `</section>`（行 1237 付近）の直後に次を挿入:

```tsx
          <TimetableSection courses={courses} assignments={assignments} />
```

- [ ] **Step 3: CSS を追加する**

`src/App.css` の末尾に追加:

```css
.timetableSection { margin-bottom: 16px; }
.timetableHeader { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.timetableToggle { display: flex; align-items: center; gap: 8px; background: none; border: none; font-size: 15px; font-weight: 700; color: #1e293b; cursor: pointer; padding: 0; }
.timetableYear { font-size: 12px; font-weight: 500; color: #94a3b8; }
.semesterToggle { display: flex; border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; }
.semesterBtn { border: none; padding: 4px 10px; font-size: 12px; background: #fff; color: #475569; cursor: pointer; }
.semesterBtn.active { background: #e0edff; color: #1d4ed8; }
.semesterBtn:disabled { color: #cbd5e1; cursor: default; }
.timetableGrid { display: grid; gap: 4px; }
.timetableDayHead { text-align: center; font-size: 12px; color: #64748b; padding-bottom: 2px; }
.timetableDayHead.today { color: #1d4ed8; font-weight: 700; }
.timetablePeriodHead { display: flex; align-items: center; justify-content: center; font-size: 12px; color: #94a3b8; }
.timetableCell { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px; min-height: 56px; }
.timetableCell.empty { background: #f8fafc; border-color: transparent; }
.timetableCell.today { border-color: #bfdbfe; }
.timetableCellName { font-size: 12px; font-weight: 500; line-height: 1.3; }
.timetableCellRoom { font-size: 11px; color: #64748b; margin-top: 2px; }
.timetableCellMeta { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.timetableCount { font-size: 10px; background: #fee2e2; color: #b91c1c; border-radius: 20px; padding: 1px 6px; }
.timetableSyllabus { font-size: 13px; text-decoration: none; }
.timetableEditRoom { background: none; border: none; font-size: 12px; color: #94a3b8; cursor: pointer; padding: 0; }
.timetableEmpty { font-size: 13px; color: #64748b; padding: 12px; background: #f8fafc; border-radius: 8px; }
```

- [ ] **Step 4: 型チェック・ビルド**

Run: `pnpm exec tsc -b`
Expected: エラーなし

Run: `pnpm build`
Expected: 成功

Run: `pnpm exec vitest run src`
Expected: PASS（既存＋新規テストが緑）

- [ ] **Step 5: コミット**

```bash
git add src/components/TimetableSection.tsx src/App.tsx src/App.css
git commit -m "feat(ext): render CLASS timetable grid section in dashboard"
```

---

### Task 6: 課題カードに教室・時限・シラバスのチップ

**Files:**
- Modify: `src/App.tsx`（突合マップ算出＋タイムライン項目へチップ）
- Modify: `src/App.css`（チップCSS）

**Interfaces:**
- Consumes: `linkAssignmentsToSlots`（`./core/timetableLink`）、`parseTimetable`（`./core/timetable`）、`getTimetableCapture`, `getPreferredView`（`./core/timetableStore`）、`buildSyllabusUrl`（`./core/syllabus`）、`resolveSemester`, `listCapturedSemesters`（`./core/timetableLink`/`timetableStore`）。
- Produces: 各課題カードに `assignmentInfo[assignment.id]` があればチップ表示。

- [ ] **Step 1: App.tsx で突合マップを算出する**

`src/App.tsx` の import に追加:

```tsx
import { getTimetableCapture, getPreferredView, listCapturedSemesters } from './core/timetableStore'
import { linkAssignmentsToSlots, resolveSemester, type AssignmentSlotInfo } from './core/timetableLink'
import { parseTimetable } from './core/timetable'
import { buildSyllabusUrl, academicYear } from './core/syllabus'
```

（既に一部 import 済みなら重複させない。）

state を追加（他の `useState` 群の近く、行 132 付近）:

```tsx
  const [assignmentSlotMap, setAssignmentSlotMap] = useState<Record<string, AssignmentSlotInfo>>({})
```

`useEffect` を追加（コンポーネント内、`refreshAll` の呼び出し群の近く）:

```tsx
  useEffect(() => {
    void (async () => {
      const now = new Date()
      const year = academicYear(now)
      const pref = await getPreferredView()
      const semester = pref?.semester ?? resolveSemester(now, await listCapturedSemesters(year))
      const cap = await getTimetableCapture(year, semester)
      if (!cap) { setAssignmentSlotMap({}); return }
      const slots = parseTimetable(cap.rawTableHtml)
      const { assignmentInfo } = linkAssignmentsToSlots(slots, courses, assignments)
      setAssignmentSlotMap(assignmentInfo)
    })()
  }, [courses, assignments])
```

- [ ] **Step 2: タイムライン項目にチップを渡す**

課題カードの描画箇所を特定:

Run: `grep -n "AssignmentMemo assignmentId={item.assignment.id}" src/App.tsx`

各 `AssignmentMemo` の描画に隣接する課題メタ表示の直後に、次のチップ群を挿入する（`item.assignment.id` が項目の課題IDである前提。異なる変数名なら合わせる）:

```tsx
                    {assignmentSlotMap[item.assignment.id] && (
                      <div className="assignmentSlotChips">
                        <span className="slotChip slotChipDay">
                          {DAY_LABEL_SHORT[assignmentSlotMap[item.assignment.id].day]}{assignmentSlotMap[item.assignment.id].period}
                        </span>
                        <span className="slotChip">{assignmentSlotMap[item.assignment.id].room}</span>
                        <a className="slotChip slotChipLink" href={buildSyllabusUrl(assignmentSlotMap[item.assignment.id].courseCode, new Date())} target="_blank" rel="noreferrer">シラバス</a>
                      </div>
                    )}
```

`DAY_LABEL_SHORT` 定数をファイル上部（他の定数付近）に追加:

```tsx
const DAY_LABEL_SHORT: Record<'mon'|'tue'|'wed'|'thu'|'fri'|'sat', string> = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土' }
```

- [ ] **Step 3: CSS を追加する**

`src/App.css` の末尾に追加:

```css
.assignmentSlotChips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.slotChip { font-size: 11px; background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; border-radius: 20px; padding: 2px 8px; }
.slotChipDay { background: #e0edff; color: #1d4ed8; border-color: #bfdbfe; }
.slotChipLink { text-decoration: none; color: #1d4ed8; }
```

- [ ] **Step 4: 型チェック・ビルド・テスト**

Run: `pnpm exec tsc -b`
Expected: エラーなし

Run: `pnpm build`
Expected: 成功

Run: `pnpm exec vitest run src`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/App.tsx src/App.css
git commit -m "feat(ext): show room/period/syllabus chips on linked assignment cards"
```

---

### Task 7: ドキュメント整合＋TASKS/WORKLOG更新

**Files:**
- Modify: `TASKS.md`
- Modify: `WORKLOG.md`

- [ ] **Step 1: TASKS.md を更新**

`TASKS.md` の No.2「CLASS時間割 収集＋グリッド表示」の残チェックボックス（`host_permissions`・Content Script・グリッド表示・収集範囲限定）を `[x]` にし、「科目連携」項目も `[x]` にする。シラバス項目は URL生成のみ済みのまま（fetch/表示はNo.3）。

- [ ] **Step 2: WORKLOG.md に実装記録を追記**

`WORKLOG.md` の先頭（`---` 直後）に、No.2実装の要点（passive-only収集・dumb grabber・専用セクション・突合チップ・実CLASS DOM手動確認手順）と検証結果（tsc/build/vitest）を追記する。逆流状態（timetableは移植時点でlitusと同一、新規`timetableLink`の突合ロジックは拡張発）も記す。

- [ ] **Step 3: コミット**

```bash
git add TASKS.md WORKLOG.md
git commit -m "docs: mark v1.2.0 No.2 CLASS timetable integration done"
```

---

## 完了条件

- Task 1〜7 の全チェックボックス完了。
- `pnpm exec tsc -b`・`pnpm build`・`pnpm exec vitest run src` 全緑。`dist/classTimetable.js` 生成・import文なし。
- 未取得時は空状態＋取込導線、取得後はグリッド表示、突合できた課題カードに教室・時限・シラバスのチップ。
- 教室はコマの鉛筆から編集でき再取得で消えない。
- バックエンド変更なし。実CLASS DOMでの疎通はユーザー環境で手動確認（Task 4 Step 5 の手順）。
