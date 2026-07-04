#!/usr/bin/env bash
# ラズパイ健全性監視: 公開API・内部API・ディスク・バックアップ最終結果を確認し、
# 異常時のみ通知する（月曜のみ正常でも週次ハートビートを送る）。
set -u
. "$(dirname "$(readlink -f "$0")")/lib/common.sh"

KEY="$HOME/.ssh/lmspi_key"
PI="pi@100.98.8.76"
NL=$'\n'
problems=""

# 1. 公開エンドポイント（Cloudflare経由、ユーザー視点の死活）
pub=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://api.waiteu.dev/health || echo ERR)
[ "$pub" != "200" ] && problems="${problems}- 公開API /health → ${pub}${NL}"

# 2. SSHでラズパイ内部を確認
out=$(ssh -q -o BatchMode=yes -o ConnectTimeout=15 -i "$KEY" "$PI" '
  loc=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/health)
  disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
  bk_status=$(systemctl show lmspi-backup.service -p ExecMainStatus --value)
  bk_time=$(systemctl show lmspi-backup.service -p ExecMainExitTimestamp --value)
  bk_epoch=$(date -d "$bk_time" +%s 2>/dev/null || echo 0)
  echo "${loc}|${disk}|${bk_status}|${bk_epoch}|${bk_time}"
' 2>/dev/null) || out=""

if [ -z "$out" ]; then
  problems="${problems}- SSH接続不可（ラズパイ停止/Tailscale切断の可能性）${NL}"
else
  IFS='|' read -r loc disk bk_status bk_epoch bk_time <<<"$out"
  [ "$loc" != "200" ] && problems="${problems}- 内部API /health → ${loc}（pm2停止の可能性）${NL}"
  [ "${disk:-0}" -ge 85 ] && problems="${problems}- ディスク使用率 ${disk}%${NL}"
  now=$(date +%s)
  # バックアップは毎日04:30。失敗、または26時間以上実行なしで異常。
  if [ "${bk_status:-1}" != "0" ] || [ $((now - ${bk_epoch:-0})) -gt 93600 ]; then
    problems="${problems}- バックアップ異常 (status=${bk_status:-?}, last=${bk_time:-不明})${NL}"
  fi
fi

if [ -n "$problems" ]; then
  notify "🍓❌ raspi-health:${NL}${problems}"
elif [ "$(date +%u)" = "1" ]; then
  notify "🍓✅ raspi-health: 全項目正常（週次ハートビート）"
else
  echo "[raspi-health] all OK"
fi
exit 0
