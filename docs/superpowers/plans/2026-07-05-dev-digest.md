# 朝の開発ダイジェスト（ops/dev-digest.sh）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 毎朝1通、残タスク＋前日の進捗を #dev-digest に投稿する ops スクリプトを追加する。土台は決定論（トークンゼロ）、その上に予算・計測・自動停止つきの任意LLM要約1行を重ねる。

**Architecture:** 既存の ops 監視スクリプト群（`ops/nightly.sh` 等）と同じ形の1本のバニラbashスクリプト `ops/dev-digest.sh`。`run.sh` ランチャー経由でCIクローン（origin/develop同期）を読み、`lib/common.sh` の webhook ヘルパーで #dev-digest に投稿する。TASKS.md のパースと文字列整形は python3 のヒアドキュメントで行う（既存の canary/competitor と同じ流儀）。LLM要約は raw HTTP（curl）で Anthropic API（Haiku 4.5）を叩き、応答の実測 usage を台帳に記録、月予算のサーキットブレーカーで自動停止する。

**Tech Stack:** bash（`set -u`）、python3（JSON/整形、標準で入っている前提）、curl、git、tmux（task.sh経由）。テストフレームワークは無い — 各タスクは実行して出力をassertする検証で確認する。

## Global Constraints

スペック `docs/superpowers/specs/2026-07-05-dev-digest-design.md` が正。以下は全タスク共通:

- **バニラbash**（`set -u`）。SDK/Pythonプロジェクトは導入しない。JSON整形は python3 ヒアドキュメント
- **リポジトリ内容の参照元は CI クローン** `${DIGEST_REPO:-$OPS_HOME/ci/lms-task-watcher}`。
  スクリプト自身のパスは run.sh 実行時に temp コピーになり repo ではないため、`$0` から repo を導出しない
- **秘密情報**（`ANTHROPIC_API_KEY`・webhook URL）はコミット・ログに出さない
- **push 禁止・main/develop 直接操作禁止**。作業は作業ブランチのローカルコミットのみ
- **安全側デフォルト**: `DEV_DIGEST_WEBHOOK_URL` 未設定なら投稿せずログのみ（#ops-alertsにフォールバックしない）。
  `DIGEST_LLM_ENABLED != 1` または `ANTHROPIC_API_KEY` 未設定なら LLM 層は完全にオフ
- コスト計算: Haiku 4.5 = 入力 $1 / 出力 $5 per 1M tokens
- 「今月」= カレンダー月（台帳 `date` が現在の `YYYY-MM` で始まる行を合算）

---

### Task 1: common.sh に送信先を選べる notify_to を追加

**Files:**
- Modify: `ops/lib/common.sh`（`notify` 関数を `notify_to` に一般化）

**Interfaces:**
- Produces: `notify_to <url> <msg>` — 指定URLへDiscord webhook POST。URLが空なら投稿せずログのみ、失敗しても非0で落とさない。`notify <msg>` は `notify_to "$OPS_WEBHOOK_URL" <msg>` を呼ぶ後方互換ラッパ。
- Consumes: なし

- [ ] **Step 1: 変更前の notify を確認**

Run: `sed -n '/^notify()/,/^}/p' ops/lib/common.sh`
Expected: 現行の `notify()`（`OPS_WEBHOOK_URL` 固定）が表示される。

- [ ] **Step 2: notify を notify_to ＋ 薄いラッパに置き換える**

`ops/lib/common.sh` の `notify() { ... }` 定義全体を、以下で置き換える:

```bash
# 指定した webhook URL へ Discord にPOSTする。URL未指定時はstdoutのみ。失敗しても落とさない。
notify_to() {
  local url="$1" msg="$2"
  echo "[notify] $msg"
  [ -z "$url" ] && return 0
  local payload
  payload=$(python3 -c 'import json,sys; print(json.dumps({"content": sys.argv[1][:1900]}, ensure_ascii=False))' "$msg")
  curl -sS -o /dev/null --max-time 20 -X POST -H 'Content-Type: application/json' \
    -d "$payload" "$url" || echo "[notify] webhook post failed"
}

# 後方互換: #ops-alerts (OPS_WEBHOOK_URL) へ送る従来インターフェース。
notify() { notify_to "${OPS_WEBHOOK_URL:-}" "$1"; }
```

