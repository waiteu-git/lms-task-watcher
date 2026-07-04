#!/usr/bin/env bash
# LETUSカナリア（Stage A）: LETUSの生存とiCalエクスポートの形式を確認し、異常時のみ通知する。
# Stage B（実セッションでのDOM/パーサ検証）は認証方式決定後に拡張する。
set -u
. "$(dirname "$(readlink -f "$0")")/lib/common.sh"

NL=$'\n'
problems=""
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

# 1. ログインページの生存とDOMマーカー
code=$(curl -sS -o "$TMP" -w '%{http_code}' --max-time 30 -L "https://letus.ed.tus.ac.jp/login/index.php" 2>/dev/null || echo ERR)
if [ "$code" != "200" ]; then
  problems="${problems}- ログインページ応答異常 (HTTP ${code})${NL}"
elif ! grep -q 'username' "$TMP"; then
  problems="${problems}- ログインページに想定マーカー(username)なし。DOM変更の可能性${NL}"
fi

# 2. iCalカレンダーエクスポート（~/ops/ops.env に MOODLE_ICAL_URL がある場合のみ）
if [ -n "${MOODLE_ICAL_URL:-}" ]; then
  ical=$(curl -sS --max-time 30 "$MOODLE_ICAL_URL" 2>/dev/null || echo "")
  if ! printf '%s' "$ical" | head -1 | grep -q 'BEGIN:VCALENDAR'; then
    problems="${problems}- iCalエクスポートが取得できない/形式異常（トークン失効の可能性）${NL}"
  else
    nevents=$(printf '%s' "$ical" | grep -c 'BEGIN:VEVENT' || true)
    echo "[canary] iCal OK (VEVENT=${nevents})"
  fi
fi

if [ -n "$problems" ]; then
  notify "🥬❌ LETUSカナリア:${NL}${problems}"
else
  echo "[canary] all OK"
fi
exit 0
