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

# このスクリプト自身が属するリポジトリのルート（cwdに依存せず git 操作するため）。
SCRIPT_PATH="$(readlink -f "$0")"
REPO_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd)"

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

# dispatch: worktree + branch + hooks + state + tmux/claude を一括セットアップして自走を開始する。
cmd_dispatch() {
  local name="" plan="" base="origin/develop" no_claude=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --base)      base="${2:-}"; [ -n "$base" ] || die "--base に値が必要です"; shift 2 ;;
      --no-claude) no_claude=1; shift ;;
      -*)          die "dispatch: 不明なオプション '$1'" ;;
      *)
        if [ -z "$name" ]; then name="$1"
        elif [ -z "$plan" ]; then plan="$1"
        else die "dispatch: 余分な引数 '$1'"; fi
        shift ;;
    esac
  done
  [ -n "$name" ] && [ -n "$plan" ] \
    || die "使い方: task.sh dispatch <name> <plan-file> [--base <ref>] [--no-claude]"
  validate_name "$name"
  [ -f "$plan" ] || die "dispatch: プランファイルが見つかりません: $plan"
  plan="$(readlink -f "$plan")"

  local dir="$STATE_ROOT/task-$name"
  local wt="$HOME/dev/wt-$name"
  [ -e "$dir" ] && die "既にタスク '$name' が存在します（$dir）。clean 後に再実行してください"
  [ -e "$wt" ] && die "worktreeパスが既に存在します: $wt"
  git -C "$REPO_DIR" show-ref --verify --quiet "refs/heads/task/$name" \
    && die "ブランチ 'task/$name' が既に存在します"

  echo "[task.sh] git fetch origin ..."
  git -C "$REPO_DIR" fetch origin --quiet || die "git fetch origin に失敗しました"
  echo "[task.sh] worktree作成: $wt （task/$name ← $base）"
  git -C "$REPO_DIR" worktree add "$wt" -b "task/$name" "$base" \
    || die "worktree作成に失敗しました（base '$base' は有効なref？）"

  cp "$plan" "$wt/TASK_PLAN.md"

  # hooks: このworktree内の task.sh を絶対パスで指す（worktreeはbase起点なので存在する前提）。
  mkdir -p "$wt/.claude"
  cat > "$wt/.claude/settings.local.json" <<EOF
{
  "hooks": {
    "Stop": [{"hooks": [{"type": "command", "command": "$wt/ops/task.sh event $name stop"}]}],
    "Notification": [{"hooks": [{"type": "command", "command": "$wt/ops/task.sh event $name attention"}]}]
  }
}
EOF

  mkdir -p "$dir"
  cat > "$dir/meta.json" <<EOF
{
  "name": "$name",
  "branch": "task/$name",
  "base": "$base",
  "worktree": "$wt",
  "started_at": "$(date -Iseconds)"
}
EOF

  local prompt_file="$dir/prompt.txt"
  cat > "$prompt_file" <<EOF
TASK_PLAN.md を読み、そこに書かれたタスクを自走で最後まで実行せよ。

ガードレール（厳守）:
- git push 禁止。コミットはこのworktreeのブランチ task/$name 上のローカルのみ。
- ラズパイへのSSH・外部デプロイ・pm2操作 禁止。
- main および develop ブランチへの直接操作 禁止。
- 完了を宣言する前に build / lint / test を実行して検証すること。
- 節目（フェーズ完了）と最終完了時、および判断に迷って停止する時は必ず
  ops/task.sh notify $name "<メッセージ>" を実行して進捗を通知すること。
- TASK_PLAN.md に書かれていない破壊的操作はしない。
EOF

  if [ "$no_claude" -eq 1 ]; then
    echo "[task.sh] --no-claude: tmux/claudeの起動はスキップ（セットアップのみ完了）"
    echo "[task.sh]   手動起動: tmux new-session -s task-$name -c $wt"
  else
    local claude_cmd="${TASK_CLAUDE_CMD:-claude}"
    tmux new-session -d -s "task-$name" -c "$wt" \
      || die "tmuxセッション作成に失敗しました（task-$name）"
    # 引用符事故を避けるためプロンプトは一時ファイル経由で渡す。
    tmux send-keys -t "task-$name" \
      "$claude_cmd --dangerously-skip-permissions \"\$(cat '$prompt_file')\"" C-m
    echo "[task.sh] tmuxセッション task-$name で $claude_cmd を起動しました"
  fi

  post_webhook "🔧 [task/$name] dispatch完了: $wt（base $base）$([ "$no_claude" -eq 1 ] && echo ' / --no-claude' || echo '')"
  echo "[task.sh] dispatch完了: task/$name"
}

# ---- 状態参照ヘルパー ----

require_task() {
  local name="${1:-}"
  validate_name "$name"
  [ -d "$STATE_ROOT/task-$name" ] || die "タスク '$name' は存在しません（list で確認）"
}

# meta.json のフィールドを1つ取得（jq無し・python3使用、失敗時は空）。
meta_field() {
  python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get(sys.argv[2],""))
except Exception: print("")' "$1" "$2"
}

tmux_alive() { tmux has-session -t "task-$1" 2>/dev/null && echo alive || echo dead; }

