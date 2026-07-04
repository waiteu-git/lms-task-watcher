#!/usr/bin/env bash
# ops共通ヘルパー。各スクリプトの冒頭で source する。
# 秘密情報はリポジトリ外の ~/ops/ops.env に置く（OPS_WEBHOOK_URL など）。

OPS_HOME="$HOME/ops"
mkdir -p "$OPS_HOME/logs" "$OPS_HOME/state" "$OPS_HOME/ci"

# shellcheck disable=SC1091
[ -f "$OPS_HOME/ops.env" ] && . "$OPS_HOME/ops.env"

# Discordのops-alertsチャンネルへ投稿する。webhook未設定時はstdoutのみ。
notify() {
  local msg="$1"
  echo "[notify] $msg"
  [ -z "${OPS_WEBHOOK_URL:-}" ] && return 0
  local payload
  payload=$(python3 -c 'import json,sys; print(json.dumps({"content": sys.argv[1][:1900]}, ensure_ascii=False))' "$msg")
  curl -sS -o /dev/null --max-time 20 -X POST -H 'Content-Type: application/json' \
    -d "$payload" "$OPS_WEBHOOK_URL" || echo "[notify] webhook post failed"
}
