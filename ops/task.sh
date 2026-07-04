#!/usr/bin/env bash
# ops/task.sh — 自走タスクランチャーCLI
#
# 長時間タスクをデスクトップ（WSL2）のClaude Codeに自走させる際の
# worktree / tmux / hooks / 通知 のライフサイクルを1本のCLIに統合する。
# 「1タスク=1worktree=1tmux」の並列隔離規約をツールが強制する。
#
# 設計の正: docs/superpowers/specs/2026-07-05-task-runner-cli-design.md
# 既存の定期監視スクリプト群（nightly.sh 等）とは独立。都度呼び出し。
set -euo pipefail

OPS_HOME="${OPS_HOME:-$HOME/ops}"
STATE_ROOT="$OPS_HOME/state"

# webhook URL等の秘密情報はリポジトリ外の ~/ops/ops.env に置く。無くても落ちない。
# shellcheck disable=SC1091
[ -f "$OPS_HOME/ops.env" ] && . "$OPS_HOME/ops.env"

die() { echo "task.sh: $*" >&2; exit 1; }

# タスク名検証: 小文字英数字とハイフンのみ。大文字・スペース・パス区切り(../等)を拒否。
validate_name() {
  local name="${1:-}"
  [ -n "$name" ] || die "タスク名が空です"
  case "$name" in
    *[!a-z0-9-]*) die "不正なタスク名 '$name'（許可: [a-z0-9-] のみ）" ;;
  esac
}

# Discord webhookへ1メッセージPOST。未設定・POST失敗でも本体処理は失敗させない（ログのみ）。
# 送信先は TASK_WEBHOOK_URL、無ければ OPS_WEBHOOK_URL（#ops-alerts）にフォールバック。
post_webhook() {
  local msg="$1"
  local url="${TASK_WEBHOOK_URL:-${OPS_WEBHOOK_URL:-}}"
  if [ -z "$url" ]; then
    echo "[task.sh] webhook未設定（通知スキップ）: $msg"
    return 0
  fi
  local payload
  payload=$(python3 -c 'import json,sys; print(json.dumps({"content": sys.argv[1][:1900]}, ensure_ascii=False))' "$msg") \
    || { echo "[task.sh] payload生成失敗（通知スキップ）"; return 0; }
  curl -sS -o /dev/null --max-time 10 -X POST -H 'Content-Type: application/json' \
    -d "$payload" "$url" || echo "[task.sh] webhook POST失敗（無視）"
  return 0
}

# notify: 節目・完了・停止時の任意メッセージをwebhookへ流す（プラン規約C / ドッグフーディング用）。
cmd_notify() {
  local name="${1:-}"
  [ -n "$name" ] || die "notify: 使い方 task.sh notify <name> <message...>"
  shift
  validate_name "$name"
  local msg="$*"
  [ -n "$msg" ] || die "notify: メッセージが空です"
  post_webhook "🔧 [task/$name] $msg"
}

# event: hooksから呼ばれる機械イベント。同種イベントは前回通知から10分以内なら送らない。
# 状態は ~/ops/state/task-<name>/last-<type> にepoch秒で保持する。
cmd_event() {
  local name="${1:-}" type="${2:-}"
  validate_name "$name"
  local msg
  case "$type" in
    stop)      msg="⏹ [task/$name] 応答完了（完了または次の指示待ちの可能性）" ;;
    attention) msg="⚠ [task/$name] 要対応（許可待ち/アイドル）" ;;
    *)         die "event: 不明なイベント種別 '$type'（stop|attention）" ;;
  esac
  local dir="$STATE_ROOT/task-$name"
  mkdir -p "$dir"
  local last_file="$dir/last-$type" now last
  now=$(date +%s)
  if [ -f "$last_file" ]; then
    last=$(cat "$last_file" 2>/dev/null || echo 0)
    if [ $((now - last)) -lt 600 ]; then
      echo "[task.sh] event $type: スロットリング中（前回から$((now - last))秒、10分未満のためスキップ）"
      return 0
    fi
  fi
  echo "$now" > "$last_file"
  post_webhook "$msg"
}

usage() {
  cat <<'EOF'
task.sh — 自走タスクランチャーCLI（1タスク=1worktree=1tmux）

使い方:
  task.sh dispatch <name> <plan-file> [--base <ref>] [--no-claude]
  task.sh list
  task.sh status [<name>]
  task.sh peek <name> [-n <行数>]
  task.sh collect <name>
  task.sh notify <name> <message...>
  task.sh event <name> <stop|attention>   # hooksから呼ばれる内部用
  task.sh clean <name> [--force]
EOF
}

main() {
  local cmd="${1:-}"
  [ $# -gt 0 ] && shift
  case "$cmd" in
    notify)          cmd_notify "$@" ;;
    event)           cmd_event "$@" ;;
    ""|-h|--help|help) usage ;;
    *)               usage >&2; die "不明なサブコマンド '$cmd'" ;;
  esac
}

main "$@"
