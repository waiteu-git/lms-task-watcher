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

## 開発自走タスク管理（`task.sh`）

上の定期監視スクリプト群とは**独立**した開発用ツール。定期実行ではなく都度呼び出し。
長時間タスクをデスクトップ（WSL2）のClaude Codeに自走させる際の
worktree / tmux / hooks / 通知 のライフサイクルを1本のCLIに統合し、
「1タスク=1worktree=1tmux」の並列隔離をツールで強制する。

設計の正: `docs/superpowers/specs/2026-07-05-task-runner-cli-design.md`

### サブコマンド

```
task.sh dispatch <name> <plan-file> [--base <ref>] [--no-claude]
task.sh list
task.sh status [<name>]
task.sh peek <name> [-n 行数]
task.sh collect <name>
task.sh notify <name> <message...>
task.sh event <name> <stop|attention>   # hooksから呼ばれる内部用
task.sh clean <name> [--force]
```

- `dispatch`: `git fetch origin` 後、`~/dev/wt-<name>` を `task/<name>`（既定 base `origin/develop`）で
  worktree作成 → プランを `TASK_PLAN.md` にコピー → `.claude/settings.local.json` に
  Stop/Notification hooks を書き込み → `~/ops/state/task-<name>/` を作成 →
  tmuxセッション `task-<name>` で `claude --dangerously-skip-permissions <起動プロンプト>` を起動。
  `--no-claude` はセットアップのみ（tmux/claude起動をスキップ）。
- `list` / `status` / `peek` / `collect`: 進捗確認。`peek` は tmuxペイン末尾N行（既定60）。
- `notify`: 節目・完了・停止時の任意メッセージをwebhookへ（自走中のClaudeが実行する）。
- `event`: hooks用の機械イベント。同種は10分スロットリング。
- `clean`: tmux kill → worktree削除 → state削除（**ブランチは残す**）。
  未コミット変更 or base未マージコミットがあれば `--force` なしでは拒否。

### 状態・設定（リポジトリ外）

- 状態: `~/ops/state/task-<name>/`（`meta.json` / `prompt.txt` / `last-<type>`）
- 通知先: `~/ops/ops.env` の `TASK_WEBHOOK_URL`、無ければ `OPS_WEBHOOK_URL`（#ops-alerts）に
  フォールバック。専用 `#task-runner` チャンネル作成後に `TASK_WEBHOOK_URL` を追記するだけ。
- claude起動コマンドは `TASK_CLAUDE_CMD` で差し替え可能（既定 `claude`、テスト時は `true` 等）。

### テスト

```bash
bash -n ops/task.sh                                    # 構文チェック
TASK_CLAUDE_CMD=true ops/task.sh dispatch selftest <ダミープラン>
ops/task.sh status selftest && ops/task.sh peek selftest && ops/task.sh collect selftest
ops/task.sh clean selftest --force                     # 掃除（ブランチは git branch -D task/selftest で削除）
```
