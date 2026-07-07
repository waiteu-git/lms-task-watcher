# litus 進捗の半自動レポート Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** litus（`C:/dev/litus`）の進捗を2日おき半自動で「自分用ダイジェスト／X下書き／公開devlog」の3種に整え、Discord管理chへ届け、承認分を公開できるようにする。

**Architecture:** 決定論の小部品（litus差分の収集パーサ＋Discord投稿ペイロード＋状態管理）を `ops/litus-devlog/` に置き、LLM生成ステップ（下書き3種の文面）と、公開devlogページ `landing/updates.html` を組み合わせる。フェーズ①=部品＋手動実行、フェーズ②=クラウドルーティンで2日おき自動化。

**Tech Stack:** Node.js v24（ESM `.mjs`、`node:test`）、fetch（グローバル）、既存の静的ランディング（インラインCSS）。

## Global Constraints

- ソース = litus リポジトリ（ローカル既定 `C:/dev/litus`、環境変数 `LITUS_REPO` で上書き可）／リモート `github.com/waiteu-git/litus`。
- 生成物は3種: (a)自分用ダイジェスト (b)X投稿下書き (c)devlogエントリ。1回の収集から生成する。
- 半自動: 生成は自動、公開はレビュー後。devlog を無レビューで自動デプロイしない。X は投稿不可＝下書きのみ。
- 周期 = 2日おき（フェーズ②）。届け先 = Discord 管理ch（Webhook URL は環境変数 `DISCORD_DEVLOG_WEBHOOK`）。
- 生成は**収集した実データ（コミット/CHANGELOG）に無い機能を主張しない**。トーンは既存ランディング文体（「LETUSもCLASSも」系・煽り過ぎない）。
- ブランドのローマ字は **Litus**（Litasは旧・使わない）。
- devlog は専用 `landing/updates.html`（`/app` から「開発の歩み」で導線）。`/app` 本体は肥大させない。
- ops配下のnodeスクリプトは `.mjs`（ESM）、テストは `node --test`（依存追加なし）。
- テスト以外は決定論部品のみユニットテスト。LLM生成ステップはテスト対象外（フォーマットは人手レビュー）。

---

### Task 1: litus差分の収集（パーサ＋CLI）

**Files:**
- Create: `ops/litus-devlog/collect.mjs`
- Test: `ops/litus-devlog/collect.test.mjs`

**Interfaces:**
- Produces:
  - `parseGitLog(raw: string): {sha:string, date:string, subject:string, body:string}[]` — `git log --format=%H%x1f%cI%x1f%s%x1f%b%x1e` の出力をパース。レコード区切り `\x1e`、フィールド区切り `\x1f`。空入力→ `[]`。
  - `collect({repo, lastSha, sinceDaysDefault}): {count, newestSha, commits, changelogHead}` — gitを実行して差分を集める（副作用あり・テスト対象外の薄いCLI関数）。
  - CLI（`node collect.mjs`）: `state.json` の `lastSha` を読み、範囲を決めてJSONをstdoutへ。

- [ ] **Step 1: 失敗するテストを書く**

`ops/litus-devlog/collect.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGitLog } from './collect.mjs'

const US = '\x1f'
const RS = '\x1e'

test('parseGitLog: 複数コミットを構造化する', () => {
  const raw =
    ['abc123', '2026-07-08T10:00:00+09:00', 'feat: A', 'body A'].join(US) + RS +
    ['def456', '2026-07-07T09:00:00+09:00', 'fix: B', ''].join(US) + RS
  const out = parseGitLog(raw)
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], { sha: 'abc123', date: '2026-07-08T10:00:00+09:00', subject: 'feat: A', body: 'body A' })
  assert.equal(out[1].subject, 'fix: B')
  assert.equal(out[1].body, '')
})

test('parseGitLog: 空入力は空配列', () => {
  assert.deepEqual(parseGitLog(''), [])
  assert.deepEqual(parseGitLog('   \n  '), [])
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /c/dev/lms-task-watcher && node --test ops/litus-devlog/collect.test.mjs`
Expected: FAIL（`parseGitLog` 未定義 / モジュール無し）

- [ ] **Step 3: 実装**

`ops/litus-devlog/collect.mjs`:

