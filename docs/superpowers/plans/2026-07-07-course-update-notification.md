# コース内容の更新通知（No.4）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コースページの `/mod/*/view.php` リンク集合をスナップショット差分で監視し、追加された教材/課題/アクティビティを Chrome 通知＋ダッシュボードの項目履歴で知らせる（既存スキャンのfetch済みHTMLを再利用、追加fetchなし）。

**Architecture:** 既存 `index.ts` のリンク抽出・テキストヘルパを共有モジュール（`htmlText.ts`・`letusLinks.ts`）へ抽出（挙動不変）。純関数 `courseUpdates.ts`（シグネチャ算出・差分・更新判定）＋ I/O `courseUpdatesStore.ts`。検知は `scanAssignmentCandidatesInBackground` にフックし、UIは `CourseUpdatesSection.tsx`。

**Tech Stack:** React 19 + TypeScript + Vite、`chrome.storage.local`、`chrome.notifications`、vitest。

## Global Constraints

- 対象: `C:\dev\lms-task-watcher`（branch `develop`）。全タスクここで作業。
- 設計書: `docs/superpowers/specs/2026-07-07-v1.2.0-no4-course-update-notification-design.md`。
- **manifest・バックエンド変更なし**。
- ストレージキー: シグネチャ=`courseSignature:{courseId}`（`CourseLink[]`）、未読=`courseUpdates:{courseId}`（`UnreadUpdate[]`）。
- `CourseLink = { title: string; url: string }`（litus `src/parsers/letusLinks.ts` と同順）。
- シグネチャ範囲: `/mod/[^/]+/view.php`。**追加のみ通知**、削除はシグネチャ更新のみ。
- 初回（前回シグネチャ無し）はベースライン保存のみ・通知なし。
- リファクタ（Task 1）は**挙動不変**。既存 `src/background/index.test.ts` が緑のままであること。
- vitestは `import { describe, it, expect } from 'vitest'` を明示（globals未設定）。
- 検証コマンド: `pnpm exec tsc -b`・`pnpm build`・`pnpm exec vitest run src`。
- コミットのフッタは `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

## File Structure

- Create: `src/core/htmlText.ts` — `normalizeText`/`stripTags`/`decodeHtmlEntities`（index.tsから移設）。
- Create: `src/core/letusLinks.ts` — `CourseLink`／`extractLinksFromHtml`（index.tsから移設、`htmlText`依存）。
- Create: `src/core/letusLinks.test.ts`。
- Modify: `src/background/index.ts` — 上記の局所定義を削除し import に切替（`htmlToPlainText` は残し `htmlText` から import）。
- Create: `src/core/courseUpdates.ts` — 純関数（signature/diff/update判定）＋`UnreadUpdate`型。
- Create: `src/core/courseUpdates.test.ts`。
- Create: `src/background/courseUpdatesStore.ts` — `chrome.storage.local` I/O。
- Create: `src/background/courseUpdatesStore.test.ts`。
- Modify: `src/background/index.ts` — スキャンにフック＋通知。
- Create: `src/components/CourseUpdatesSection.tsx` — ダッシュボードの更新セクション。
- Modify: `src/App.tsx`・`src/App.css` — 配置＋CSS。
- Modify: `TASKS.md`・`WORKLOG.md`。

---

### Task 1: 共有抽出 `htmlText.ts` ＋ `letusLinks.ts`（挙動不変リファクタ）

**Files:**
- Create: `src/core/htmlText.ts`
- Create: `src/core/letusLinks.ts`
- Create: `src/core/letusLinks.test.ts`
- Modify: `src/background/index.ts`

**Interfaces:**
- Produces:
  - `htmlText.ts`: `normalizeText(text: unknown): string`・`stripTags(html: string): string`・`decodeHtmlEntities(text: string): string`
  - `letusLinks.ts`: `type CourseLink = { title: string; url: string }`・`extractLinksFromHtml(html: string, baseUrl: string): CourseLink[]`

- [ ] **Step 1: `htmlText.ts` を作成（index.tsの定義をそのまま移す）**

```ts
export function normalizeText(text: unknown): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ')
}

export function stripTags(html: string): string {
  return normalizeText(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' '),
  )
}