# started_at（ISO8601）からの経過を人間可読で返す。
fmt_elapsed() {
  local start="$1" now s d
  now=$(date +%s)
  s=$(date -d "$start" +%s 2>/dev/null) || { echo "?"; return; }
  d=$((now - s))
  if   [ "$d" -lt 60 ];    then echo "${d}s"
  elif [ "$d" -lt 3600 ];  then echo "$((d/60))m"
  elif [ "$d" -lt 86400 ]; then echo "$((d/3600))h$(((d%3600)/60))m"
  else echo "$((d/86400))d$(((d%86400)/3600))h"; fi
}

# list: state配下の全タスクを1行ずつ（tmux生存・経過時間・ブランチ）。
cmd_list() {
  local found=0 d name meta branch wt start
  printf '%-16s %-20s %-6s %-8s %s\n' NAME BRANCH TMUX ELAPSED WORKTREE
  for d in "$STATE_ROOT"/task-*/; do
    [ -d "$d" ] || continue
    found=1
    name="$(basename "$d")"; name="${name#task-}"
    meta="${d}meta.json"
    branch="$(meta_field "$meta" branch)"
    wt="$(meta_field "$meta" worktree)"
    start="$(meta_field "$meta" started_at)"
    printf '%-16s %-20s %-6s %-8s %s\n' \
      "$name" "${branch:-?}" "$(tmux_alive "$name")" "$(fmt_elapsed "$start")" "${wt:-?}"
  done
  if [ "$found" -eq 0 ]; then echo "（アクティブなタスクなし）"; fi
}

# status: 引数なしなら list。名前ありなら meta＋tmux生存＋コミット数＋git status要約＋直近イベント。
cmd_status() {
  local name="${1:-}"
  [ -z "$name" ] && { cmd_list; return; }
  require_task "$name"
  local d="$STATE_ROOT/task-$name" meta branch base wt start
  meta="$d/meta.json"
  branch="$(meta_field "$meta" branch)"; base="$(meta_field "$meta" base)"
  wt="$(meta_field "$meta" worktree)"; start="$(meta_field "$meta" started_at)"
  echo "task: $name"
  echo "  branch  : $branch (base $base)"
  echo "  worktree: $wt"
  echo "  started : $start（経過 $(fmt_elapsed "$start")）"
  echo "  tmux    : $(tmux_alive "$name")"
  if [ -d "$wt" ]; then
    local commits changes
    commits=$(git -C "$wt" log --oneline "$base"..HEAD 2>/dev/null | wc -l | tr -d ' ')
    echo "  commits : ${commits}（$base..HEAD）"
    changes=$(git -C "$wt" status --short 2>/dev/null || true)
    if [ -n "$changes" ]; then
      echo "  未コミット変更: あり"
      echo "$changes" | sed 's/^/    /'
    else
      echo "  未コミット変更: なし"
    fi
  else
    echo "  worktree: 見つかりません（$wt）"
  fi
  local t f
  for t in stop attention; do
    f="$d/last-$t"
    [ -f "$f" ] && echo "  last-$t : $(date -d "@$(cat "$f")" '+%F %T' 2>/dev/null || echo '?')"
  done
}

# peek: tmuxペインの末尾N行をダンプ（進捗をこのUIに転記するため）。
cmd_peek() {
  local name="" n=60
  while [ $# -gt 0 ]; do
    case "$1" in
      -n) n="${2:-60}"; shift 2 ;;
      -*) die "peek: 不明なオプション '$1'" ;;
      *)  name="$1"; shift ;;
    esac
  done
  [ -n "$name" ] || die "使い方: task.sh peek <name> [-n 行数]"
  require_task "$name"
  tmux has-session -t "task-$name" 2>/dev/null \
    || die "tmuxセッション task-$name は生存していません"
  tmux capture-pane -pt "task-$name" -S -"$n"
}

# collect: base..HEAD のコミットログ＋diffstat＋未コミット変更の有無。
cmd_collect() {
  local name="${1:-}"
  require_task "$name"
  local meta="$STATE_ROOT/task-$name/meta.json" base wt
  base="$(meta_field "$meta" base)"; wt="$(meta_field "$meta" worktree)"
  [ -d "$wt" ] || die "collect: worktreeが見つかりません: $wt"
  echo "=== commits ($base..HEAD) ==="
  git -C "$wt" log --oneline "$base"..HEAD || true
  echo "=== diffstat ($base..HEAD) ==="
  git -C "$wt" diff --stat "$base"..HEAD || true
  echo "=== 未コミット変更 ==="
  if [ -n "$(git -C "$wt" status --short 2>/dev/null || true)" ]; then
    git -C "$wt" status --short
  else
    echo "（なし）"
  fi
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
    dispatch)        cmd_dispatch "$@" ;;
    list)            cmd_list "$@" ;;
    status)          cmd_status "$@" ;;
    peek)            cmd_peek "$@" ;;
    collect)         cmd_collect "$@" ;;
    notify)          cmd_notify "$@" ;;
    event)           cmd_event "$@" ;;
    ""|-h|--help|help) usage ;;
    *)               usage >&2; die "不明なサブコマンド '$cmd'" ;;
  esac
}

main "$@"