- [ ] **Step 3: 構文チェックと動作確認（URL空でcurlを呼ばない）**

Run:
```bash
bash -n ops/lib/common.sh && \
( unset OPS_WEBHOOK_URL; . ops/lib/common.sh; notify "hello" ; notify_to "" "world" )
```
Expected: `[notify] hello` と `[notify] world` が各1回だけ出る（curl は走らず、エラーも出ない）。

- [ ] **Step 4: コミット**

```bash
git add ops/lib/common.sh
git commit -m "feat(ops): generalize notify() into notify_to(url,msg) for multiple channels"
```

---

### Task 2: dev-digest.sh — 決定論ダイジェストの土台

**Files:**
- Create: `ops/dev-digest.sh`
- Test: `/tmp/dd-fixture/TASKS.md`（検証用フィクスチャ、コミットしない）

**Interfaces:**
- Consumes: `notify_to`（Task 1）、`$OPS_HOME`（common.sh 由来）
- Produces: `ops/dev-digest.sh` 実行体。引数なしで決定論ダイジェストを組み立て `DEV_DIGEST_WEBHOOK_URL` へ投稿。`--dry-run` で投稿せず stdout 出力。環境変数の seam: `DIGEST_REPO`（repo参照元の上書き）。副作用: `$OPS_HOME/state/dev-digest/tasks-prev.md`（スナップショット）と `last-run`（epoch）を更新。

- [ ] **Step 1: 検証用フィクスチャを作る**

Run:
```bash
mkdir -p /tmp/dd-fixture && cat > /tmp/dd-fixture/TASKS.md <<'EOF'
# TASKS

## P0: バグ修正

- [x] **修正済みのやつ**

## P4: 収益化

- [ ] **entitlement実装**（設計済み）
- [ ] **パス型決済**
- [ ] **統計・スヌーズ**
- [ ] **Chrome申請**
- [~] **進行中の何か**

## P5: v2.0.0

- [ ] RNセットアップ
- [ ] LETUS収集
- [ ] CLASS収集
EOF
echo OK
```
Expected: `OK`。未着手6・進行中1・完了1の構成。

- [ ] **Step 2: dev-digest.sh を作成（決定論の土台のみ）**

Create `ops/dev-digest.sh`:

