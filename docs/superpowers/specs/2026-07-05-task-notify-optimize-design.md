# task.sh 通知最適化（開始送信→編集→完了/要対応で新規）設計

日付: 2026-07-05
ステータス: 承認済み（対話で確定: 完了検知は`done`サブコマンド新設 / 状態はライブパネルを編集で更新 / attentionは新規＋10分スロットル維持）

## 目的

自走中の task.sh 通知が毎回新規メッセージで #task-runner を埋めるのを避ける。
開始時に1つの「状態メッセージ」を送り、実行中はそれを**編集**で更新（Discordの編集はping通知が飛ばない）、
本当に人が気づくべき時＝**完了**と**要対応**だけ新規メッセージ（ping）にする。

## 対象と前提

- `ops/task.sh`（develop済み）の通知系のみ変更。worktree/tmux/hooksのライフサイクルは不変
- Discord webhookのメッセージ編集を使う:
  - 送信: `POST <webhook_url>?wait=true` → 応答JSONに `.id`（メッセージID）
  - 編集: `PATCH <webhook_url>/messages/<id>`
- webhook URLは既存の解決順（`TASK_WEBHOOK_URL` → `OPS_WEBHOOK_URL`）

## イベントの割り当て

| トリガ | 動作 | 通知種別 |
|---|---|---|
| `dispatch`（開始） | 状態メッセージを`?wait=true`でPOST→IDを保存 | 新規（1回だけ） |
| `notify <name> <msg>`（節目） | 「最新の節目」を記録→状態メッセージを**編集** | 編集（pingなし） |
| `event stop`（毎ターン） | 「最終活動=今」を記録→状態メッセージを**編集** | 編集（pingなし・スロットル不要） |
| `event attention`（要対応） | **新規メッセージ**（⚠） | 新規＋10分スロットル維持 |
| `done <name> <msg>`（新設・完了） | **新規メッセージ**（✅）＋状態メッセージを「完了」表示へ最終編集 | 新規（1回） |

## 状態メッセージの中身（編集で更新されるライブパネル）

毎回 state から `render_status <name>` で組み立てる:

```
🔧 task/<name> ⏳経過 1h23m
最新: Step 3完了
最終活動: 2分前 · コミット4 · task/<name>
```

- 経過: `meta.json` の `started_at` から `fmt_elapsed`（既存関数）
- 最新: 直近の `notify` メッセージ（`~/ops/state/task-<name>/milestone`、無ければ「—」）
- 最終活動: 直近の `stop` 時刻を相対表示（`~/ops/state/task-<name>/last-activity` epoch、無ければ「—」）
- コミット: worktreeの `git log <base>..HEAD` 件数（取れなければ省略）
- ブランチ: `task/<name>`
- `done` 後は先頭を `✅ task/<name> 完了` に、最終編集で差し替え

## 新規・変更するもの（ops/task.sh 内）

- **`post_webhook` を分割**:
  - `discord_post <msg>` — `?wait=true` でPOSTし、応答から `.id` を stdout に返す（失敗時は空）
  - `discord_edit <id> <msg>` — `PATCH .../messages/<id>`。失敗時は非0
  - 既存の `post_webhook <msg>`（新規・ID不要の単純POST）は attention/done の新規メッセージ用に残す
- **`render_status <name>`** 新設: 上記パネル文字列を組み立てる
- **`cmd_notify`**: `milestone` ファイルへ記録 → `edit_status_or_post <name>`
- **`cmd_event stop`**: `last-activity` へ記録 → `edit_status_or_post <name>`（stopはスロットル撤廃）
- **`cmd_event attention`**: 従来どおり新規POST＋10分スロットル
- **`cmd_done`** 新設: 新規POST（✅）＋状態メッセージを完了表示へ最終編集。`main`に`done`分岐追加
- **`cmd_dispatch`**: 最後の`post_webhook`を、状態メッセージ生成に変更（`discord_post` で送りIDを`status-msg-id`に保存、送信本文は`render_status`）。起動プロンプトに「完了時は `ops/task.sh done <name> "<要約>"` を1回実行（notifyは途中経過用）」を追加
- **状態ファイル**（`~/ops/state/task-<name>/`）: `status-msg-id`・`status-webhook`（編集先URL固定用）・`milestone`・`last-activity`

## `edit_status_or_post <name>` の挙動（要）

1. `status-msg-id` と `status-webhook` があれば `discord_edit` で状態メッセージを編集
2. 編集失敗、またはIDが無い（この機能より前にdispatchされた古いタスク・フォールバック）→
   `render_status` の本文を新規POST（`post_webhook`）。取りこぼさない
3. webhook未設定 → ログのみ（現状維持）

## 堅牢性

- `discord_post` がIDを取れない（`?wait`非対応・レート制限・JSON壊れ）→ IDを保存せず、以降は新規POSTにフォールバック
- 秘密のwebhook URLはログに出さない
- 全経路 `set -euo pipefail` 下でも通知失敗が本体を止めない（既存方針踏襲）

## テスト方針

- **HTTPスタブseam `TASK_HTTP_STUB`**（ディレクトリ）: 設定時、`discord_post`/`discord_edit`/`post_webhook` はcurlを呼ばず、リクエスト種別・URL・本文をそのディレクトリのファイルに記録し、`discord_post` は固定ID `stub-msg-1` を返す。これで「どのイベントがPOST/PATCHのどちらを呼ぶか」をネットワーク無しで検証
- 検証項目:
  - dispatch → POST 1回・`status-msg-id` 保存（スタブID）
  - notify → PATCH（編集）、`milestone` 記録
  - event stop → PATCH（編集）、`last-activity` 記録、連続stopでスロットルされない
  - event attention → POST（新規）、10分スロットルが効く
  - done → POST（新規）＋PATCH（最終編集）
  - `status-msg-id` 削除時、notify/stop が POST にフォールバック
  - `render_status` が経過・最新・コミット数を含む
- `bash -n` / shellcheck（あれば）
- 最後に #task-runner で実dispatch→notify→done の1巡を実観測（編集で更新され、完了だけ新規になることを目視）

## 後方互換

- この機能より前にdispatchされた稼働中タスクは `status-msg-id` を持たない → notify/stop は新規POSTにフォールバック（従来挙動）。壊れない
- `notify` の対外インターフェース（`task.sh notify <name> <msg>`）は不変。意味だけ「途中経過＝編集」に変わる
