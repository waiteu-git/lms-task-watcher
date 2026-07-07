# シラバス埋め込み表示（No.3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLASSの静的シラバスHTMLを fetch・パースし、ダッシュボードのモーダルで整形表示する（導線=時間割コマ＋課題チップ、ポップアップは新規タブにフォールバック）。

**Architecture:** 純関数 `syllabusParse.ts`（`.rowStyle` 行のラベル→値抽出）＋ fetch/キャッシュ `syllabusStore.ts`（`chrome.storage.local`）＋ `SyllabusModal.tsx`（ダッシュボードのモーダル）。導線は `SyllabusContext`（openSyllabusコールバック）で供給し、context が無いポップアップでは従来の新規タブ動作にフォールバックする。

**Tech Stack:** React 19 + TypeScript + Vite、`node-html-parser`（アプリ側）、`chrome.storage.local`、`fetch`、vitest。

## Global Constraints

- 対象: `C:\dev\lms-task-watcher`（branch `develop`）。全タスクここで作業。
- 設計書: `docs/superpowers/specs/2026-07-07-v1.2.0-no3-syllabus-embed-design.md`。
- **manifest変更なし**（`host_permissions` の `class.admin.tus.ac.jp` は No.2 で追加済み）。バックエンド変更なし。
- ストレージキー: シラバス=`syllabus:{year}:{code}`（値 `{ doc, fetchedAt }`）。
- パース/fetchはアプリ側のみ（content scriptは無関係）。
- テストフィクスチャ: `src/core/syllabusFixtures/{9973344,9960192,9973365,9973139}.html`（取得済み、UTF-8）。
- vitestは `import { describe, it, expect } from 'vitest'` を明示（globals未設定）。
- 検証コマンド: `pnpm exec tsc -b`・`pnpm build`・`pnpm exec vitest run src`。
- コミットのフッタは `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

## File Structure

- Modify: `src/core/syllabus.ts` — `buildSyllabusUrlByYear` 追加、`buildSyllabusUrl` を薄いラッパ化。
- Create: `src/core/syllabusParse.ts` — 純関数パーサ（`japaneseLabel`・`parseSyllabus`）。
- Create: `src/core/syllabusParse.test.ts`。
- Create: `src/core/syllabusStore.ts` — fetch＋`chrome.storage.local` キャッシュ。
- Create: `src/core/syllabusStore.test.ts`。
- Create: `src/core/syllabusContext.ts` — `SyllabusContext`（openSyllabusコールバック）。
- Create: `src/components/SyllabusModal.tsx` — モーダル。
- Modify: `src/App.tsx` — モーダル状態＋Provider＋描画。
- Modify: `src/components/AssignmentCard.tsx` — シラバスチップを context 有無で分岐。
- Modify: `src/components/TimetableSection.tsx` — 📖 を context 有無で分岐。
- Modify: `src/App.css` — モーダル/セクションのCSS。

---

### Task 1: `buildSyllabusUrlByYear`（年度直接指定のURL生成）

**Files:**
- Modify: `src/core/syllabus.ts`
- Test: `src/core/syllabus.test.ts`

**Interfaces:**
- Produces: `buildSyllabusUrlByYear(courseCode: string, year: number): string`。既存 `buildSyllabusUrl(courseCode, now)` は挙動不変（`academicYear(now)` で本関数に委譲）。

- [ ] **Step 1: 失敗するテストを追記**

`src/core/syllabus.test.ts` の末尾に追記（既存の import 群に `buildSyllabusUrlByYear` を足す）:

```ts
import { buildSyllabusUrlByYear } from './syllabus'