export function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
  }
  return String(text).replace(
    /&(amp|lt|gt|quot|#39|nbsp);/g,
    (match) => entities[match] ?? match,
  )
}
```

- [ ] **Step 2: `letusLinks.ts` を作成**

```ts
import { stripTags, decodeHtmlEntities } from './htmlText'

export type CourseLink = { title: string; url: string }

/** アンカーを抽出し baseUrl で絶対URL化、フラグメント除去、タイトル空は除外。 */
export function extractLinksFromHtml(html: string, baseUrl: string): CourseLink[] {
  const links: CourseLink[] = []
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1]
    const innerHtml = match[2]
    if (!href) continue
    try {
      const url = new URL(href, baseUrl).toString().split('#')[0]
      const title = decodeHtmlEntities(stripTags(innerHtml))
      if (title.length > 0) {
        links.push({ title, url })
      }
    } catch {
      // URL変換失敗は無視
    }
  }

  return links
}
```

- [ ] **Step 3: `letusLinks.test.ts` を作成（失敗確認用）**

```ts
import { describe, it, expect } from 'vitest'
import { extractLinksFromHtml } from './letusLinks'

const BASE = 'https://letus.ed.tus.ac.jp/course/view.php?id=5'

describe('extractLinksFromHtml', () => {
  it('相対URLを絶対化しフラグメントを除去、タイトルを復号する', () => {
    const html = '<a href="/mod/assign/view.php?id=101#top">レポート&amp;課題</a>'
    expect(extractLinksFromHtml(html, BASE)).toEqual([
      { title: 'レポート&課題', url: 'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=101' },
    ])
  })
  it('タイトル空のアンカーは除外する', () => {
    const html = '<a href="/mod/assign/view.php?id=1"></a>'
    expect(extractLinksFromHtml(html, BASE)).toEqual([])
  })
})
```

- [ ] **Step 4: 失敗を確認**

Run: `pnpm exec vitest run src/core/letusLinks.test.ts`
Expected: PASS（実装は Step 1-2 で既に存在するため実際は緑。ここではモジュール解決の確認）。もし FAIL ならパスを確認。

- [ ] **Step 5: `index.ts` を import に切替**

`src/background/index.ts` の `normalizeText`・`stripTags`・`decodeHtmlEntities`・`extractLinksFromHtml` の**局所関数定義（4つ）を削除**し、ファイル冒頭の import 群に次を追加する:

```ts
import { normalizeText, stripTags, decodeHtmlEntities } from '../core/htmlText'
import { extractLinksFromHtml, type CourseLink } from '../core/letusLinks'
```

`htmlToPlainText`（`stripTags`/`decodeHtmlEntities` を呼ぶ）は index.ts に残す（import した関数を参照するので変更不要）。既存の `CourseLink` 相当のインライン型注釈 `{ title: string; url: string }[]` を使っている箇所は触らなくてよい（構造的に互換）。

- [ ] **Step 6: 型チェック・ビルド・既存テスト緑を確認（挙動不変）**

Run: `pnpm exec tsc -b`
Expected: エラーなし（未使用importや重複定義が無いこと）

Run: `pnpm exec vitest run src`
Expected: PASS（**既存 `index.test.ts` が緑のまま**＋新規 letusLinks）

Run: `pnpm build`
Expected: 成功

- [ ] **Step 7: コミット**

```bash
git add src/core/htmlText.ts src/core/letusLinks.ts src/core/letusLinks.test.ts src/background/index.ts
git commit -m "refactor(ext): extract letusLinks/htmlText shared modules from background"
```

---

### Task 2: 純関数 `courseUpdates.ts`（signature・diff）

**Files:**
- Create: `src/core/courseUpdates.ts`
- Test: `src/core/courseUpdates.test.ts`

**Interfaces:**
- Consumes: `extractLinksFromHtml`, `CourseLink`（`./letusLinks`）。
- Produces:
  - `computeCourseSignature(html: string, baseUrl: string): CourseLink[]`
  - `diffCourseSignature(prev: CourseLink[], next: CourseLink[]): { added: CourseLink[]; removed: CourseLink[] }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest'
import { computeCourseSignature, diffCourseSignature } from './courseUpdates'

