# 実装プラン: 自走タスクランチャーCLI（ops/task.sh）

このプランは自己完結している。前提知識なしで読めるように書いてある。
スペック: `docs/superpowers/specs/2026-07-05-task-runner-cli-design.md`（必読・仕様の正）

## 背景（1分で）

このリポジトリはChrome拡張（LETUS課題ウォッチャー）。`ops/` には常時稼働デスクトップで
動く決定論的な監視スクリプト群がある（nightly.sh等、Discord webhook通知、README参照）。
今回作るのは開発用の新ツール `ops/task.sh` — 長時間タスクをClaude Codeに自走させる際の
worktree/tmux/hooks/通知のライフサイクル管理CLI。監視スクリプト群とは独立。

## 絶対的ガードレール

- **git push 禁止。コミットはローカルのみ**（このブランチ `task/task-runner` 上で）
- ラズパイへのSSH・デプロイ・pm2操作 禁止
- main / develop ブランチへの直接操作 禁止
- `~/ops/ops.env` の内容（webhook URL）をログ・コミットに含めない
- 迷ったら止まり、下記の通知を送って待機する

## 進捗通知（必須）

各チェックポイント完了時・停止時に Discord webhook へ通知する:

```bash
source ~/ops/ops.env
curl -sS -m 10 -H 'Content-Type: application/json' \
  -d "{\"content\":\"🔧 [task/task-runner] <メッセージ>\"}" \
  "${TASK_WEBHOOK_URL:-$OPS_WEBHOOK_URL}" || true
```

Step 2以降で自作の `ops/task.sh notify task-runner "<メッセージ>"` が動くようになったら
そちらを使う（ドッグフーディング）。

## チェックポイント構成

### Step 1: task.sh 骨格＋notify/event

- `ops/task.sh` 新規作成。バニラbash、`set -euo pipefail`、サブコマンド分岐
- 共通関数: ops.env読み込み（`~/ops/ops.env`、無くても落ちない）、
  webhook POST（失敗しても本体を失敗させない）、名前検証 `^[a-z0-9-]+$`
- `notify` / `event`（stop/attention、同種10分スロットリング、
  状態は `~/ops/state/task-<name>/last-<type>` のepoch秒）
- 検証: `bash -n ops/task.sh`、shellcheckがあれば実行、
  実webhookに1回だけテスト通知を送って到達確認
- **コミット**: `feat(ops): task.sh skeleton with notify/event`
- 通知: 「Step 1完了: notify/event実装済み」

### Step 2: dispatch

スペック通り。要点:

- `git fetch origin` → `git worktree add ~/dev/wt-<name> -b task/<name> <base>`
  （base既定 `origin/develop`）
- プランを `<worktree>/TASK_PLAN.md` へコピー
- `<worktree>/.claude/settings.local.json` にhooks書き込み（既存ファイルがあれば
  上書きでよい — worktreeは新規作成なので存在しないはず）:

```json
{
  "hooks": {
    "Stop": [{"hooks": [{"type": "command", "command": "<worktree絶対パス>/ops/task.sh event <name> stop"}]}],
    "Notification": [{"hooks": [{"type": "command", "command": "<worktree絶対パス>/ops/task.sh event <name> attention"}]}]
  }
}
```

- `~/ops/state/task-<name>/meta.json` 作成（name, branch, base, worktree, started_at）
- tmuxセッション `task-<name>`（cwd=worktree）で claude 起動:
  `${TASK_CLAUDE_CMD:-claude} --dangerously-skip-permissions "<起動プロンプト>"`
  - 起動プロンプトのテンプレートはtask.sh内にheredocで持つ。内容:
    「`TASK_PLAN.md` を読み、書かれたタスクを自走で実行せよ。ガードレール:
    push禁止・外部デプロイ禁止・mainおよびdevelop直接操作禁止・完了前に
    build/lint/testで検証・節目と完了時に `ops/task.sh notify <name> <msg>` を実行・
    プランに書かれていない破壊的操作はしない」
  - tmuxへの受け渡しは `tmux new-session -d -s task-<name> -c <worktree>` 後に
    `tmux send-keys` でコマンド投入（引用符事故を避けるためプロンプトは
    一時ファイル経由 `"$(cat <state>/prompt.txt)"` で渡す実装を推奨）
- `--no-claude` でclaude起動だけスキップ
- dispatch成功をwebhook通知
- 検証（セルフテスト）: `TASK_CLAUDE_CMD=true ops/task.sh dispatch selftest <ダミープラン>` →
  worktree・ブランチ・hooksファイル・meta.json・tmuxセッションの存在をassert
- **コミット**: `feat(ops): task.sh dispatch with worktree/tmux/hooks setup`
- 通知: 「Step 2完了: dispatch実装・セルフテスト通過」

### Step 3: list / status / peek / collect

- `list`: state配下を列挙、tmux生存（`tmux has-session`）・経過時間を表形式1行ずつ
- `status <name>`: meta.json内容＋tmux生存＋ `git -C <worktree> log --oneline <base>..HEAD | wc -l`
  ＋ `git -C <worktree> status --short` 要約＋直近イベント時刻
- `peek <name> [-n N]`: `tmux capture-pane -pt task-<name> -S -<N>`（既定60行）
- `collect <name>`: `git log --oneline <base>..HEAD` ＋ `git diff --stat <base>..HEAD`
  ＋未コミット変更の有無
- 検証: selftestタスクに対して4コマンドすべて実行し出力を確認
- **コミット**: `feat(ops): task.sh status/peek/collect commands`

### Step 4: clean＋README更新

- `clean <name> [--force]`: 未コミット変更 or base未マージコミットがあれば拒否
  （メッセージで `--force` を案内）。tmux kill → `git worktree remove` →
  stateディレクトリ削除。ブランチは残す
- selftestタスクを `clean --force` で掃除して動作確認（selftestブランチ
  `task/selftest` は `git branch -D` で手動削除してよい）
- `ops/README.md` に task.sh のセクションを追記（構成表には入れない —
  スケジュール実行ではないため。「開発自走タスク管理」として独立セクション）
- 検証: 全サブコマンドのヘルプ（引数なし/`-h`で使い方表示）確認、
  `bash -n`、shellcheck（あれば）
- **コミット**: `feat(ops): task.sh clean + README docs`
- 通知: 「Step 4完了: task.sh全機能実装済み」

### Step 5: 総仕上げ

- リポジトリ本体のビルドを壊していないこと: `pnpm install --frozen-lockfile && pnpm build && pnpm lint && pnpm test`
  （ops/しか触っていないはずだが受け入れ条件として実行）
- 最終セルフテスト一巡: dispatch(スタブ)→list→status→peek→collect→clean --force
- 通知: 「✅ task/task-runner 完了: 全受け入れ条件クリア。レビュー待ち（pushしていない）」
- **ここで停止**。push・マージはしない。人間のレビューを待つ

## 受け入れ条件（全て満たすこと）

1. `TASK_CLAUDE_CMD=true` でのdispatch→clean一巡がエラーなく通る
2. hooksファイルが正しいJSONで、コマンドパスが絶対パス
3. webhook未設定環境でも全コマンドが正常動作（通知だけスキップ）
4. 名前検証が不正名（大文字・スペース・`../`）を拒否する
5. clean が未コミット変更ありのworktreeを `--force` なしで拒否する
6. `pnpm build` / `pnpm lint` / `pnpm test` が通る
7. コミットが論理単位で分かれ、どれもpushされていない
