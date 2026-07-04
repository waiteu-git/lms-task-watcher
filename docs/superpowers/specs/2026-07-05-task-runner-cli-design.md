# 自走タスクランチャーCLI（ops/task.sh）設計

日付: 2026-07-05
ステータス: 承認済み（対話で A+C 通知方式・フルライフサイクルCLI案を確定）

## 目的

長時間タスクをデスクトップ（WSL2）のClaude Codeに自走させる運用は確立済みだが、
worktree作成・tmuxセッション作成・claude起動・進捗確認・掃除がすべて手作業。
これを1本のCLI `ops/task.sh` に統合し、並列隔離規約（1タスク=1worktree=1tmux）を
「規約」から「ツールが強制する仕様」に変える。

## スコープ

- 対象マシン: デスクトップWSL2（`~/dev/lms-task-watcher` が存在する環境）でのみ実行
- ノート側Claudeは `ssh dev-desktop` 経由でこのCLIを呼ぶだけ（ノート側に配布物なし）
- 通知はDiscord webhook。`~/ops/ops.env` の `TASK_WEBHOOK_URL`、未設定なら
  `OPS_WEBHOOK_URL`（#ops-alerts）にフォールバック。専用 `#task-runner`
  チャンネル+webhookの作成は手動作業のため保留（作成後にops.envへ追記するだけ）

## サブコマンド

```
task.sh dispatch <name> <plan-file> [--base origin/develop] [--no-claude]
task.sh status [<name>]
task.sh peek <name> [-n 行数]
task.sh notify <name> <message...>
task.sh event <name> <stop|attention>      # hooksから呼ばれる内部用
task.sh collect <name>
task.sh clean <name> [--force]
task.sh list
```

### dispatch

1. `<name>` を検証（`[a-z0-9-]+`、既存タスクと重複拒否）
2. `git fetch origin` 後、worktree `~/dev/wt-<name>` をブランチ `task/<name>`
   （`--base` 起点、既定 `origin/develop`）で作成
3. プランファイルを worktree の `TASK_PLAN.md` にコピー
4. worktree の `.claude/settings.local.json` に hooks を書き込む:
   - `Stop` フック → `<worktree>/ops/task.sh event <name> stop`
   - `Notification` フック → `<worktree>/ops/task.sh event <name> attention`
5. `~/ops/state/task-<name>/` に状態ディレクトリ作成（meta.json: 開始時刻・base・ブランチ）
6. tmuxセッション `task-<name>`（cwd=worktree）を作成し、claudeを起動:
   `claude --dangerously-skip-permissions "<起動プロンプト>"`
   - 起動プロンプトは固定テンプレート＋プラン参照。ガードレール
     （push禁止・ラズパイデプロイ禁止・main操作禁止・完了前にbuild/lint/test・
     節目で `ops/task.sh notify <name> <メッセージ>` を実行）を必ず含む
   - `--no-claude` はセットアップのみ（手動でtmuxに入って起動する場合・テスト用）
7. dispatch完了をwebhookに通知

### status / list / peek

- `list`: `~/ops/state/task-*` を列挙し、tmux生存・ブランチ・経過時間を1行ずつ
- `status <name>`: meta.json、tmux生存、baseからのコミット数、直近イベント、
  worktreeのgit status要約
- `peek <name>`: `tmux capture-pane` で末尾N行（既定60）をダンプ。
  ノート側Claudeが進捗をこのUIに転記するために使う

### notify / event

- `notify`: webhookへ `🔧 [task/<name>] <message>` をPOST（プラン規約C用）
- `event`: hooksからの機械イベント。スロットリングあり —
  同種イベントは前回通知から10分以内なら送らない（`state/last-<type>` で管理）。
  - `stop` → 「⏹ 応答完了（完了または次の指示待ちの可能性）」
  - `attention` → 「⚠ 要対応（許可待ち/アイドル）」
- webhook未設定・POST失敗でも本体処理は失敗させない（ログのみ）

### collect / clean

- `collect`: `git log --oneline <base>..task/<name>` ＋ diffstat ＋ 未コミット変更の有無
- `clean`: tmuxセッションkill → worktree削除 → stateディレクトリ削除。
  未コミット変更 or baseに未マージのコミットがあれば `--force` なしでは拒否
  （ブランチ自体は削除しない。取り込み後の削除は手動/将来拡張）

## 設計上の決定

- **バニラbash**（ops/の既存方針に合わせる。set -euo pipefail、依存はgit/tmux/curl/jqなし運用
  — JSONはheredocで生成）
- **claude起動コマンドは `TASK_CLAUDE_CMD` 環境変数で差し替え可能**（既定 `claude`）。
  テスト時はスタブに差し替えて実claudeを起動せずにdispatchを検証する
- hooksのコマンドパスはworktree内の自分自身（`<worktree>/ops/task.sh`）を絶対パスで指す。
  worktreeはdevelop起点なのでtask.sh自身が必ず存在する
- 状態はすべて `~/ops/state/task-<name>/` に置き、リポジトリを汚さない
- 既存 `run.sh`（定期監視ランチャー）とは独立。task.shは都度呼び出しでスケジューラ登録なし

## ガードレール（dispatchテンプレートに焼き込む）

- git push / ラズパイデプロイ / pm2 restart / mainブランチ操作は禁止。コミットはローカルのみ
- 完了条件: プランの受け入れ条件を満たし、`pnpm build` `pnpm lint` `pnpm test` が通ること
- 完了時・フェーズ完了時・判断に迷って停止する時は必ず `ops/task.sh notify` を実行

## テスト方針

- `bash -n` / shellcheck（インストール済みなら）で静的検査
- `TASK_CLAUDE_CMD=true task.sh dispatch selftest <ダミープラン>` で
  worktree/tmux/hooks/stateの生成を検証 → `status`/`peek`/`collect`/`clean` を一巡
- webhookは `TASK_WEBHOOK_URL` をローカルスタブ（`nc`等は使わずログ書き出しの
  ダミーURL不可のため、curl失敗が無害であることの確認で代替）

## 将来拡張（今回はやらない）

- A: push時CI（GitHub Actions等）
- C: リリースパイプライン
- D: 監視検知→修正プラン自動起案
- clean時のブランチ削除・取り込み支援、複数リポジトリ対応
