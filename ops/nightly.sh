#!/usr/bin/env bash
# ナイトリー回帰: developのクリーンなCIクローンで install/build/lint/vitest/api-test を実行し、
# 結果をDiscordへ1行で通知する。開発中の作業ツリーには一切触れない。
set -u
. "$(dirname "$(readlink -f "$0")")/lib/common.sh"

SRC="$HOME/dev/lms-task-watcher"
CI="$OPS_HOME/ci/lms-task-watcher"
LOG="$OPS_HOME/logs/nightly-$(date +%F).log"
: > "$LOG"

if [ ! -d "$CI/.git" ]; then
  git clone --branch develop "$(git -C "$SRC" remote get-url origin)" "$CI" >>"$LOG" 2>&1 \
    || { notify "🌙❌ nightly: CIクローン作成に失敗（$LOG）"; exit 1; }
fi

cd "$CI" || exit 1
{ git fetch origin develop && git reset --hard origin/develop && git clean -fd -e .env -e api/.env; } >>"$LOG" 2>&1 \
  || { notify "🌙❌ nightly: git更新に失敗（$LOG）"; exit 1; }

# ビルド・テストが参照する未コミットの設定は開発ツリーから借用する
[ -f "$SRC/.env" ] && cp "$SRC/.env" .env
[ -f "$SRC/api/.env" ] && cp "$SRC/api/.env" api/.env

RESULTS=""
FAIL=""
step() {
  local name="$1"; shift
  echo "===== $name =====" >>"$LOG"
  if "$@" >>"$LOG" 2>&1; then
    RESULTS="${RESULTS:+$RESULTS / }$name OK"
  else
    RESULTS="${RESULTS:+$RESULTS / }$name ❌"
    FAIL=1
  fi
}

step install pnpm install --frozen-lockfile
step build pnpm build
step lint pnpm lint
step vitest pnpm exec vitest run
step api-install bash -c 'cd api && npm ci --no-audit --no-fund'
step api-test bash -c 'cd api && npm test'

REV=$(git rev-parse --short HEAD)
NL=$'\n'
if [ -n "$FAIL" ]; then
  notify "🌙❌ nightly develop@${REV}: ${RESULTS}${NL}ログ末尾:${NL}\`\`\`${NL}$(tail -c 1000 "$LOG")${NL}\`\`\`"
else
  notify "🌙✅ nightly develop@${REV}: ${RESULTS}"
fi

find "$OPS_HOME/logs" -name 'nightly-*.log' -mtime +30 -delete 2>/dev/null
exit 0
