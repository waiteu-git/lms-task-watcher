#!/usr/bin/env bash
# ops共通ヘルパー。各スクリプトの冒頭で source する。
# 秘密情報はリポジトリ外の ~/ops/ops.env に置く（OPS_WEBHOOK_URL など）。

OPS_HOME="${OPS_HOME:-$HOME/ops}"
mkdir -p "$OPS_HOME/logs" "$OPS_HOME/state" "$OPS_HOME/ci"

# shellcheck disable=SC1091
[ -f "$OPS_HOME/ops.env" ] && . "$OPS_HOME/ops.env"

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