const BASE = 'https://letus.ed.tus.ac.jp/course/view.php?id=5'

describe('computeCourseSignature', () => {
  it('/mod/*/view.php のみ・URL重複排除・ソートして返す', () => {
    const html = `
      <a href="/mod/assign/view.php?id=101">レポート課題1</a>
      <a href="/mod/resource/view.php?id=103">講義スライド</a>
      <a href="/course/view.php?id=5">コースホーム</a>
      <a href="/mod/assign/view.php?id=101#s2">レポート課題1(再掲)</a>
    `
    const sig = computeCourseSignature(html, BASE)
    expect(sig.map((a) => a.url)).toEqual([
      'https://letus.ed.tus.ac.jp/mod/assign/view.php?id=101',
      'https://letus.ed.tus.ac.jp/mod/resource/view.php?id=103',
    ])
  })
})

describe('diffCourseSignature', () => {
  it('URLで追加/削除を出す', () => {
    const prev = [{ title: 'a', url: 'u1' }, { title: 'b', url: 'u2' }]
    const next = [{ title: 'b', url: 'u2' }, { title: 'c', url: 'u3' }]
    const d = diffCourseSignature(prev, next)
    expect(d.added.map((x) => x.url)).toEqual(['u3'])
    expect(d.removed.map((x) => x.url)).toEqual(['u1'])
  })
  it('変化なしなら空', () => {
    const s = [{ title: 'a', url: 'u1' }]
    expect(diffCourseSignature(s, s)).toEqual({ added: [], removed: [] })
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm exec vitest run src/core/courseUpdates.test.ts`
Expected: FAIL（未定義）

- [ ] **Step 3: 実装**

`src/core/courseUpdates.ts` を作成:

```ts
import { extractLinksFromHtml, type CourseLink } from './letusLinks'

const MOD_VIEW = /\/mod\/[^/]+\/view\.php/

/** コースHTMLから /mod/*/view.php リンクを url 重複排除・url 昇順で返す（シグネチャ）。 */
export function computeCourseSignature(html: string, baseUrl: string): CourseLink[] {
  const links = extractLinksFromHtml(html, baseUrl)
  const seen = new Set<string>()
  const out: CourseLink[] = []
  for (const l of links) {
    if (!MOD_VIEW.test(l.url)) continue
    if (seen.has(l.url)) continue
    seen.add(l.url)
    out.push(l)
  }
  out.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
  return out
}

/** 前回→今回の url 集合差分。 */
export function diffCourseSignature(
  prev: CourseLink[],
  next: CourseLink[],
): { added: CourseLink[]; removed: CourseLink[] } {
  const prevUrls = new Set(prev.map((a) => a.url))
  const nextUrls = new Set(next.map((a) => a.url))
  return {
    added: next.filter((a) => !prevUrls.has(a.url)),
    removed: prev.filter((a) => !nextUrls.has(a.url)),
  }
}
```

- [ ] **Step 4: 通過を確認**

Run: `pnpm exec vitest run src/core/courseUpdates.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/courseUpdates.ts src/core/courseUpdates.test.ts
git commit -m "feat(ext): add course update signature and diff (def A)"
```

---

### Task 3: 純関数 `computeCourseUpdate`（更新判定・skipSave）

**Files:**
- Modify: `src/core/courseUpdates.ts`
- Test: `src/core/courseUpdates.test.ts`

**Interfaces:**
- Produces:
  - `type UnreadUpdate = { url: string; title: string; detectedAt: string }`
  - `computeCourseUpdate(prevSignature: CourseLink[] | null, html: string, baseUrl: string, now: string): { signature: CourseLink[]; added: UnreadUpdate[]; skipSave: boolean }`

- [ ] **Step 1: 失敗するテストを追記**

```ts
import { computeCourseUpdate } from './courseUpdates'

const html2 = (ids: number[]) => ids.map((i) => `<a href="/mod/assign/view.php?id=${i}">課題${i}</a>`).join('')

describe('computeCourseUpdate', () => {
  it('初回（前回null）はベースライン保存のみ・added空', () => {
    const r = computeCourseUpdate(null, html2([1, 2]), BASE, '2026-07-07T00:00:00Z')
    expect(r.added).toEqual([])
    expect(r.skipSave).toBe(false)
    expect(r.signature.map((s) => s.url)).toHaveLength(2)
  })
  it('2回目は追加分を UnreadUpdate として返す', () => {
    const prev = computeCourseSignature(html2([1, 2]), BASE)
    const r = computeCourseUpdate(prev, html2([1, 2, 3]), BASE, '2026-07-07T00:00:00Z')
    expect(r.added.map((a) => a.url)).toEqual(['https://letus.ed.tus.ac.jp/mod/assign/view.php?id=3'])
    expect(r.added[0].detectedAt).toBe('2026-07-07T00:00:00Z')
    expect(r.skipSave).toBe(false)
  })
  it('新signatureが空かつ前回非空なら skipSave（ベースライン破壊防止）', () => {
    const prev = computeCourseSignature(html2([1, 2]), BASE)
    const r = computeCourseUpdate(prev, '<html>logged out</html>', BASE, '2026-07-07T00:00:00Z')
    expect(r.skipSave).toBe(true)
    expect(r.added).toEqual([])
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm exec vitest run src/core/courseUpdates.test.ts`
Expected: FAIL（`computeCourseUpdate`/`UnreadUpdate` 未定義）

- [ ] **Step 3: 実装を追記**

`src/core/courseUpdates.ts` の末尾に追記:

```ts
export type UnreadUpdate = { url: string; title: string; detectedAt: string }

/** 前回シグネチャと今回HTMLから、新シグネチャ・追加項目・保存要否を求める。 */
export function computeCourseUpdate(
  prevSignature: CourseLink[] | null,
  html: string,
  baseUrl: string,
  now: string,
): { signature: CourseLink[]; added: UnreadUpdate[]; skipSave: boolean } {
  const signature = computeCourseSignature(html, baseUrl)
  if (prevSignature === null) {
    return { signature, added: [], skipSave: false }
  }
  if (signature.length === 0 && prevSignature.length > 0) {
    return { signature: [], added: [], skipSave: true }
  }
  const added = diffCourseSignature(prevSignature, signature).added.map((l) => ({
    url: l.url,
    title: l.title,
    detectedAt: now,
  }))
  return { signature, added, skipSave: false }
}
```

- [ ] **Step 4: 通過を確認**

Run: `pnpm exec vitest run src/core/courseUpdates.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/courseUpdates.ts src/core/courseUpdates.test.ts
git commit -m "feat(ext): add computeCourseUpdate (baseline/added/skipSave)"
```

---

### Task 4: I/O `courseUpdatesStore.ts`

**Files:**
- Create: `src/background/courseUpdatesStore.ts`
- Test: `src/background/courseUpdatesStore.test.ts`

**Interfaces:**
- Consumes: `CourseLink`（`../core/letusLinks`）、`UnreadUpdate`（`../core/courseUpdates`）。
- Produces:
  - `getCourseSignature(courseId: string): Promise<CourseLink[] | null>`
  - `saveCourseSignature(courseId: string, sig: CourseLink[]): Promise<void>`
  - `getUnreadUpdates(courseId: string): Promise<UnreadUpdate[]>`
  - `addUnreadUpdates(courseId: string, items: UnreadUpdate[]): Promise<void>`（url重複を避けて追記）
  - `markUpdateRead(courseId: string, url: string): Promise<void>`
  - `clearCourseUpdates(courseId: string): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getCourseSignature, saveCourseSignature,
  getUnreadUpdates, addUnreadUpdates, markUpdateRead, clearCourseUpdates,
} from './courseUpdatesStore'

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
      remove: (key: string) => { delete store[key]; return Promise.resolve() },
    },
  },
})
beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

const u = (url: string): { url: string; title: string; detectedAt: string } => ({ url, title: url, detectedAt: '2026-07-07T00:00:00Z' })

describe('courseUpdatesStore', () => {
  it('シグネチャを保存・取得（未保存はnull）', async () => {
    expect(await getCourseSignature('c1')).toBeNull()
    await saveCourseSignature('c1', [{ title: 'a', url: 'u1' }])
    expect((await getCourseSignature('c1'))?.[0].url).toBe('u1')
  })
  it('未読を重複を避けて追記できる', async () => {
    await addUnreadUpdates('c1', [u('u1'), u('u2')])
    await addUnreadUpdates('c1', [u('u2'), u('u3')])
    expect((await getUnreadUpdates('c1')).map((x) => x.url)).toEqual(['u1', 'u2', 'u3'])
  })
  it('項目単位で既読化、コース単位でクリアできる', async () => {
    await addUnreadUpdates('c1', [u('u1'), u('u2')])
    await markUpdateRead('c1', 'u1')
    expect((await getUnreadUpdates('c1')).map((x) => x.url)).toEqual(['u2'])
    await clearCourseUpdates('c1')
    expect(await getUnreadUpdates('c1')).toEqual([])
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm exec vitest run src/background/courseUpdatesStore.test.ts`
Expected: FAIL（未定義）

- [ ] **Step 3: 実装**

`src/background/courseUpdatesStore.ts` を作成:

```ts
import type { CourseLink } from '../core/letusLinks'
import type { UnreadUpdate } from '../core/courseUpdates'

const sigKey = (courseId: string) => `courseSignature:${courseId}`
const updKey = (courseId: string) => `courseUpdates:${courseId}`

export async function getCourseSignature(courseId: string): Promise<CourseLink[] | null> {
  const key = sigKey(courseId)
  const res = (await chrome.storage.local.get(key)) as Record<string, CourseLink[] | undefined>
  return res[key] ?? null
}

export async function saveCourseSignature(courseId: string, sig: CourseLink[]): Promise<void> {
  await chrome.storage.local.set({ [sigKey(courseId)]: sig })
}

export async function getUnreadUpdates(courseId: string): Promise<UnreadUpdate[]> {
  const key = updKey(courseId)
  const res = (await chrome.storage.local.get(key)) as Record<string, UnreadUpdate[] | undefined>
  return res[key] ?? []
}

export async function addUnreadUpdates(courseId: string, items: UnreadUpdate[]): Promise<void> {
  const existing = await getUnreadUpdates(courseId)
  const seen = new Set(existing.map((x) => x.url))
  const merged = [...existing]
  for (const it of items) {
    if (!seen.has(it.url)) {
      seen.add(it.url)
      merged.push(it)
    }
  }
  await chrome.storage.local.set({ [updKey(courseId)]: merged })
}

export async function markUpdateRead(courseId: string, url: string): Promise<void> {
  const remaining = (await getUnreadUpdates(courseId)).filter((x) => x.url !== url)
  await chrome.storage.local.set({ [updKey(courseId)]: remaining })
}

export async function clearCourseUpdates(courseId: string): Promise<void> {
  await chrome.storage.local.remove(updKey(courseId))
}
```

- [ ] **Step 4: 通過を確認**

Run: `pnpm exec vitest run src/background/courseUpdatesStore.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/background/courseUpdatesStore.ts src/background/courseUpdatesStore.test.ts
git commit -m "feat(ext): add course updates storage (signature, unread)"
```

---

### Task 5: スキャンにフック＋通知

**Files:**
- Modify: `src/background/index.ts`

**Interfaces:**
- Consumes: `computeCourseUpdate`（`../core/courseUpdates`）、`getCourseSignature`/`saveCourseSignature`/`addUnreadUpdates`（`./courseUpdatesStore`）、既存 `createNotification`。
- 注: DOMや実fetchは自動テスト対象外。純ロジックは Task 3 済み。本タスクの機械検証は `tsc`・`build`・既存テスト緑。

- [ ] **Step 1: import を追加**

`src/background/index.ts` の import 群に追加:

```ts
import { computeCourseUpdate } from '../core/courseUpdates'
import { getCourseSignature, saveCourseSignature, addUnreadUpdates } from './courseUpdatesStore'
```

- [ ] **Step 2: 通知ヘルパを追加**

`createNotification` の定義の後に、コース更新通知を出す関数を追加:

```ts
async function notifyCourseUpdate(course: Course, addedCount: number): Promise<void> {
  await createNotification({
    title: 'コース更新',
    message: `${course.name} に新しい教材/課題 ${addedCount}件`,
    url: `${chrome.runtime.getURL('index.html')}#dashboard`,
  })
}
```

注: `createNotification` の実際の引数（title/message/url 等）は既存定義に合わせること。`createNotification` の現行シグネチャを確認し、`url`（クリック先）の渡し方が違う場合はそれに従う。ダッシュボードURLは `chrome.runtime.getURL('index.html') + '#dashboard'`。

- [ ] **Step 3: コースHTML取得箇所にフックする**

`scanAssignmentCandidatesInBackground` 内で各コースの HTML を取得している箇所を特定:

Run: `grep -n "fetch(course.url" src/background/index.ts`

その `fetch` で得た HTML 文字列（例: `const html = await response.text()` 等、既存の変数名に合わせる）が確定した直後、既存のリンク抽出処理と同じスコープに次を挿入する（`course` と `html` と `baseUrl` が参照可能な位置）:

```ts
      try {
        const prevSig = await getCourseSignature(course.id)
        const upd = computeCourseUpdate(prevSig, html, course.url, new Date().toISOString())
        if (!upd.skipSave) {
          await saveCourseSignature(course.id, upd.signature)
          if (upd.added.length > 0) {
            await addUnreadUpdates(course.id, upd.added)
            await notifyCourseUpdate(course, upd.added.length)
          }
        }
      } catch {
        // 更新検知の失敗はスキャン本体を止めない
      }
```

注: 既存コードで HTML 文字列を保持していない場合（`response.text()` を別変数にしていない等）は、リンク抽出に使っている HTML 変数を再利用する。baseUrl は `course.url`。

- [ ] **Step 4: 型チェック・ビルド・既存テスト**

Run: `pnpm exec tsc -b`
Expected: エラーなし

Run: `pnpm build`
Expected: 成功

Run: `pnpm exec vitest run src`
Expected: PASS（既存＋新規、緑のまま）

- [ ] **Step 5: 手動確認手順を WORKLOG 用に控える**

- `dist/` を再読込 → 初回スキャンでベースライン保存（通知なし）→ LETUSコースに新しい教材/課題を追加（or 既存差分）→ 次回スキャンで「コース更新」通知が出る → ダッシュボードに項目が並ぶ。

- [ ] **Step 6: コミット**

```bash
git add src/background/index.ts
git commit -m "feat(ext): detect course updates during scan and notify"
```

---

### Task 6: ダッシュボードUI `CourseUpdatesSection`

**Files:**
- Create: `src/components/CourseUpdatesSection.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `courses: Course[]`（App state）、`getUnreadUpdates`/`markUpdateRead`/`clearCourseUpdates`（`../background/courseUpdatesStore`）、`UnreadUpdate`（`../core/courseUpdates`）。
- Produces: `<CourseUpdatesSection courses={courses} />`。

- [ ] **Step 1: コンポーネントを作成**

`src/components/CourseUpdatesSection.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { Course } from '../core/types'
import type { UnreadUpdate } from '../core/courseUpdates'
import { getUnreadUpdates, markUpdateRead, clearCourseUpdates } from '../background/courseUpdatesStore'

type CourseUnread = { course: Course; items: UnreadUpdate[] }

export function CourseUpdatesSection({ courses }: { courses: Course[] }) {
  const [groups, setGroups] = useState<CourseUnread[]>([])

  async function reload() {
    const out: CourseUnread[] = []
    for (const course of courses) {
      const items = await getUnreadUpdates(course.id)
      if (items.length > 0) out.push({ course, items })
    }
    setGroups(out)
  }

  useEffect(() => { void reload() }, [courses])

  const total = groups.reduce((n, g) => n + g.items.length, 0)
  if (total === 0) return null

  async function openItem(courseId: string, item: UnreadUpdate) {
    chrome.tabs.create({ url: item.url })
    await markUpdateRead(courseId, item.url)
    await reload()
  }

  async function clearCourse(courseId: string) {
    await clearCourseUpdates(courseId)
    await reload()
  }

  return (
    <section className="courseUpdatesSection">
      <div className="courseUpdatesHeader">
        <span className="courseUpdatesTitle">コース更新</span>
        <span className="courseUpdatesBadge">{total}</span>
      </div>
      {groups.map((g) => (
        <div key={g.course.id} className="courseUpdatesGroup">
          <div className="courseUpdatesGroupHead">
            <span className="courseUpdatesCourse">{g.course.name}</span>
            <button type="button" className="courseUpdatesClear" onClick={() => void clearCourse(g.course.id)}>
              全既読
            </button>
          </div>
          <ul className="courseUpdatesList">
            {g.items.map((it) => (
              <li key={it.url}>
                <button type="button" className="courseUpdatesItem" onClick={() => void openItem(g.course.id, it)}>
                  <span className="courseUpdatesItemTitle">{it.title}</span>
                  <span className="courseUpdatesItemDate">{new Date(it.detectedAt).toLocaleDateString('ja-JP')}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 2: App.tsx に配置**

`src/App.tsx` の import に追加:

```tsx
import { CourseUpdatesSection } from './components/CourseUpdatesSection'
```

`<TimetableSection courses={courses} assignments={assignments} />` の直後に配置:

```tsx
          <CourseUpdatesSection courses={courses} />
```

- [ ] **Step 3: CSS を追加**

`src/App.css` の末尾に追加:

```css
.courseUpdatesSection { margin-bottom: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
.courseUpdatesHeader { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.courseUpdatesTitle { font-size: 15px; font-weight: 700; color: #1e293b; }
.courseUpdatesBadge { font-size: 11px; background: #fee2e2; color: #b91c1c; border-radius: 20px; padding: 1px 8px; }
.courseUpdatesGroup { padding: 8px 0; border-top: 1px solid #f1f5f9; }
.courseUpdatesGroupHead { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.courseUpdatesCourse { font-size: 13px; font-weight: 600; color: #334155; }
.courseUpdatesClear { background: none; border: none; font-size: 11px; color: #64748b; cursor: pointer; }
.courseUpdatesList { list-style: none; margin: 0; padding: 0; }
.courseUpdatesItem { display: flex; justify-content: space-between; gap: 8px; width: 100%; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 8px; margin-top: 4px; cursor: pointer; text-align: left; font-family: inherit; }
.courseUpdatesItemTitle { font-size: 12px; color: #1d4ed8; }
.courseUpdatesItemDate { font-size: 11px; color: #94a3b8; white-space: nowrap; }
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
git add src/components/CourseUpdatesSection.tsx src/App.tsx src/App.css
git commit -m "feat(ext): show course updates section in dashboard"
```

---

### Task 7: ドキュメント整合＋TASKS/WORKLOG更新

**Files:**
- Modify: `TASKS.md`
- Modify: `WORKLOG.md`

- [ ] **Step 1: TASKS.md を更新**

「コース内容の更新通知（定義A）」項目を `[x]` にし、実装物（`letusLinks.ts`/`htmlText.ts` 抽出・`courseUpdates.ts`・`courseUpdatesStore.ts`・スキャンフック＋通知・`CourseUpdatesSection`）を追記。

- [ ] **Step 2: WORKLOG.md に実装記録を追記**

先頭に、No.4実装の要点（既存スキャンHTML再利用・追加のみ通知・skipSaveガード・letusLinks共有化＝index.tsリファクタ・実LETUS手動確認手順）と検証結果、逆流状態（`courseUpdates`はlitus双子、`letusLinks`は拡張発）を追記。

- [ ] **Step 3: コミット**

```bash
git add TASKS.md WORKLOG.md
git commit -m "docs: mark v1.2.0 No.4 course update notification done"
```

---

## 完了条件

- Task 1〜7 の全チェックボックス完了。
- `pnpm exec tsc -b`・`pnpm build`・`pnpm exec vitest run src` 全緑。**既存 `index.test.ts` が緑のまま**（リファクタ挙動不変）。
- 初回スキャンはベースライン保存のみ・通知なし。以後、`/mod/*/view.php` の追加で「コース更新」通知＋ダッシュボードに項目履歴。項目クリックでLETUSを開き既読化。
- 一時的な0件（ログイン切れ等）でベースラインを壊さない（skipSave）。
- manifest・バックエンド変更なし。実LETUSでの疎通はユーザー環境で手動確認。