```js
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const US = '\x1f'
const RS = '\x1e'

export function parseGitLog(raw) {
  if (!raw) return []
  return raw
    .split(RS)
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((r) => {
      const [sha, date, subject, body = ''] = r.split(US)
      return { sha, date, subject, body }
    })
}

// 副作用あり（gitを実行）。テスト対象外。
export function collect({ repo, lastSha, sinceDaysDefault = 7 }) {
  const fmt = `--format=%H${US}%cI${US}%s${US}%b${RS}`
  const range = lastSha ? [`${lastSha}..HEAD`] : [`--since=${sinceDaysDefault} days ago`]
  let raw = ''
  try {
    raw = execFileSync('git', ['-C', repo, 'log', ...range, fmt], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
  } catch (e) {
    throw new Error(`git log 失敗（repo=${repo}）: ${e.message}`)
  }
  const commits = parseGitLog(raw)
  let changelogHead = ''
  try {
    changelogHead = readFileSync(`${repo}/CHANGELOG.md`, 'utf8').split('\n').slice(0, 60).join('\n')
  } catch { changelogHead = '' }
  return { count: commits.length, newestSha: commits[0]?.sha ?? lastSha ?? null, commits, changelogHead }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('collect.mjs')) {
  const repo = process.env.LITUS_REPO || 'C:/dev/litus'
  let lastSha = null
  try {
    lastSha = JSON.parse(readFileSync(new URL('./state.json', import.meta.url), 'utf8')).lastSha || null
  } catch { lastSha = null }
  const result = collect({ repo, lastSha })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test ops/litus-devlog/collect.test.mjs`
Expected: PASS（2件）

- [ ] **Step 5: コミット**

```bash
git add ops/litus-devlog/collect.mjs ops/litus-devlog/collect.test.mjs
git commit -m "feat(devlog): litus git log collector + parser"
```

---

### Task 2: Discord投稿（ペイロード分割＋送信）

**Files:**
- Create: `ops/litus-devlog/discord.mjs`
- Test: `ops/litus-devlog/discord.test.mjs`

**Interfaces:**
- Produces:
  - `buildDiscordPayload(text: string, maxLen=1900): string[]` — Discordの2000字制限に収まるよう改行優先で分割。空文字→`[]`。
  - `postToDiscord(webhookUrl, text)` — 各チャンクを順に `{content}` でPOST（副作用・テスト対象外）。
  - CLI（`node discord.mjs <file>`）: ファイル本文を読み `DISCORD_DEVLOG_WEBHOOK` へ投稿。

- [ ] **Step 1: 失敗するテストを書く**

`ops/litus-devlog/discord.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDiscordPayload } from './discord.mjs'

test('短文はそのまま1チャンク', () => {
  assert.deepEqual(buildDiscordPayload('hello'), ['hello'])
})

test('空文字は空配列', () => {
  assert.deepEqual(buildDiscordPayload(''), [])
})

test('maxLen超は改行優先で複数チャンクに分割し、各チャンクは上限以下', () => {
  const line = 'x'.repeat(50)
  const text = Array.from({ length: 10 }, () => line).join('\n') // 10行×50字＋改行
  const chunks = buildDiscordPayload(text, 120)
  assert.ok(chunks.length > 1)
  for (const c of chunks) assert.ok(c.length <= 120, `chunk too long: ${c.length}`)
  // 分割しても全行が保持される
  assert.equal(chunks.join('\n').replace(/\n+/g, '\n'), text)
})

test('1行が上限を超える場合はハード分割する', () => {
  const chunks = buildDiscordPayload('y'.repeat(250), 100)
  assert.ok(chunks.every((c) => c.length <= 100))
  assert.equal(chunks.join(''), 'y'.repeat(250))
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test ops/litus-devlog/discord.test.mjs`
Expected: FAIL（`buildDiscordPayload` 未定義）

- [ ] **Step 3: 実装**

`ops/litus-devlog/discord.mjs`:

```js
import { readFileSync } from 'node:fs'

export function buildDiscordPayload(text, maxLen = 1900) {
  if (!text) return []
  const chunks = []
  let cur = ''
  const pushCur = () => { if (cur.length) { chunks.push(cur); cur = '' } }
  for (const rawLine of text.split('\n')) {
    // 1行が上限超ならハード分割
    let line = rawLine
    while (line.length > maxLen) {
      pushCur()
      chunks.push(line.slice(0, maxLen))
      line = line.slice(maxLen)
    }
    const candidate = cur.length ? cur + '\n' + line : line
    if (candidate.length > maxLen) {
      pushCur()
      cur = line
    } else {
      cur = candidate
    }
  }
  pushCur()
  return chunks
}

export async function postToDiscord(webhookUrl, text) {
  const chunks = buildDiscordPayload(text)
  for (const content of chunks) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error(`Discord投稿失敗: ${res.status} ${await res.text()}`)
  }
  return chunks.length
}

if (process.argv[1]?.endsWith('discord.mjs')) {
  const file = process.argv[2]
  const url = process.env.DISCORD_DEVLOG_WEBHOOK
  if (!url) { console.error('DISCORD_DEVLOG_WEBHOOK 未設定'); process.exit(1) }
  if (!file) { console.error('usage: node discord.mjs <messageFile>'); process.exit(1) }
  const text = readFileSync(file, 'utf8')
  postToDiscord(url, text).then((n) => console.log(`posted ${n} chunk(s)`)).catch((e) => { console.error(e.message); process.exit(1) })
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test ops/litus-devlog/discord.test.mjs`
Expected: PASS（4件）

- [ ] **Step 5: コミット**

```bash
git add ops/litus-devlog/discord.mjs ops/litus-devlog/discord.test.mjs
git commit -m "feat(devlog): discord webhook payload builder + sender"
```

---

### Task 3: 状態管理（最終処理SHA）

**Files:**
- Create: `ops/litus-devlog/state.mjs`
- Create: `ops/litus-devlog/state.json`
- Test: `ops/litus-devlog/state.test.mjs`

**Interfaces:**
- Consumes: なし。
- Produces:
  - `readState(path): {lastSha: string|null, lastRunAt: string|null}` — ファイル無し/壊れは既定 `{lastSha:null,lastRunAt:null}`。
  - `writeState(path, {lastSha, lastRunAt})` — JSONで保存。
  - Task1のCLIは `readState` を使うよう後で差し替えても良いが、本計画では `state.json` 直読み（Task1実装）と本モジュールを併存させ、駆動（Task5 runbook）は `state.mjs` を使う。

- [ ] **Step 1: 失敗するテストを書く**

`ops/litus-devlog/state.test.mjs`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readState, writeState } from './state.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('無いファイルは既定を返す', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'st-')), 'state.json')
  assert.deepEqual(readState(p), { lastSha: null, lastRunAt: null })
})

test('書いて読むと往復する', () => {
  const dir = mkdtempSync(join(tmpdir(), 'st-'))
  const p = join(dir, 'state.json')
  writeState(p, { lastSha: 'abc', lastRunAt: '2026-07-08T00:00:00Z' })
  assert.deepEqual(readState(p), { lastSha: 'abc', lastRunAt: '2026-07-08T00:00:00Z' })
  rmSync(dir, { recursive: true, force: true })
})

test('壊れたJSONは既定を返す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'st-'))
  const p = join(dir, 'state.json')
  writeState(p, {})
  // 壊す
  require('node:fs').writeFileSync(p, '{bad')
  assert.deepEqual(readState(p), { lastSha: null, lastRunAt: null })
  rmSync(dir, { recursive: true, force: true })
})
```

（注: ESMで `require` は使えないため Step3実装後、3つ目のテストは `writeFileSync` を `import` して使う形に直す。下記実装コード参照。）

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test ops/litus-devlog/state.test.mjs`
Expected: FAIL（`state.mjs` 無し）

- [ ] **Step 3: 実装＋テストのrequire除去**

`ops/litus-devlog/state.mjs`:

```js
import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULT = { lastSha: null, lastRunAt: null }

export function readState(path) {
  try {
    const obj = JSON.parse(readFileSync(path, 'utf8'))
    return { lastSha: obj.lastSha ?? null, lastRunAt: obj.lastRunAt ?? null }
  } catch {
    return { ...DEFAULT }
  }
}

export function writeState(path, { lastSha = null, lastRunAt = null }) {
  writeFileSync(path, JSON.stringify({ lastSha, lastRunAt }, null, 2) + '\n')
}
```

`state.test.mjs` の3つ目テストの壊すブロックを次に置換（先頭 import に `writeFileSync` を追加）:

```js
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
// ...
test('壊れたJSONは既定を返す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'st-'))
  const p = join(dir, 'state.json')
  writeFileSync(p, '{bad')
  assert.deepEqual(readState(p), { lastSha: null, lastRunAt: null })
  rmSync(dir, { recursive: true, force: true })
})
```

