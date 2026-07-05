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

main() {
  local dry=0
  [ "${1:-}" = "--dry-run" ] && dry=1

  local msg
  msg="$(build_deterministic)"

  local llm_lines
  llm_lines="$(llm_layer "$msg")"
  if [ -n "$llm_lines" ]; then
    msg="$msg"$'\n'"$llm_lines"
  fi

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
