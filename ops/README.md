# ops/ — 常時稼働デスクトップの自動化スクリプト

デスクトップ（dev-desktop / WSL2 Ubuntu）で定期実行する運用スクリプト群。
**定常運転でLLM・トークンは一切消費しない**（決定論的スクリプト＋Discord webhook通知のみ）。

## 構成

| スクリプト | 実行 | 内容 | 通知 |
|---|---|---|---|
| `nightly.sh` | 毎日 03:30 | developのCIクローンで install/build/lint/vitest/api-test | 毎回1行（失敗時はログ末尾付き） |
| `canary.sh` | 毎日 07:30 | 対象LMSのログインページ生存・DOMマーカー・カレンダーエクスポート形式 | 異常時のみ |
| `raspi-health.sh` | 毎日 07:00 | 公開API/内部API/ディスク/バックアップ最終結果 | 異常時のみ＋月曜ハートビート |
| `competitor-watch.sh` | 毎週月 09:00 | LETask（App Store）のバージョン・評価数の変化 | 変化時のみ |
| `dev-digest.sh` | 毎日 07:15 | 残タスク＋前日進捗の朝サマリー（任意でLLM要約1行） | 毎回1通（#dev-digest） |

## セットアップ（デスクトップ側）

1. 秘密情報はリポジトリ外の `~/ops/ops.env` に置く:

   ```bash
   OPS_WEBHOOK_URL='https://discord.com/api/webhooks/...'   # #ops-alerts のwebhook

   # canary の監視先（未設定だと生存確認をスキップし、異常として通知される）
   CANARY_LOGIN_URL='<LMSのログインページURL>'

   # 任意: 設定するとcanaryがカレンダーエクスポートも監視する
   # 値に & を含むため、必ずシングルクォートで囲む（囲まないとsource時に壊れる）
   # MOODLE_ICAL_URL='https://<lms>/calendar/export_execute.php?...&authtoken=...'

   # raspi-health の接続先（未設定だと内部確認をスキップし、異常として通知される）
   # RASPI_SSH_HOST='<user>@<host>'
   # RASPI_SSH_KEY='<秘密鍵のパス>'          # 既定 ~/.ssh/id_raspi
   # RASPI_PUBLIC_HEALTH_URL='<URL>'        # 既定 公開APIの /health
   ```

   ホスト名・ユーザー名・鍵のパスといった構成情報は、この公開リポジトリには書かない。

2. 固定ランチャーを設置（スクリプト本体は実行前にCIクローン経由でorigin/developへ自動同期される）:

   ```bash
   cp ~/dev/lms-task-watcher/ops/run.sh ~/ops/run.sh && chmod +x ~/ops/run.sh
   ```

3. スケジュールはWindowsタスクスケジューラで登録（WSL停止中でも起動される）:

   ```cmd
   schtasks /create /f /tn LMS-Nightly         /sc daily  /st 03:30 /tr "wsl.exe -d Ubuntu -u <user> -- /home/<user>/ops/run.sh nightly"
   schtasks /create /f /tn LMS-RaspiHealth     /sc daily  /st 07:00 /tr "wsl.exe -d Ubuntu -u <user> -- /home/<user>/ops/run.sh raspi-health"
   schtasks /create /f /tn LMS-Canary          /sc daily  /st 07:30 /tr "wsl.exe -d Ubuntu -u <user> -- /home/<user>/ops/run.sh canary"
   schtasks /create /f /tn LMS-CompetitorWatch /sc weekly /d MON /st 09:00 /tr "wsl.exe -d Ubuntu -u <user> -- /home/<user>/ops/run.sh competitor-watch"
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

- 通知はDiscordの `#ops-alerts`（webhook、Botトークンは使わない・サーバー側からは出さない）
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

## 開発ダイジェスト（`dev-digest.sh`）

毎朝1通、残タスク（TASKS.md）と前日の進捗（コミット・完了タスク・自走タスク）を
専用チャンネル #dev-digest に投稿する。土台は決定論（トークンゼロ）。その上に
任意のLLM要約1行を、予算・計測・自動停止のガード付きで重ねられる。

### ops.env に追記する設定（すべて任意）

```bash
# 投稿先（未設定なら投稿せずログのみ。#ops-alerts にはフォールバックしない）
DEV_DIGEST_WEBHOOK_URL='https://discord.com/api/webhooks/...'   # #dev-digest のwebhook

# --- 以下はLLM要約レイヤーを使う場合のみ（未設定なら決定論ダイジェストだけ届く）---
DIGEST_LLM_ENABLED=1                     # 1 で有効化（キー追加だけでは動かない二重の明示）
ANTHROPIC_API_KEY='sk-ant-...'           # Anthropic Console のAPIキー。Max x5とは別のAPI従量課金
DIGEST_MONTHLY_BUDGET_USD=0.50           # 月予算。到達すると自動停止（既定 0.50）
```

### 消費の確認・自動停止からの再開

```bash
~/ops/ci/lms-task-watcher/ops/dev-digest.sh --usage      # 直近14日の消費と今月累計・予算残
```

予算到達で自動停止すると `~/ops/state/dev-digest/llm-disabled` が作られ、以降は
決定論ダイジェストだけになる。再開は `rm ~/ops/state/dev-digest/llm-disabled`。

### スケジュール登録（Windowsタスクスケジューラ）

```cmd
schtasks /create /f /tn LMS-DevDigest /sc daily /st 07:15 /tr "wsl.exe -d Ubuntu -u <user> -- /home/<user>/ops/run.sh dev-digest"
```

（raspi-health 07:00 と canary 07:30 の間。デプロイは origin/develop に push するだけ。）