```bash
#!/usr/bin/env bash
# ops/dev-digest.sh — 朝の開発ダイジェスト（決定論の土台＋任意のLLM要約レイヤー）
# 設計の正: docs/superpowers/specs/2026-07-05-dev-digest-design.md
# run.sh 経由実行時、スクリプト自身は temp コピーなので repo は CI クローンを参照する。
set -u
. "$(dirname "$(readlink -f "$0")")/lib/common.sh"

CI="${DIGEST_REPO:-$OPS_HOME/ci/lms-task-watcher}"
TASKS="$CI/TASKS.md"
STATE="$OPS_HOME/state/dev-digest"
mkdir -p "$STATE"
PREV="$STATE/tasks-prev.md"
LASTRUN="$STATE/last-run"

# 今日ラベル "7/6(月)"
_dow=(月 火 水 木 金 土 日)
TODAY="$(date +%-m/%-d)(${_dow[$(( $(date +%u) - 1 ))]})"

# 決定論ダイジェスト本文を組み立てて stdout に出す。
build_deterministic() {
  if [ ! -f "$TASKS" ]; then
    echo "📋 開発ダイジェスト $TODAY"
    echo "⚠ TASKS.md が見つかりません（$TASKS）"
    return 0
  fi

  # コミット: last-run 以降（無ければ24h前）から origin/develop の件名
  local since
  since="$(cat "$LASTRUN" 2>/dev/null || echo $(( $(date +%s) - 86400 )))"
  local commits_file
  commits_file="$(mktemp)"
  git -C "$CI" log --since=@"$since" --pretty=%s > "$commits_file" 2>/dev/null || true

  # 自走タスク: task.sh list の TMUX 列が alive の行数
  local running=0
  if [ -x "$CI/ops/task.sh" ]; then
    running="$("$CI/ops/task.sh" list 2>/dev/null | awk 'NR>1 && $3=="alive"{c++} END{print c+0}')"
  fi

  python3 - "$TASKS" "$PREV" "$TODAY" "$running" < "$commits_file" <<'PY'
import json, sys, re, os

tasks_path, prev_path, today, running = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
commit_subjects = [l.rstrip("\n") for l in sys.stdin if l.strip()]

def parse(path):
    out, heading = [], ""
    if not path or not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8"):
        if line.startswith("## "):
            heading = re.split(r"[（(]", line[3:].strip())[0].strip()
            continue
        m = re.match(r"^\s*- \[([ x~])\]\s*(.*)", line)
        if m:
            title = m.group(2).replace("**", "").strip()
            title = re.split(r"\s*[（(]", title)[0].strip()[:40]
            out.append((heading, m.group(1), title))
    return out

cur, prev = parse(tasks_path), parse(prev_path)
unstarted = [t for t in cur if t[1] == " "]
in_prog   = [t for t in cur if t[1] == "~"]
incomplete = [t for t in cur if t[1] in (" ", "~")]

headings = []
for h, _, title in incomplete:
    if not headings or headings[-1][0] != h:
        headings.append((h, []))
    headings[-1][1].append(title)

prev_incomplete = {t[2] for t in prev if t[1] in (" ", "~")}
cur_done = {t[2] for t in cur if t[1] == "x"}
completed = sorted(prev_incomplete & cur_done)
have_prev = bool(prev)

nxt = incomplete[0][2] if incomplete else "（なし）"

lines = [f"📋 開発ダイジェスト {today}",
         f"残: 未着手{len(unstarted)} / 進行中{len(in_prog)}"]
for h, titles in headings:
    shown = titles[:4]
    extra = len(titles) - len(shown)
    tail = f" ほか{extra}件" if extra > 0 else ""
    lines.append(f"  {(h or 'その他')[:16]}: " + " / ".join(shown) + tail)

csub = commit_subjects[:3]
cnote = "（" + "、".join(s[:20] for s in csub) + "）" if csub else ""
done_str = f"✅完了{len(completed)}" if have_prev else "✅完了—"
lines.append(f"昨日: {done_str}  📝コミット{len(commit_subjects)}件{cnote}  🔧自走{running}")
lines.append(f"次の候補: {nxt}")
print("\n".join(lines))
PY

  rm -f "$commits_file"
}

main() {
  local dry=0
  [ "${1:-}" = "--dry-run" ] && dry=1

  local msg
  msg="$(build_deterministic)"

  if [ "$dry" -eq 1 ]; then
    printf '%s\n' "$msg"
  else
    notify_to "${DEV_DIGEST_WEBHOOK_URL:-}" "$msg"
  fi

  # スナップショットと実行時刻を更新（次回の完了差分・コミット範囲の基準）
  [ -f "$TASKS" ] && cp "$TASKS" "$PREV"
  date +%s > "$LASTRUN"
}

main "$@"
```

- [ ] **Step 3: 実行権限＋構文チェック**