describe('buildSyllabusUrlByYear', () => {
  it('年度を直接指定してURLを生成する', () => {
    expect(buildSyllabusUrlByYear('9973344', 2026)).toBe(
      'https://class.admin.tus.ac.jp/slResult/2026/japanese/syllabusHtml/SyllabusHtml.2026.9973344.html',
    )
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/core/syllabus.test.ts`
Expected: FAIL（`buildSyllabusUrlByYear` 未定義）

- [ ] **Step 3: 実装**

`src/core/syllabus.ts` を次に置き換える:

```ts
/** CLASSシラバス（静的HTML）のURLを科目コード＋年度から生成する。収集不要・直リンク可。 */

/** 日本の学年暦。ローカル月が4月(index 3)以降なら当年、1〜3月は前年。 */
export function academicYear(now: Date): number {
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
}

export function buildSyllabusUrlByYear(courseCode: string, year: number): string {
  return `https://class.admin.tus.ac.jp/slResult/${year}/japanese/syllabusHtml/SyllabusHtml.${year}.${courseCode}.html`
}

export function buildSyllabusUrl(courseCode: string, now: Date): string {
  return buildSyllabusUrlByYear(courseCode, academicYear(now))
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/core/syllabus.test.ts`
Expected: PASS（既存＋新規）

- [ ] **Step 5: コミット**

```bash
git add src/core/syllabus.ts src/core/syllabus.test.ts
git commit -m "feat(ext): add buildSyllabusUrlByYear (year-explicit syllabus URL)"
```

---

### Task 2: シラバスパーサ `syllabusParse.ts`

**Files:**
- Create: `src/core/syllabusParse.ts`
- Test: `src/core/syllabusParse.test.ts`

**Interfaces:**
- Produces:
  - `type SyllabusSection = { label: string; value: string }`
  - `type SyllabusDoc = { code: string; titleJa: string; titleEn: string; sections: SyllabusSection[] }`
  - `japaneseLabel(raw: string): string`
  - `parseSyllabus(html: string): SyllabusDoc`

- [ ] **Step 1: 失敗するテストを書く**

`src/core/syllabusParse.test.ts` を作成:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseSyllabus, japaneseLabel, type SyllabusDoc } from './syllabusParse'

function fixture(code: string): string {
  return readFileSync(resolve(__dirname, `syllabusFixtures/${code}.html`), 'utf-8')
}
function sectionValue(doc: SyllabusDoc, label: string): string | null {
  return doc.sections.find((s) => s.label === label)?.value ?? null
}

describe('japaneseLabel', () => {
  it('日英併記から日本語部分を取り出す', () => {
    expect(japaneseLabel('概要 Description')).toBe('概要')
    expect(japaneseLabel('教科書の使用有無（有=Y , 無=N） Textbook used(Y for yes, N for no)')).toBe(
      '教科書の使用有無（有=Y , 無=N）',
    )
  })
  it('日本語が無ければ原文を返す', () => {
    expect(japaneseLabel('Instructor')).toBe('Instructor')
  })
})

describe('parseSyllabus', () => {
  it('授業コードとタイトル（和文/英文）を取り出す', () => {
    const d = parseSyllabus(fixture('9973344'))
    expect(d.code).toBe('9973344')
    expect(d.titleJa).toBe('物理学実験Ａ')
    expect(d.titleEn).toBe('Experiments in PhysicsA')
  })
  it('別科目でもコード・和文タイトルを取り出す', () => {
    const d = parseSyllabus(fixture('9973365'))
    expect(d.code).toBe('9973365')
    expect(d.titleJa).toBe('基礎電気工学')
  })
  it('主要セクションが値付きで得られる', () => {
    const d = parseSyllabus(fixture('9973344'))
    expect(d.sections.length).toBeGreaterThanOrEqual(20)
    expect(sectionValue(d, '概要')).toContain('物理学実験')
    expect(sectionValue(d, '成績評価方法')).toContain('平常点')
    expect(sectionValue(d, '曜日時限')).toContain('火曜4限')
  })
  it('構造が壊れたHTMLでも例外を投げず空docを返す', () => {
    const d = parseSyllabus('<html><body>no rows</body></html>')
    expect(d.sections).toEqual([])
    expect(d.code).toBe('')
    expect(d.titleJa).toBe('')
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/core/syllabusParse.test.ts`
Expected: FAIL（`syllabusParse` 未定義）

- [ ] **Step 3: 実装**

`src/core/syllabusParse.ts` を作成:

```ts
import { parse, type HTMLElement } from 'node-html-parser'

export type SyllabusSection = { label: string; value: string }
export type SyllabusDoc = {
  code: string
  titleJa: string
  titleEn: string
  sections: SyllabusSection[]
}

// ひらがな・カタカナ・漢字・全角記号（全角括弧等）の範囲。
const JP_RANGE = '　-〿぀-ヿ一-鿿＀-￯'
const LABEL_JP_RE = new RegExp(`^.*[${JP_RANGE}]`)

/** 日英併記ラベルから日本語部分（末尾の日本語文字まで）を取り出す。日本語が無ければ原文。 */
export function japaneseLabel(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  const m = t.match(LABEL_JP_RE)
  return m ? m[0].trim() : t
}

function valueCells(row: HTMLElement): HTMLElement[] {
  return row.querySelectorAll('.colStyle').filter((c: HTMLElement) => !c.classList.contains('colHeader'))
}

/** 値セル群のテキスト。<br>は改行に、各行はトリムして空行を除き、複数セルは改行連結。 */
function cellsText(cells: HTMLElement[]): string {
  const parts: string[] = []
  for (const cell of cells) {
    const withBreaks = cell.innerHTML.replace(/<br\s*\/?>/gi, '\n')
    const text = parse(`<x>${withBreaks}</x>`).text.replace(/ /g, ' ')
    const lines = text.split('\n').map((s) => s.trim()).filter((s) => s.length > 0)
    if (lines.length > 0) parts.push(lines.join('\n'))
  }
  return parts.join('\n')
}

export function parseSyllabus(html: string): SyllabusDoc {
  const root = parse(html)
  const rows = root.querySelectorAll('.rowStyle')

  const sections: SyllabusSection[] = []
  for (const row of rows) {
    const header = row.querySelector('.colHeader')
    if (!header) continue
    const label = japaneseLabel(header.text)
    const value = cellsText(valueCells(row))
    if (!label && !value) continue
    sections.push({ label, value })
  }

  const firstValue = (jpPrefix: string): string => {
    for (const row of rows) {
      const header = row.querySelector('.colHeader')
      if (!header) continue
      if (header.text.replace(/\s+/g, ' ').trim().startsWith(jpPrefix)) {
        return valueCells(row)[0]?.text.replace(/\s+/g, ' ').trim() ?? ''
      }
    }
    return ''
  }

  return {
    code: firstValue('授業コード'),
    titleJa: firstValue('科目授業名称（和文）'),
    titleEn: firstValue('科目授業名称（英文）'),
    sections,
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/core/syllabusParse.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/syllabusParse.ts src/core/syllabusParse.test.ts
git commit -m "feat(ext): add CLASS syllabus HTML parser (label/value sections)"
```

---

### Task 3: fetch＋キャッシュ `syllabusStore.ts`

**Files:**
- Create: `src/core/syllabusStore.ts`
- Test: `src/core/syllabusStore.test.ts`

**Interfaces:**
- Consumes: `parseSyllabus`, `SyllabusDoc`（`./syllabusParse`）、`buildSyllabusUrlByYear`（`./syllabus`）。
- Produces:
  - `type SyllabusCache = { doc: SyllabusDoc; fetchedAt: string }`
  - `getCachedSyllabus(year: number, code: string): Promise<SyllabusCache | null>`
  - `fetchAndCacheSyllabus(year: number, code: string): Promise<SyllabusCache>`

- [ ] **Step 1: 失敗するテストを書く**

`src/core/syllabusStore.test.ts` を作成:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCachedSyllabus, fetchAndCacheSyllabus } from './syllabusStore'

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

describe('syllabusStore', () => {
  it('キャッシュミス時は null', async () => {
    expect(await getCachedSyllabus(2026, '9973344')).toBeNull()
  })
  it('fetch してパース・キャッシュし、以後キャッシュから読める', async () => {
    const html =
      '<div class="rowStyle"><div class="colHeader colStyle">授業コード Class code</div><div class="colStyle">9973344</div></div>'
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(html) })))
    const c = await fetchAndCacheSyllabus(2026, '9973344')
    expect(c.doc.code).toBe('9973344')
    expect(c.fetchedAt).toMatch(/^\d{4}-/)
    expect((await getCachedSyllabus(2026, '9973344'))?.doc.code).toBe('9973344')
  })
  it('非200レスポンスは例外を投げる', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') })))
    await expect(fetchAndCacheSyllabus(2026, '0000000')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm exec vitest run src/core/syllabusStore.test.ts`
Expected: FAIL（`syllabusStore` 未定義）

- [ ] **Step 3: 実装**

`src/core/syllabusStore.ts` を作成:

```ts
import { parseSyllabus, type SyllabusDoc } from './syllabusParse'
import { buildSyllabusUrlByYear } from './syllabus'

export type SyllabusCache = { doc: SyllabusDoc; fetchedAt: string }

const syllabusKey = (year: number, code: string) => `syllabus:${year}:${code}`

export async function getCachedSyllabus(year: number, code: string): Promise<SyllabusCache | null> {
  const key = syllabusKey(year, code)
  const res = (await chrome.storage.local.get(key)) as Record<string, SyllabusCache | undefined>
  return res[key] ?? null
}

export async function fetchAndCacheSyllabus(year: number, code: string): Promise<SyllabusCache> {
  const res = await fetch(buildSyllabusUrlByYear(code, year))
  if (!res.ok) throw new Error(`syllabus fetch failed: ${res.status}`)
  const html = await res.text()
  const cache: SyllabusCache = { doc: parseSyllabus(html), fetchedAt: new Date().toISOString() }
  await chrome.storage.local.set({ [syllabusKey(year, code)]: cache })
  return cache
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm exec vitest run src/core/syllabusStore.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/syllabusStore.ts src/core/syllabusStore.test.ts
git commit -m "feat(ext): add syllabus fetch + local cache store"
```

---

### Task 4: `SyllabusContext` ＋ `SyllabusModal`

**Files:**
- Create: `src/core/syllabusContext.ts`
- Create: `src/components/SyllabusModal.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `getCachedSyllabus`, `fetchAndCacheSyllabus`, `SyllabusCache`（`../core/syllabusStore`）、`buildSyllabusUrlByYear`（`../core/syllabus`）。
- Produces:
  - `type OpenSyllabus = (year: number, code: string, courseName: string) => void`
  - `SyllabusContext`（`React.Context<OpenSyllabus | null>`）
  - `<SyllabusModal year={} code={} courseName={} onClose={} />`
- 注: `SyllabusModal` の描画は自動テスト対象外（実fetch要）。本タスクの機械検証は `pnpm build` 成功と `pnpm exec tsc -b`。

- [ ] **Step 1: `syllabusContext.ts` を作成**

```ts
import { createContext } from 'react'

/** ダッシュボードでシラバスモーダルを開くコールバック。ポップアップでは null（新規タブ動作にフォールバック）。 */
export type OpenSyllabus = (year: number, code: string, courseName: string) => void
export const SyllabusContext = createContext<OpenSyllabus | null>(null)
```

- [ ] **Step 2: `SyllabusModal.tsx` を作成**

```tsx
import { useEffect, useState } from 'react'
import { getCachedSyllabus, fetchAndCacheSyllabus, type SyllabusCache } from '../core/syllabusStore'
import { buildSyllabusUrlByYear } from '../core/syllabus'

export function SyllabusModal({
  year,
  code,
  courseName,
  onClose,
}: {
  year: number
  code: string
  courseName: string
  onClose: () => void
}) {
  const [state, setState] = useState<'loading' | 'error' | 'loaded'>('loading')
  const [cache, setCache] = useState<SyllabusCache | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    void (async () => {
      try {
        const c = (await getCachedSyllabus(year, code)) ?? (await fetchAndCacheSyllabus(year, code))
        if (cancelled) return
        setCache(c)
        setState('loaded')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true }
  }, [year, code])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function refresh() {
    setState('loading')
    try {
      setCache(await fetchAndCacheSyllabus(year, code))
      setState('loaded')
    } catch {
      setState('error')
    }
  }

  const url = buildSyllabusUrlByYear(code, year)

  return (
    <div className="syllabusOverlay" onClick={onClose}>
      <div className="syllabusModal" onClick={(e) => e.stopPropagation()}>
        <div className="syllabusModalHead">
          <div>
            <div className="syllabusModalTitle">{cache?.doc.titleJa || courseName}</div>
            {cache?.doc.titleEn && <div className="syllabusModalSub">{cache.doc.titleEn}</div>}
            <div className="syllabusModalCode">{code}</div>
          </div>
          <div className="syllabusModalActions">
            <button type="button" onClick={() => void refresh()} title="再取得">↻</button>
            <button type="button" onClick={onClose} title="閉じる">✕</button>
          </div>
        </div>

        {state === 'loading' && <p className="syllabusMsg">読み込み中…</p>}

        {state === 'error' && (
          <p className="syllabusMsg">
            シラバスを取得できませんでした。{' '}
            <button type="button" className="syllabusRetry" onClick={() => void refresh()}>再試行</button>{' '}
            <a href={url} target="_blank" rel="noreferrer">CLASSで開く</a>
          </p>
        )}

        {state === 'loaded' && cache && (
          cache.doc.sections.length === 0 ? (
            <p className="syllabusMsg">
              内容を読み取れませんでした。 <a href={url} target="_blank" rel="noreferrer">CLASSで開く</a>
            </p>
          ) : (
            <div className="syllabusBody">
              {cache.doc.sections.map((s, i) => (
                <section key={i} className="syllabusSection">
                  {s.label && <h3 className="syllabusLabel">{s.label}</h3>}
                  {s.value && <div className="syllabusValue">{s.value}</div>}
                </section>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: CSS を追加**

`src/App.css` の末尾に追加:

```css
.syllabusOverlay { position: fixed; inset: 0; background: rgba(15, 23, 42, .45); display: flex; align-items: flex-start; justify-content: center; padding: 40px 16px; z-index: 1000; overflow-y: auto; }
.syllabusModal { background: #fff; border-radius: 12px; max-width: 720px; width: 100%; box-shadow: 0 12px 32px rgba(0,0,0,.25); }
.syllabusModalHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid #e2e8f0; position: sticky; top: 0; background: #fff; border-radius: 12px 12px 0 0; }
.syllabusModalTitle { font-size: 16px; font-weight: 700; color: #1e293b; }
.syllabusModalSub { font-size: 12px; color: #64748b; margin-top: 2px; }
.syllabusModalCode { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.syllabusModalActions { display: flex; gap: 4px; }
.syllabusModalActions button { background: #f1f5f9; border: none; border-radius: 6px; width: 28px; height: 28px; font-size: 14px; cursor: pointer; color: #475569; }
.syllabusMsg { padding: 24px 20px; font-size: 13px; color: #64748b; }
.syllabusRetry { background: #e0edff; border: none; border-radius: 6px; padding: 2px 10px; color: #1d4ed8; cursor: pointer; }
.syllabusBody { padding: 8px 20px 20px; }
.syllabusSection { padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
.syllabusLabel { font-size: 13px; font-weight: 700; color: #1d4ed8; margin: 0 0 4px; }
.syllabusValue { font-size: 13px; color: #334155; line-height: 1.6; white-space: pre-wrap; }
```

- [ ] **Step 4: 型チェック・ビルド**

Run: `pnpm exec tsc -b`
Expected: エラーなし

Run: `pnpm build`
Expected: 成功

- [ ] **Step 5: コミット**

```bash
git add src/core/syllabusContext.ts src/components/SyllabusModal.tsx src/App.css
git commit -m "feat(ext): add syllabus modal and context"
```

---

### Task 5: 導線の配線（App Provider＋チップ/コマ分岐）

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AssignmentCard.tsx`
- Modify: `src/components/TimetableSection.tsx`

**Interfaces:**
- Consumes: `SyllabusContext`, `OpenSyllabus`（`./core/syllabusContext` / `../core/syllabusContext`）、`SyllabusModal`（`./components/SyllabusModal`）、`academicYear`（`./core/syllabus`、App.tsx は No.2 で import 済み）。
- Produces: ダッシュボードで `openSyllabus` を context 供給し、`syllabusTarget` があるとき `<SyllabusModal>` を描画。ポップアップは context=null。

- [ ] **Step 1: App.tsx にモーダル状態と Provider を追加**

`src/App.tsx` の import に追加:

```tsx
import { SyllabusContext, type OpenSyllabus } from './core/syllabusContext'
import { SyllabusModal } from './components/SyllabusModal'
```

`assignmentSlotMap` state の近くに state を追加:

```tsx
  const [syllabusTarget, setSyllabusTarget] = useState<{ year: number; code: string; name: string } | null>(null)
```

コンポーネント本体（return より前）に openSyllabus を定義:

```tsx
  const openSyllabus: OpenSyllabus = (year, code, name) => setSyllabusTarget({ year, code, name })
```

`return (` 直後の `<AssignmentSlotContext.Provider value={assignmentSlotMap}>` を `SyllabusContext.Provider` で内側にラップする。既存:

```tsx
    <AssignmentSlotContext.Provider value={assignmentSlotMap}>
    <main className={`app ${isDashboard ? 'dashboard' : 'popup'}`}>
```

を次に置き換える（ポップアップでは context=null にして新規タブ動作にフォールバック）:

```tsx
    <AssignmentSlotContext.Provider value={assignmentSlotMap}>
    <SyllabusContext.Provider value={isDashboard ? openSyllabus : null}>
    <main className={`app ${isDashboard ? 'dashboard' : 'popup'}`}>
```

閉じタグ側。既存:

```tsx
    </main>
    </AssignmentSlotContext.Provider>
  )
}
```

を次に置き換える（モーダルは main の外・Provider の内側に描画）:

```tsx
    </main>
    {syllabusTarget && (
      <SyllabusModal
        year={syllabusTarget.year}
        code={syllabusTarget.code}
        courseName={syllabusTarget.name}
        onClose={() => setSyllabusTarget(null)}
      />
    )}
    </SyllabusContext.Provider>
    </AssignmentSlotContext.Provider>
  )
}
```

- [ ] **Step 2: AssignmentCard のシラバスチップを context 有無で分岐**

`src/components/AssignmentCard.tsx` の import に追加:

```tsx
import { SyllabusContext } from '../core/syllabusContext'
import { academicYear } from '../core/syllabus'
```

`const slot = slotMap[assignment.id]` の直後に追加:

```tsx
  const openSyllabus = useContext(SyllabusContext)
```

（既存の `useContext` import はそのまま利用。）

チップ内の既存シラバスリンク:

```tsx
          <a
            className="slotChip slotChipLink"
            href={buildSyllabusUrl(slot.courseCode, new Date())}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            シラバス
          </a>
```

を次に置き換える（context があればモーダル、無ければ従来の新規タブ）:

```tsx
          {openSyllabus ? (
            <button
              type="button"
              className="slotChip slotChipLink"
              onClick={(e) => {
                e.stopPropagation()
                openSyllabus(academicYear(new Date()), slot.courseCode, assignment.courseName)
              }}
            >
              シラバス
            </button>
          ) : (
            <a
              className="slotChip slotChipLink"
              href={buildSyllabusUrl(slot.courseCode, new Date())}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              シラバス
            </a>
          )}
```

- [ ] **Step 3: TimetableSection の 📖 を context 有無で分岐**

`src/components/TimetableSection.tsx` の import に追加:

```tsx
import { useContext } from 'react'
import { SyllabusContext } from '../core/syllabusContext'
```

（既存の `import { useEffect, useMemo, useState } from 'react'` に `useContext` を足してもよい。重複importにしないこと。）

コンポーネント本体の先頭（`const now = new Date()` 付近）に追加:

```tsx
  const openSyllabus = useContext(SyllabusContext)
```

グリッドセル内の既存 📖 リンク:

```tsx
                        {c.courseCode && (
                          <a className="timetableSyllabus" href={buildSyllabusUrl(c.courseCode, now)} target="_blank" rel="noreferrer" title="シラバス">📖</a>
                        )}
```

を次に置き換える:

```tsx
                        {c.courseCode && (
                          openSyllabus ? (
                            <button
                              type="button"
                              className="timetableSyllabus"
                              title="シラバス"
                              onClick={() => openSyllabus(year, c.courseCode, c.name)}
                            >
                              📖
                            </button>
                          ) : (
                            <a className="timetableSyllabus" href={buildSyllabusUrl(c.courseCode, now)} target="_blank" rel="noreferrer" title="シラバス">📖</a>
                          )
                        )}
```

- [ ] **Step 4: 型チェック・ビルド・テスト**

Run: `pnpm exec tsc -b`
Expected: エラーなし

Run: `pnpm build`
Expected: 成功

Run: `pnpm exec vitest run src`
Expected: PASS（既存＋Task1〜3の新規が緑）

- [ ] **Step 5: コミット**

```bash
git add src/App.tsx src/components/AssignmentCard.tsx src/components/TimetableSection.tsx
git commit -m "feat(ext): wire syllabus modal from timetable cells and assignment chips"
```

---

### Task 6: ドキュメント整合＋TASKS/WORKLOG更新

**Files:**
- Modify: `TASKS.md`
- Modify: `WORKLOG.md`

- [ ] **Step 1: TASKS.md を更新**

`TASKS.md` の「シラバス埋め込み表示」項目の未完チェックボックス（`[ ] CLASS静的HTMLシラバス … fetch → パース → 拡張内に整形表示`）を `[x]` にし、`[~]` を `[x]` に変える。実装物（`syllabusParse.ts`・`syllabusStore.ts`・`SyllabusModal.tsx`・ダッシュボードモーダル・導線）を1行追記。

- [ ] **Step 2: WORKLOG.md に実装記録を追記**

`WORKLOG.md` の先頭（`---` 直後）に、No.3実装の要点（fetch＋無期限キャッシュ・汎用ラベル/値パーサ・ダッシュボードモーダル・ポップアップは新規タブフォールバック・実fetch手動確認手順）と検証結果（tsc/build/vitest）、逆流状態（syllabusParseは拡張発）を追記。

- [ ] **Step 3: コミット**

```bash
git add TASKS.md WORKLOG.md
git commit -m "docs: mark v1.2.0 No.3 syllabus embed display done"
```

---

## 完了条件

- Task 1〜6 の全チェックボックス完了。
- `pnpm exec tsc -b`・`pnpm build`・`pnpm exec vitest run src` 全緑。
- 時間割コマの 📖・課題チップの「シラバス」クリックでダッシュボードにモーダルが開き、整形表示される。取得失敗時は再試行＋CLASS外部リンク。
- ポップアップでは従来どおり新規タブでCLASSシラバスが開く。
- キャッシュ済みは再取得せず即表示、モーダルの再取得ボタンで更新できる。
- manifest・バックエンド変更なし。実fetchはユーザー環境で手動確認。
