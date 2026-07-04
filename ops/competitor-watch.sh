#!/usr/bin/env bash
# 競合ウォッチ: LETask（App Store id 6762050344）のバージョン・評価数を取得し、
# 前回スナップショットから変化があった場合のみ通知する。
set -u
. "$(dirname "$(readlink -f "$0")")/lib/common.sh"

STATE="$OPS_HOME/state/letask.json"
NL=$'\n'

new=$(curl -sS --max-time 30 "https://itunes.apple.com/lookup?id=6762050344&country=jp" | python3 -c '
import json, sys
d = json.load(sys.stdin)
rs = d.get("results", [])
if not rs:
    print(json.dumps({"listed": False}, ensure_ascii=False))
else:
    r = rs[0]
    print(json.dumps({
        "listed": True,
        "version": r.get("version"),
        "updated": (r.get("currentVersionReleaseDate") or "")[:10],
        "ratings": r.get("userRatingCount"),
        "avg": r.get("averageUserRating"),
        "notes": (r.get("releaseNotes") or "")[:400],
    }, ensure_ascii=False, sort_keys=True))
' 2>/dev/null) || { echo "[competitor-watch] lookup failed"; exit 0; }

old=$(cat "$STATE" 2>/dev/null || echo "")

if [ "$new" != "$old" ]; then
  printf '%s' "$new" > "$STATE"
  if [ -z "$old" ]; then
    echo "[competitor-watch] initial snapshot saved"
  else
    notify "🔭 LETaskに変化あり:${NL}旧: ${old}${NL}新: ${new}"
  fi
else
  echo "[competitor-watch] no change"
fi
exit 0