シード `ops/litus-devlog/state.json`:

```json
{
  "lastSha": null,
  "lastRunAt": null
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test ops/litus-devlog/state.test.mjs`
Expected: PASS（3件）

- [ ] **Step 5: コミット**

```bash
git add ops/litus-devlog/state.mjs ops/litus-devlog/state.test.mjs ops/litus-devlog/state.json
git commit -m "feat(devlog): last-processed SHA state store"
```

---

### Task 4: 公開devlogページ `updates.html` ＋ `/app` 導線

**Files:**
- Create: `landing/updates.html`
- Modify: `landing/app.html`（`/app` に「開発の歩み」リンクを追加）

**Interfaces:**
- Consumes: なし（Task2/3の生成物とは独立。承認済みdevlogエントリを人手/私が貼る先）。

- [ ] **Step 1: `updates.html` を作成**

`landing/updates.html` を作る。翠テーマ（`app-privacy.html` と同系統のヘッダー/配色）。エントリは日付つきで新しい順に上へ積む。初期は「最初のエントリ（プレースホルダ）」を1つ置く。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>開発の歩み — リタス（Litus）</title>
  <link rel="canonical" href="https://lms.waiteu.dev/updates">
  <meta name="description" content="モバイルアプリ「リタス（Litus）」の開発の歩み（devlog）。">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --accent:#0f9e75; --text-dark:#0f172a; --text-mid:#475569; --border:#e2e8f0; --bg-pale:#e7f6f1; --border-pale:#c9ece1; }
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--text-dark); background:#fff; line-height:1.8; font-size:16px; }
    header { border-bottom:1px solid var(--border); padding:14px 20px; }
    header .inner { max-width:760px; margin:0 auto; display:flex; align-items:center; justify-content:space-between; }
    .logo { display:flex; align-items:center; gap:8px; font-weight:900; color:var(--text-dark); text-decoration:none; }
    .logo svg { width:20px; height:19px; }
    .back-link { font-size:0.85rem; color:var(--accent); text-decoration:none; }
    main { max-width:760px; margin:0 auto; padding:40px 20px 80px; }
    h1 { font-size:1.6rem; font-weight:950; letter-spacing:-0.02em; margin-bottom:6px; }
    .sub { color:var(--text-mid); font-size:0.9rem; margin-bottom:36px; }
    .entry { border-left:3px solid var(--accent); padding:4px 0 4px 16px; margin:0 0 28px; }
    .entry .date { font-size:0.8rem; color:var(--accent); font-weight:900; }
    .entry h2 { font-size:1.05rem; font-weight:900; margin:2px 0 8px; }
    .entry p { font-size:0.95rem; color:var(--text-mid); margin:0 0 8px; }
    .entry ul { padding-left:1.3em; color:var(--text-mid); font-size:0.95rem; }
    footer { background:#0f172a; color:rgba(255,255,255,0.55); text-align:center; padding:20px; font-size:0.82rem; }
    footer a { color:rgba(255,255,255,0.75); }
  </style>
</head>
<body>
<header>
  <div class="inner">
    <a href="app.html" class="logo">
      <svg viewBox="0 0 48 46" fill="none" aria-hidden="true"><path fill="#0f9e75" d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"/></svg>
      リタス
    </a>
    <a href="app.html" class="back-link">← リタスのページへ</a>
  </div>
</header>
<main>
  <h1>開発の歩み</h1>
  <p class="sub">リタス（Litus）の開発進捗を数日おきに記録しています。<a href="app.html">事前登録はこちら →</a></p>

  <!-- 新しいエントリはこの下（このコメント直後）に追加する。日付降順（新しいものが上）。 -->
  <div class="entry">
    <div class="date">2026-07-08</div>
    <h2>開発の歩みを公開しはじめました</h2>
    <p>リタスの開発進捗を、このページで数日おきにお知らせしていきます。公開に向けて開発中です。</p>
  </div>
</main>
<footer>
  <a href="app.html">リタスのページ</a> &nbsp;|&nbsp; <a href="index.html">PC版（拡張機能）</a> &nbsp;|&nbsp; <a href="app-privacy.html">プライバシーポリシー</a>
</footer>
</body>
</html>
```

- [ ] **Step 2: `/app` に「開発の歩み」導線を追加**

`landing/app.html` の X フォロー導線 `.x-follow` ブロックの直後（`</div>` の後、`<!-- 目玉: CLASS連携 -->` の前）に、開発の歩みへのリンクを1行追加する。まず該当箇所を確認:

Run: `grep -n 'x-follow\|目玉: CLASS連携' landing/app.html`

`.x-follow` の閉じ `</div>` の直後に挿入:

```html
  <p style="margin-top:16px; font-size:13px;"><a href="updates.html" style="color:var(--accent); font-weight:700;">開発の歩み（devlog）を見る →</a></p>
```

- [ ] **Step 3: プレビューで確認**

preview_start（`landing-preview`、無ければ作成）で `/updates.html` を開き、preview_snapshot で「開発の歩み」見出しとエントリ、`/app.html` を開いて「開発の歩み（devlog）を見る →」リンクの存在を確認。preview_console_logs でエラーが無いこと。preview_screenshot で翠テーマの見た目を確認。

- [ ] **Step 4: コミット**

```bash
git add landing/updates.html landing/app.html
git commit -m "feat(landing): public devlog page (updates.html) + /app link"
```

---

### Task 5: 手動実行の手順書＋シードREADME（フェーズ①完成）

**Files:**
- Create: `ops/litus-devlog/README.md`

**Interfaces:**
- Consumes: Task1 `collect.mjs`、Task2 `discord.mjs`、Task3 `state.mjs`/`state.json`、Task4 `updates.html`。

- [ ] **Step 1: 手順書を書く**

`ops/litus-devlog/README.md`:

````markdown
# litus devlog — 手動実行手順（フェーズ①）

litus の進捗を「自分用ダイジェスト／X下書き／devlogエントリ」の3種にして Discord 管理ch へ届ける。

## 前提（1度だけ）
- Discord に管理専用チャンネルを作り、Webhook URL を取得 → 環境変数 `DISCORD_DEVLOG_WEBHOOK` に設定。
- litus は `C:/dev/litus`（別なら `LITUS_REPO` で指定）。

## 実行（2〜3日に1回、または「今回分やって」で）

1. 差分を収集:
   ```bash
   node ops/litus-devlog/collect.mjs > /tmp/litus-delta.json
   cat /tmp/litus-delta.json   # count / commits / changelogHead を確認
   ```
   `count` が 0 なら「今回は更新なし」＝スキップ（無投稿）。

2. 下書き3種を作る（LLM/自分で）: `/tmp/litus-delta.json` の commits・changelogHead **のみ**を根拠に、次の3セクションを1つのテキスト `/tmp/litus-draft.txt` に書く。実データに無い機能は書かない。トーンは既存ランディング準拠。
   - `## 自分用ダイジェスト`（出た/進行中/次）
   - `## X下書き`（ハイライト1本。必要ならスレッド）
   - `## devlogエントリ`（`updates.html` に貼れる日付つきHTML断片 or 素の文）

3. Discord へ投稿:
   ```bash
   node ops/litus-devlog/discord.mjs /tmp/litus-draft.txt
   ```

4. 状態を前進（次回の差分起点）:
   ```bash
   NEW=$(node -e "console.log(require('fs').readFileSync('/tmp/litus-delta.json','utf8'))" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).newestSha||''))")
   node -e "import('./ops/litus-devlog/state.mjs').then(m=>m.writeState('ops/litus-devlog/state.json',{lastSha:process.argv[1]||null,lastRunAt:new Date().toISOString()}))" "$NEW"
   git add ops/litus-devlog/state.json && git commit -m "chore(devlog): advance state to $NEW"
   ```

## 公開（レビュー後）
- X: Discordの `## X下書き` をコピペして @yning_y2 で投稿。
- devlog: `## devlogエントリ` を `landing/updates.html` の指定コメント直後に貼る → `git commit` → push（Cloudflare自動デプロイ）。
````

- [ ] **Step 2: 一連をローカルで通し確認（差分ゼロ経路）**

Run: `node ops/litus-devlog/collect.mjs`
Expected: JSON が出力される（litusに直近7日のコミットがあれば count>0、無ければ count:0）。エラーなく `newestSha`/`commits` が返ること。

- [ ] **Step 3: コミット**

```bash
git add ops/litus-devlog/README.md
git commit -m "docs(devlog): phase-1 manual run runbook"
```

---

### Task 6（フェーズ②）: 2日おきクラウドルーティンで自動化

**Files:**
- Create: `ops/litus-devlog/run.mjs`（駆動: collect→（生成はルーティンのLLMが担当）→discord→state前進）
- ドキュメント: `ops/litus-devlog/README.md` に「フェーズ②」節を追記

**Interfaces:**
- Consumes: Task1〜3のモジュール。
- Produces: `run.mjs` — `collect()` を呼び、`count>0` なら delta を stdout に出し、投稿用に整えて `postToDiscord` を呼ぶための足場。LLM生成はクラウドルーティン（claudeエージェント）が delta を受けて行い、生成テキストを `run.mjs --post <file>` で投稿＋state前進する2段構成。

- [ ] **Step 1: `run.mjs` を実装（生成は外部・投稿と状態前進を担う）**

```js
import { collect } from './collect.mjs'
import { postToDiscord } from './discord.mjs'
import { readState, writeState } from './state.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const STATE = fileURLToPath(new URL('./state.json', import.meta.url))
const REPO = process.env.LITUS_REPO || 'C:/dev/litus'

export function loadDelta() {
  const { lastSha } = readState(STATE)
  return collect({ repo: REPO, lastSha })
}

async function main() {
  const mode = process.argv[2]
  if (mode === '--delta') {
    process.stdout.write(JSON.stringify(loadDelta(), null, 2) + '\n')
    return
  }
  if (mode === '--post') {
    const file = process.argv[3]
    const newestSha = process.argv[4]
    const url = process.env.DISCORD_DEVLOG_WEBHOOK
    if (!url) throw new Error('DISCORD_DEVLOG_WEBHOOK 未設定')
    if (!file || !newestSha) throw new Error('usage: run.mjs --post <file> <newestSha>')
    await postToDiscord(url, readFileSync(file, 'utf8'))
    writeState(STATE, { lastSha: newestSha, lastRunAt: new Date().toISOString() })
    console.log('posted & state advanced to', newestSha)
    return
  }
  throw new Error('usage: run.mjs --delta | --post <file> <newestSha>')
}
main().catch((e) => { console.error(e.message); process.exit(1) })
```

- [ ] **Step 2: スケジュール登録（`/schedule`）**

`/schedule` スキルで2日おきのクラウドルーティンを作る。ルーティンの内容（プロンプト）は「litusを最新化 → `node ops/litus-devlog/run.mjs --delta` → count>0なら delta の commits/changelogHead のみを根拠に3種の下書きを書き `/tmp/litus-draft.txt` に保存 → `node ops/litus-devlog/run.mjs --post /tmp/litus-draft.txt <newestSha>` → state.json のコミットをpush。count==0なら無投稿で終了」。cron は2日おき（例 `0 9 */2 * *`）。

- [ ] **Step 3: 手動ドライラン**

Run: `node ops/litus-devlog/run.mjs --delta`
Expected: `loadDelta()` の JSON（stateのlastSha起点、無ければ7日）。エラー無し。

- [ ] **Step 4: コミット**

```bash
git add ops/litus-devlog/run.mjs ops/litus-devlog/README.md
git commit -m "feat(devlog): phase-2 driver (run.mjs) + 2-day cloud routine wiring"
```

---

## Self-Review

- **Spec coverage:** ソース/差分（Task1）／生成3種の根拠データ提供（Task1出力＋README手順）／Discord投稿（Task2）／状態管理（Task3）／公開devlog `updates.html`＋`/app`導線（Task4）／半自動フロー・手動実行（Task5）／2日おき自動化・案Bクラウドルーティン（Task6）。フェーズ①=Task1-5、②=Task6。全項目対応。
- **Placeholders:** 収集/投稿/状態は完全コード＋テスト。生成（LLM）ステップはREADMEに手順明記（実データ準拠の制約つき）。TODO/TBD無し。
- **Type consistency:** `parseGitLog`→`{sha,date,subject,body}`、`collect`→`{count,newestSha,commits,changelogHead}`、`buildDiscordPayload`→`string[]`、`readState/writeState`→`{lastSha,lastRunAt}` を全タスクで一貫使用。`run.mjs` は `collect/postToDiscord/readState/writeState` を既定シグネチャで消費。
- **注意:** Discord管理ch＋Webhook（`DISCORD_DEVLOG_WEBHOOK`）は前提の手作業。生成トーン/事実性はLLMステップの制約で担保（テスト不能なので人手レビュー）。
