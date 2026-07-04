# ops/ — 常時稼働デスクトップの自動化スクリプト

デスクトップ（dev-desktop / WSL2 Ubuntu）で定期実行する運用スクリプト群。
**定常運転でLLM・トークンは一切消費しない**（決定論的スクリプト＋Discord webhook通知のみ）。

## 構成

| スクリプト | 実行 | 内容 | 通知 |
|---|---|---|---|
| `nightly.sh` | 毎日 03:30 | developのCIクローンで install/build/lint/vitest/api-test | 毎回1行（失敗時はログ末尾付き） |
| `canary.sh` | 毎日 07:30 | LETUSログインページ生存・DOMマーカー・iCalエクスポート形式 | 異常時のみ |
| `raspi-health.sh` | 毎日 07:00 | 公開API/内部API/ディスク/バックアップ最終結果 | 異常時のみ＋月曜ハートビート |
| `competitor-watch.sh` | 毎週月 09:00 | LETask（App Store）のバージョン・評価数の変化 | 変化時のみ |

## セットアップ（デスクトップ側）

1. 秘密情報はリポジトリ外の `~/ops/ops.env` に置く:

   ```bash
   OPS_WEBHOOK_URL='https://discord.com/api/webhooks/...'   # #ops-alerts のwebhook
   # 任意: 設定するとcanaryがiCalエクスポートも監視する
   # 値に & を含むため、必ずシングルクォートで囲む（囲まないとsource時に壊れる）
   # MOODLE_ICAL_URL='https://letus.ed.tus.ac.jp/calendar/export_execute.php?...&authtoken=...'
   ```

2. 固定ランチャーを設置（スクリプト本体は実行前にCIクローン経由でorigin/developへ自動同期される）:

   ```bash
   cp ~/dev/lms-task-watcher/ops/run.sh ~/ops/run.sh && chmod +x ~/ops/run.sh
   ```

3. スケジュールはWindowsタスクスケジューラで登録（WSL停止中でも起動される）:

   ```cmd
   schtasks /create /f /tn LMS-Nightly         /sc daily  /st 03:30 /tr "wsl.exe -d Ubuntu -u ysou5 -- /home/ysou5/ops/run.sh nightly"
   schtasks /create /f /tn LMS-RaspiHealth     /sc daily  /st 07:00 /tr "wsl.exe -d Ubuntu -u ysou5 -- /home/ysou5/ops/run.sh raspi-health"
   schtasks /create /f /tn LMS-Canary          /sc daily  /st 07:30 /tr "wsl.exe -d Ubuntu -u ysou5 -- /home/ysou5/ops/run.sh canary"
   schtasks /create /f /tn LMS-CompetitorWatch /sc weekly /d MON /st 09:00 /tr "wsl.exe -d Ubuntu -u ysou5 -- /home/ysou5/ops/run.sh competitor-watch"
   ```

   注意: タスクは「ユーザーがログオンしているときのみ」実行される既定設定。
   デスクトップ再起動後は一度ログオンが必要。

4. デプロイ = `origin/develop` にpushするだけ（実行前に自動でfetch/resetされる）。
   `run.sh` 自体を変更した場合のみ、手順2の再コピーが必要。

## ファイル配置（デスクトップ、リポジトリ外）

- `~/ops/ops.env` — 秘密情報（webhook URL等）
- `~/ops/logs/` — nightlyログ（30日で自動削除）
- `~/ops/state/` — competitor-watchの前回スナップショット
- `~/ops/ci/lms-task-watcher` — nightly専用のCIクローン（開発ツリーとは別）

## 設計方針

- 通知はDiscordの `#ops-alerts`（webhook、Botトークンは使わない・ラズパイから出さない）
- 「異常を検知したら自動修正」はしない。検知と事実の通知まで。修正は指示があったときのみ
- canary Stage B（実セッションでスクレイパー実走）は認証方式決定後に追加予定