Run: `chmod +x ops/dev-digest.sh && bash -n ops/dev-digest.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 4: 初回 dry-run（prev無し → 完了は「—」）**

Run:
```bash
rm -rf /tmp/dd-state && \
OPS_HOME=/tmp/dd-state DIGEST_REPO=/tmp/dd-fixture ops/dev-digest.sh --dry-run
```
Expected: 次のような出力。`残: 未着手7 / 進行中1`、収益化とv2.0.0の見出し行（収益化配下の未完は entitlement実装/パス型決済/統計・スヌーズ/Chrome申請/進行中の何か の5件なので先頭4件＋「ほか1件」、v2.0.0は3件）、`昨日: ✅完了—`、`次の候補: entitlement実装`。`/tmp/dd-state/state/dev-digest/tasks-prev.md` が作られる。

- [ ] **Step 5: 完了差分の検証（prevを1つ未完にして再実行）**

Run:
```bash
sed 's/- \[x\] \*\*修正済みのやつ\*\*/- [ ] **修正済みのやつ**/' /tmp/dd-fixture/TASKS.md > /tmp/dd-state/state/dev-digest/tasks-prev.md && \
OPS_HOME=/tmp/dd-state DIGEST_REPO=/tmp/dd-fixture ops/dev-digest.sh --dry-run | grep 昨日
```
Expected: `昨日: ✅完了1 ...`（prevで未完・curで `[x]` の「修正済みのやつ」が完了として拾われる）。

- [ ] **Step 6: webhook未設定でも投稿せず落ちないことを確認**

Run: `OPS_HOME=/tmp/dd-state DIGEST_REPO=/tmp/dd-fixture ops/dev-digest.sh; echo "exit=$?"`
Expected: `[notify] 📋 開発ダイジェスト ...`（複数行）が出て `exit=0`。curl は走らない（`DEV_DIGEST_WEBHOOK_URL` 未設定）。

- [ ] **Step 7: コミット**

```bash
git add ops/dev-digest.sh
git commit -m "feat(ops): add dev-digest.sh deterministic morning digest (remaining tasks + yesterday's progress)"
```

---

### Task 3: LLM要約レイヤー（台帳・予算サーキットブレーカー・API呼び出し）

**Files:**
- Modify: `ops/dev-digest.sh`（LLM層を追加し `main` から呼ぶ）

**Interfaces:**
- Consumes: Task 2 の `build_deterministic` 出力（`$msg`）、`$STATE`、`$CI`
- Produces: `llm_layer <deterministic_msg>` — 追記すべき0〜2行を stdout に出す（成功時 `🧠 要約:` と `📊 AI消費:`、停止/予算到達時は注記1行、無効/失敗時は空）。副作用: `$STATE/token-ledger.jsonl` への追記、`$STATE/llm-disabled`（キルスイッチ）の作成。環境seam: `DIGEST_LLM_STUB`（APIを呼ばずこのファイルの中身を応答JSONとして使う）。

- [ ] **Step 1: LLM層の関数群を追加**

`ops/dev-digest.sh` の `main() {` の直前に、以下の関数群を挿入する:

```bash
LEDGER="$STATE/token-ledger.jsonl"
KILL="$STATE/llm-disabled"
LLM_MODEL="claude-haiku-4-5"
LLM_SYSTEM="あなたは開発ダイジェストの要約役です。渡された箇条書きを読み、開発者向けに日本語1〜2文で『昨日の要点と次に注目すべき点』だけを述べてください。箇条書きの数値をそのまま繰り返さない。前置き・見出し・記号装飾は不要。"

# 今月（YYYY-MM）の累計コスト(USD)を台帳から合算して出力。
month_cost() {
  python3 -c '
import json,sys
ym=sys.argv[1]; total=0.0
try:
  for line in open(sys.argv[2]):
    line=line.strip()
    if not line: continue
    d=json.loads(line)
    if str(d.get("date","")).startswith(ym): total+=float(d.get("cost_usd",0))
except FileNotFoundError: pass
print(f"{total:.4f}")
' "$(date +%Y-%m)" "$LEDGER"
}

# 生のAPI応答JSONを stdout に返す。DIGEST_LLM_STUB があればそのファイルを返す（テスト用）。
# stdin: ユーザーメッセージ（決定論ダイジェスト）
llm_raw_response() {
  if [ -n "${DIGEST_LLM_STUB:-}" ]; then
    cat "$DIGEST_LLM_STUB"
    return 0
  fi
  local body
  body="$(python3 -c 'import json,sys; print(json.dumps({"model":sys.argv[1],"max_tokens":300,"system":sys.argv[2],"messages":[{"role":"user","content":sys.stdin.read()}]}))' "$LLM_MODEL" "$LLM_SYSTEM")"
  curl -sS --max-time 30 https://api.anthropic.com/v1/messages \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d "$body"
}

# LLM層。追記すべき行を stdout に出す（0〜2行）。副作用: 台帳追記・キルスイッチ作成。
llm_layer() {
  local det="$1"
  [ "${DIGEST_LLM_ENABLED:-}" = "1" ] || return 0
  [ -n "${ANTHROPIC_API_KEY:-}" ] || return 0
  if [ -f "$KILL" ]; then
    echo "🧠 要約: 自動停止中（再開は llm-disabled を削除）"
    return 0
  fi
  local budget="${DIGEST_MONTHLY_BUDGET_USD:-0.50}"
  local mc; mc="$(month_cost)"
  if awk "BEGIN{exit !($mc >= $budget)}"; then
    : > "$KILL"
    echo "🧠 要約: 今月の予算\$$budget に到達し停止（再開は llm-disabled を削除）"
    return 0
  fi

  local resp
  resp="$(printf '%s' "$det" | llm_raw_response)" || return 0

  # 応答から text / usage / stop_reason を取り出す。パース失敗・refusal・空なら何も追記しない。
  local parsed
  parsed="$(printf '%s' "$resp" | python3 -c '
import json,sys
try:
  d=json.load(sys.stdin)
except Exception:
  sys.exit(1)
if d.get("stop_reason")=="refusal": sys.exit(1)
text="".join(b.get("text","") for b in d.get("content",[]) if b.get("type")=="text").strip()
u=d.get("usage",{})
i=int(u.get("input_tokens",0)); o=int(u.get("output_tokens",0))
if not text: sys.exit(1)
cost=i/1e6*1 + o/1e6*5
print(json.dumps({"text":text,"in":i,"out":o,"cost":round(cost,6)}, ensure_ascii=False))
')" || return 0

  local text tin tout cost
  text="$(printf '%s' "$parsed" | python3 -c 'import json,sys;print(json.load(sys.stdin)["text"])')"
  tin="$(printf '%s' "$parsed" | python3 -c 'import json,sys;print(json.load(sys.stdin)["in"])')"
  tout="$(printf '%s' "$parsed" | python3 -c 'import json,sys;print(json.load(sys.stdin)["out"])')"
  cost="$(printf '%s' "$parsed" | python3 -c 'import json,sys;print(json.load(sys.stdin)["cost"])')"

  # 台帳に実測usageを追記
  printf '{"date":"%s","model":"%s","input":%s,"output":%s,"cost_usd":%s}\n' \
    "$(date +%F)" "$LLM_MODEL" "$tin" "$tout" "$cost" >> "$LEDGER"

  # 追記後の今月累計と割合
  local mc2 pct
  mc2="$(month_cost)"
  pct="$(awk "BEGIN{printf \"%d\", ($mc2/$budget)*100}")"

  echo "🧠 要約: $text"
  echo "📊 AI消費: 今月 \$$mc2/\$$budget (${pct}%) ・ 今日 $(( tin + tout )) tokens"

  # 追記後に予算超過していたら翌日から止める
  if awk "BEGIN{exit !($mc2 >= $budget)}"; then : > "$KILL"; fi
}
```

- [ ] **Step 2: main に LLM層を組み込む**

`ops/dev-digest.sh` の `main()` を、決定論メッセージにLLM行を足す形に変更する。既存の

```bash
  local msg
  msg="$(build_deterministic)"
```

の直後に、次を挿入する:

```bash
  local llm_lines
  llm_lines="$(llm_layer "$msg")"
  if [ -n "$llm_lines" ]; then
    msg="$msg"$'\n'"$llm_lines"
  fi
```

- [ ] **Step 3: 構文チェック**

Run: `bash -n ops/dev-digest.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 4: スタブでLLM成功パスを検証（台帳に記録され行が付く）**

Run:
```bash
cat > /tmp/dd-resp.json <<'EOF'
{"stop_reason":"end_turn","content":[{"type":"text","text":"昨日はops基盤を仕上げた。次はentitlement実装が本丸。"}],"usage":{"input_tokens":6000,"output_tokens":180}}
EOF
rm -f /tmp/dd-state/state/dev-digest/token-ledger.jsonl /tmp/dd-state/state/dev-digest/llm-disabled
OPS_HOME=/tmp/dd-state DIGEST_REPO=/tmp/dd-fixture \
  DIGEST_LLM_ENABLED=1 ANTHROPIC_API_KEY=dummy DIGEST_LLM_STUB=/tmp/dd-resp.json \
  ops/dev-digest.sh --dry-run | tail -3
echo "--- ledger ---"; cat /tmp/dd-state/state/dev-digest/token-ledger.jsonl
```
Expected: 末尾に `🧠 要約: 昨日はops基盤...` と `📊 AI消費: 今月 $0.0015/$0.50 (0%) ・ 今日 6180 tokens`。台帳に `{"date":...,"input":6000,"output":180,"cost_usd":0.0015}` が1行。

- [ ] **Step 5: サーキットブレーカーを検証（予算超の台帳 → スキップ＋killスイッチ）**

Run:
```bash
printf '{"date":"%s","model":"claude-haiku-4-5","input":700000,"output":0,"cost_usd":0.70}\n' "$(date +%F)" \
  > /tmp/dd-state/state/dev-digest/token-ledger.jsonl
rm -f /tmp/dd-state/state/dev-digest/llm-disabled
OPS_HOME=/tmp/dd-state DIGEST_REPO=/tmp/dd-fixture \
  DIGEST_LLM_ENABLED=1 ANTHROPIC_API_KEY=dummy DIGEST_LLM_STUB=/tmp/dd-resp.json \
  ops/dev-digest.sh --dry-run | tail -1
test -f /tmp/dd-state/state/dev-digest/llm-disabled && echo "KILL_CREATED"
```
Expected: `🧠 要約: 今月の予算$0.50 に到達し停止（再開は llm-disabled を削除）` と `KILL_CREATED`。API（スタブ）は呼ばれない。

- [ ] **Step 6: killスイッチ存在時はスキップ注記になることを確認**

Run:
```bash
: > /tmp/dd-state/state/dev-digest/llm-disabled
OPS_HOME=/tmp/dd-state DIGEST_REPO=/tmp/dd-fixture \
  DIGEST_LLM_ENABLED=1 ANTHROPIC_API_KEY=dummy DIGEST_LLM_STUB=/tmp/dd-resp.json \
  ops/dev-digest.sh --dry-run | tail -1
```
Expected: `🧠 要約: 自動停止中（再開は llm-disabled を削除）`

- [ ] **Step 7: LLM無効時は決定論のみ（🧠/📊 行なし）を確認**

Run:
```bash
rm -f /tmp/dd-state/state/dev-digest/llm-disabled
OPS_HOME=/tmp/dd-state DIGEST_REPO=/tmp/dd-fixture ops/dev-digest.sh --dry-run | grep -c '🧠\|📊' || true
```
Expected: `0`（`DIGEST_LLM_ENABLED` 未設定なので要約行は出ない）。

- [ ] **Step 8: コミット**

```bash
git add ops/dev-digest.sh
git commit -m "feat(ops): add metered LLM summary layer to dev-digest (Haiku, token ledger, monthly-budget circuit breaker)"
```

---

### Task 4: `--usage` サブコマンド（数日ぶんの消費を確認）

**Files:**
- Modify: `ops/dev-digest.sh`（`main` に `--usage` 分岐と `cmd_usage` を追加）

**Interfaces:**
- Consumes: `$LEDGER`、`month_cost`（Task 3）
- Produces: `dev-digest.sh --usage [日数]`（既定14）— 台帳から直近N日を日付・トークン・コストで一覧し、今月累計と予算残を表示。投稿はしない。

- [ ] **Step 1: cmd_usage を追加**

`ops/dev-digest.sh` の `main()` 定義の直前に挿入:

```bash
# 台帳から直近N日ぶんの消費を一覧表示する（投稿しない）。
cmd_usage() {
  local days="${1:-14}"
  local budget="${DIGEST_MONTHLY_BUDGET_USD:-0.50}"
  echo "AI消費（直近 ${days} 日 / 台帳: $LEDGER）"
  python3 - "$LEDGER" "$days" <<'PY'
import json,sys,os,datetime
ledger, days = sys.argv[1], int(sys.argv[2])
cutoff = (datetime.date.today() - datetime.timedelta(days=days-1)).isoformat()
rows = {}
if os.path.exists(ledger):
    for line in open(ledger):
        line=line.strip()
        if not line: continue
        try: d=json.loads(line)
        except Exception: continue
        dt=str(d.get("date",""))
        if dt < cutoff: continue
        r=rows.setdefault(dt,{"in":0,"out":0,"cost":0.0})
        r["in"]+=int(d.get("input",0)); r["out"]+=int(d.get("output",0)); r["cost"]+=float(d.get("cost_usd",0))
for dt in sorted(rows):
    r=rows[dt]
    print(f"  {dt}  in {r['in']:>7}  out {r['out']:>5}  ${r['cost']:.4f}")
if not rows:
    print("  （記録なし）")
PY
  local mc; mc="$(month_cost)"
  local rem; rem="$(awk "BEGIN{printf \"%.4f\", $budget-$mc}")"
  echo "今月累計: \$$mc / 予算 \$$budget（残 \$$rem）"
}
```

- [ ] **Step 2: main に --usage 分岐を追加**

`main()` の先頭（`local dry=0` の行の前）に挿入:

```bash
  if [ "${1:-}" = "--usage" ]; then
    cmd_usage "${2:-14}"
    return 0
  fi
```

- [ ] **Step 3: 構文チェック**

Run: `bash -n ops/dev-digest.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 4: --usage の出力を検証**

Run:
```bash
cat > /tmp/dd-state/state/dev-digest/token-ledger.jsonl <<EOF
{"date":"$(date +%F)","model":"claude-haiku-4-5","input":6000,"output":180,"cost_usd":0.0015}
{"date":"$(date +%F)","model":"claude-haiku-4-5","input":5000,"output":150,"cost_usd":0.0013}
EOF
OPS_HOME=/tmp/dd-state DIGEST_REPO=/tmp/dd-fixture ops/dev-digest.sh --usage 7
```
Expected: 当日の行が1行に集約（in 11000 out 330 相当）で表示され、`今月累計: $0.00xx / 予算 $0.50（残 $0.49xx）` が出る。

- [ ] **Step 5: コミット**

```bash
git add ops/dev-digest.sh
git commit -m "feat(ops): add dev-digest --usage to review recent AI token spend"
```

---

### Task 5: README 追記・スケジューラ手順・総仕上げ

**Files:**
- Modify: `ops/README.md`（dev-digest のセクションと ops.env 追記例・スケジューラ登録を記載）

**Interfaces:**
- Consumes: これまでの全タスク
- Produces: 運用手順のドキュメント。実行体の変更はなし

- [ ] **Step 1: README に dev-digest セクションを追記**

`ops/README.md` の末尾（`## 設計方針` セクションの後）に、以下を追記する:

````markdown
## 開発ダイジェスト（`dev-digest.sh`）

毎朝1通、残タスク（TASKS.md）と前日の進捗（コミット・完了タスク・自走タスク）を
専用チャンネル #dev-digest に投稿する。土台は決定論（トークンゼロ）。その上に
任意のLLM要約1行を、予算・計測・自動停止のガード付きで重ねられる。

### ops.env に追記する設定（すべて任意）

```bash
# 投稿先（未設定なら投稿せずログのみ。#ops-alerts にはフォールバックしない）
DEV_DIGEST_WEBHOOK_URL='https://discord.com/api/webhooks/...'   # #dev-digest のwebhook

# --- 以下はLLM要約レイヤーを使う場合のみ（未設定なら決定論ダイジェストだけ届く）---
DIGEST_LLM_ENABLED=1                     # 1 で有効化（キー追加だけでは動かない二重の明示）
ANTHROPIC_API_KEY='sk-ant-...'           # Anthropic Console のAPIキー。Max x5とは別のAPI従量課金
DIGEST_MONTHLY_BUDGET_USD=0.50           # 月予算。到達すると自動停止（既定 0.50）
```

### 消費の確認・自動停止からの再開

```bash
~/ops/ci/lms-task-watcher/ops/dev-digest.sh --usage      # 直近14日の消費と今月累計・予算残
```

予算到達で自動停止すると `~/ops/state/dev-digest/llm-disabled` が作られ、以降は
決定論ダイジェストだけになる。再開は `rm ~/ops/state/dev-digest/llm-disabled`。

### スケジュール登録（Windowsタスクスケジューラ）

```cmd
schtasks /create /f /tn LMS-DevDigest /sc daily /st 07:15 /tr "wsl.exe -d Ubuntu -u ysou5 -- /home/ysou5/ops/run.sh dev-digest"
```

（raspi-health 07:00 と canary 07:30 の間。デプロイは origin/develop に push するだけ。）
````

- [ ] **Step 2: 構成表に注記（定期実行だが監視ではない旨）**

`ops/README.md` 冒頭の構成表（`| スクリプト | 実行 | 内容 | 通知 |` の表）に、次の行を追加する:

```markdown
| `dev-digest.sh` | 毎日 07:15 | 残タスク＋前日進捗の朝サマリー（任意でLLM要約1行） | 毎回1通（#dev-digest） |
```

- [ ] **Step 3: リポジトリ本体を壊していないことを確認**

Run: `bash -n ops/dev-digest.sh && bash -n ops/lib/common.sh && echo ALL_SYNTAX_OK`
Expected: `ALL_SYNTAX_OK`
（`ops/` 配下のみの変更で src/api/ビルドには触れないため pnpm ビルドは不要。触っていたら `pnpm build && pnpm test` を実行すること。）

- [ ] **Step 4: 決定論一巡の最終確認（実データCIクローンがある環境で）**

Run:
```bash
ls "$HOME/ops/ci/lms-task-watcher/TASKS.md" >/dev/null 2>&1 && \
  "$HOME/ops/ci/lms-task-watcher/ops/dev-digest.sh" --dry-run || \
  echo "CIクローン未整備の環境ではフィクスチャ検証(Task2-4)で代替済み"
```
Expected: 実 TASKS.md に基づく決定論ダイジェストが表示される（またはスキップ注記）。

- [ ] **Step 5: コミット**

```bash
git add ops/README.md
git commit -m "docs(ops): document dev-digest.sh (setup, budget/circuit-breaker, scheduler)"
```

- [ ] **Step 6: 停止（レビュー待ち）**

push・マージ・スケジューラ登録・APIキー発行・webhook作成はしない。人間のレビューを待つ。
完了時に「dev-digest 実装完了・全検証通過・pushしていない」と通知する（task.sh notify を使える環境なら
`ops/task.sh notify <name> "..."`、無ければ手順どおりの手動通知）。

---

## 受け入れ条件（全て満たすこと）

1. `notify_to` が URL 空で curl を呼ばず落ちない。`notify` が後方互換で動く
2. 決定論ダイジェストが未着手/進行中の件数・見出し別一覧・次の候補を正しく出す（フィクスチャで確認済み）
3. 完了差分がスナップショット比較で `[ ]/[~]→[x]` を拾う
4. `DEV_DIGEST_WEBHOOK_URL` 未設定で投稿せずログのみ・exit 0
5. LLM層: スタブ成功で 🧠/📊 行が付き、台帳に実測 usage が記録される
6. サーキットブレーカー: 予算超の台帳で LLM がスキップされ `llm-disabled` が作られる
7. `DIGEST_LLM_ENABLED` 未設定 / `ANTHROPIC_API_KEY` 未設定で LLM 層が完全にオフ
8. `--usage` が直近N日と今月累計・予算残を表示する
9. `bash -n` が全スクリプトで通る
10. コミットが論理単位で分かれ、どれも push されていない
