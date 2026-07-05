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
