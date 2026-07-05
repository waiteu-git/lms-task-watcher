# task.sh 通知最適化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** task.sh の自走通知を「開始=状態メッセージ送信 / 実行中=その編集で更新 / 完了・要対応=新規メッセージ」に変え、#task-runner のノイズを減らす。

**Architecture:** `ops/task.sh`（バニラbash, `set -euo pipefail`）の通知系のみ変更。Discord webhookの `?wait=true`（ID取得）と `PATCH .../messages/<id>`（編集）を使う。状態は `~/ops/state/task-<name>/` のファイル。ライフサイクル（worktree/tmux/hooks/clean）は不変。

**Tech Stack:** bash, python3（JSON生成/解析）, curl。テストはHTTPスタブseam `TASK_HTTP_STUB` ＋ 手組みの state で実施（ネットワーク不要）。

## Global Constraints

スペック `docs/superpowers/specs/2026-07-05-task-notify-optimize-design.md` が正。

- バニラbash（`set -euo pipefail`）。既存関数 `meta_field` `fmt_elapsed` `validate_name` `die` と `STATE_ROOT` を再利用
- webhook URL解決順は `TASK_WEBHOOK_URL` → `OPS_WEBHOOK_URL`。編集も同じURLから都度解決（別途保存しない）
- 秘密のwebhook URLはログに出さない。通知失敗は本体を止めない
- **git push禁止・main/develop直接操作禁止**。作業はブランチ task/<自名> のローカルコミットのみ
- 後方互換: `status-msg-id` が無い稼働中タスクは notify/stop が新規POSTにフォールバック
- **テストは必ず `OPS_HOME` を一時ディレクトリに向け、実 `~/ops/ops.env`（実webhook/APIキー）を読ませない。`TASK_HTTP_STUB` でcurlを無効化する**

---

### Task 1: HTTPレイヤー（discord_post / discord_edit / スタブseam）

**Files:** Modify `ops/task.sh`（既存 `post_webhook` を置き換え＋ヘルパー追加）

**Interfaces:**
- Produces: `webhook_url`（解決URL）、`_content_payload <msg>`、`post_webhook <msg>`（新規POST・ID不要）、`discord_post <msg>`（`?wait`でPOSTしIDを stdout に返す）、`discord_edit <id> <msg>`（PATCH・成功0/失敗非0）。`TASK_HTTP_STUB` 設定時は curl せず `$TASK_HTTP_STUB/calls` にタブ区切りで種別・URL・本文を1行記録、`discord_post` は `stub-msg-1` を返す。

- [ ] **Step 1: 既存 post_webhook を置き換え、ヘルパーを追加**

`ops/task.sh` の既存 `post_webhook() { ... }` 定義全体を、以下で置き換える:

```bash
# webhook URL解決順（TASK_WEBHOOK_URL → OPS_WEBHOOK_URL）。無ければ空。
webhook_url() { echo "${TASK_WEBHOOK_URL:-${OPS_WEBHOOK_URL:-}}"; }

# {"content": msg[:1900]} のJSON payloadを生成。
_content_payload() {
  python3 -c 'import json,sys; print(json.dumps({"content": sys.argv[1][:1900]}, ensure_ascii=False))' "$1"
}

# 新規POST（ID不要）。attention/done/フォールバック用。webhook未設定・失敗でも落とさない。
post_webhook() {
  local msg="$1" url; url="$(webhook_url)"
  if [ -z "$url" ]; then echo "[task.sh] webhook未設定（通知スキップ）: $msg"; return 0; fi
  if [ -n "${TASK_HTTP_STUB:-}" ]; then
    mkdir -p "$TASK_HTTP_STUB"; printf 'POST\t%s\t%s\n' "$url" "$msg" >> "$TASK_HTTP_STUB/calls"; return 0
  fi
  local payload; payload="$(_content_payload "$msg")" || { echo "[task.sh] payload生成失敗（通知スキップ）"; return 0; }
  curl -sS -o /dev/null --max-time 10 -X POST -H 'Content-Type: application/json' -d "$payload" "$url" \
    || echo "[task.sh] webhook POST失敗（無視）"
  return 0
}

# ?wait=true でPOSTし、応答からメッセージIDを stdout に返す（失敗/未設定時は空）。状態メッセージ生成用。
discord_post() {
  local msg="$1" url; url="$(webhook_url)"
  [ -n "$url" ] || return 0
  if [ -n "${TASK_HTTP_STUB:-}" ]; then
    mkdir -p "$TASK_HTTP_STUB"; printf 'POST_WAIT\t%s\t%s\n' "$url" "$msg" >> "$TASK_HTTP_STUB/calls"
    echo "stub-msg-1"; return 0
  fi
  local payload resp; payload="$(_content_payload "$msg")" || return 0
  resp="$(curl -sS --max-time 10 -X POST -H 'Content-Type: application/json' -d "$payload" "$url?wait=true")" || return 0
  printf '%s' "$resp" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("id",""))
except Exception: pass'
}

# メッセージ編集（PATCH .../messages/<id>）。成功で0、失敗で非0。
discord_edit() {
  local id="$1" msg="$2" url; url="$(webhook_url)"
  { [ -n "$url" ] && [ -n "$id" ]; } || return 1
  if [ -n "${TASK_HTTP_STUB:-}" ]; then
    mkdir -p "$TASK_HTTP_STUB"; printf 'PATCH\t%s/messages/%s\t%s\n' "$url" "$id" "$msg" >> "$TASK_HTTP_STUB/calls"; return 0
  fi
  local payload code; payload="$(_content_payload "$msg")" || return 1
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X PATCH -H 'Content-Type: application/json' -d "$payload" "$url/messages/$id")" || return 1
  case "$code" in 2*) return 0 ;; *) return 1 ;; esac
}
```

- [ ] **Step 2: 構文チェック**

Run: `bash -n ops/task.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 3: コミット**

```bash
git add ops/task.sh
git commit -m "feat(ops): task.sh discord_post(?wait)/discord_edit(PATCH) helpers + HTTP stub seam"
```

---

### Task 2: 状態パネル描画とフォールバック（render_status / edit_status_or_post）

**Files:** Modify `ops/task.sh`（`meta_field` 等のヘルパー群の近くに追加）

**Interfaces:**
- Consumes: `meta_field`、`fmt_elapsed`、`discord_edit`、`post_webhook`、`STATE_ROOT`
- Produces: `render_status <name> [done]` — `~/ops/state/task-<name>/` の meta.json・milestone・last-activity と worktreeのコミット数からライブパネル文字列を返す（`done` 指定で先頭を完了表示）。`edit_status_or_post <name>` — `status-msg-id` があれば編集、無ければ/失敗なら新規POST。

- [ ] **Step 1: render_status と edit_status_or_post を追加**

`ops/task.sh` の `fmt_elapsed() { ... }` 定義の**直後**に、以下を挿入する:

```bash
# 状態パネル文字列を組み立てる。第2引数 "done" で完了表示。
render_status() {
  local name="$1" done_flag="${2:-}"
  local dir="$STATE_ROOT/task-$name" meta wt base start elapsed mile act commits head
  meta="$dir/meta.json"
  wt="$(meta_field "$meta" worktree)"; base="$(meta_field "$meta" base)"; start="$(meta_field "$meta" started_at)"
  elapsed="$(fmt_elapsed "$start")"
  mile="$(cat "$dir/milestone" 2>/dev/null || echo '—')"
  if [ -f "$dir/last-activity" ]; then
    act="$(fmt_elapsed "@$(cat "$dir/last-activity")")前"
  else
    act="—"
  fi
  commits=""
  if [ -n "$wt" ] && [ -d "$wt" ] && [ -n "$base" ]; then
    local n; n="$(git -C "$wt" log --oneline "$base"..HEAD 2>/dev/null | wc -l | tr -d ' ')"
    [ -n "$n" ] && commits=" · コミット$n"
  fi
  head="🔧 task/$name ⏳経過 $elapsed"
  [ "$done_flag" = "done" ] && head="✅ task/$name 完了 ⏳経過 $elapsed"
  printf '%s\n最新: %s\n最終活動: %s%s · task/%s' "$head" "$mile" "$act" "$commits" "$name"
}

# 状態メッセージがあれば編集、無ければ/失敗なら新規POST（取りこぼさない）。
edit_status_or_post() {
  local name="$1" dir="$STATE_ROOT/task-$name" id body
  body="$(render_status "$name")"
  id="$(cat "$dir/status-msg-id" 2>/dev/null || echo '')"
  if [ -n "$id" ] && discord_edit "$id" "$body"; then return 0; fi
  post_webhook "$body"
}
```

- [ ] **Step 2: 構文チェック**

Run: `bash -n ops/task.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 3: render_status を手組みstateで確認**

Run:
```bash
export OPS_HOME=/tmp/tnstate; rm -rf "$OPS_HOME"; mkdir -p "$OPS_HOME/state/task-demo"
cat > "$OPS_HOME/state/task-demo/meta.json" <<EOF
{"name":"demo","branch":"task/demo","base":"origin/develop","worktree":"/nonexistent","started_at":"$(date -Iseconds)"}
EOF
echo "Step 1完了" > "$OPS_HOME/state/task-demo/milestone"
bash -c 'set -euo pipefail; source ops/task.sh __noop 2>/dev/null; render_status demo' 2>/dev/null || \
  OPS_HOME=/tmp/tnstate ops/task.sh __rendertest demo 2>/dev/null || echo "(次Stepの統合テストで確認)"
```
Expected: このStepは補助。確実な確認は Task 3 の統合テストで行う（`source` はmainを走らせるため使わない）。`bash -n` が通っていれば次へ。

- [ ] **Step 4: コミット**

```bash
git add ops/task.sh
git commit -m "feat(ops): task.sh render_status live panel + edit_status_or_post fallback"
```

---

### Task 3: コマンドの再配線（notify/event/done/dispatch/main）

**Files:** Modify `ops/task.sh`（`cmd_notify`・`cmd_event` 置き換え、`cmd_done` 追加、`cmd_dispatch` 末尾とプロンプト変更、`main` に `done` 分岐）

**Interfaces:**
- Consumes: Task 1・2 の全関数
- Produces: `notify`=milestone記録→編集、`event stop`=activity記録→編集（スロットル撤廃）、`event attention`=新規POST＋10分スロットル、`done <name> <msg>`=新規POST＋状態を完了へ最終編集。dispatchは状態メッセージを送りIDを`status-msg-id`へ保存し、起動プロンプトに done 指示を追加。

- [ ] **Step 1: cmd_notify を置き換え**

既存 `cmd_notify() { ... }` を以下で置き換える:

```bash
# notify: 節目の途中経過。milestoneを記録して状態メッセージを編集する（新規は出さない）。
cmd_notify() {
  local name="${1:-}"; [ -n "$name" ] || die "notify: 使い方 task.sh notify <name> <message...>"
  shift; validate_name "$name"
  local msg="$*"; [ -n "$msg" ] || die "notify: メッセージが空です"
  local dir="$STATE_ROOT/task-$name"; mkdir -p "$dir"
  printf '%s' "$msg" > "$dir/milestone"
  edit_status_or_post "$name"
}
```

- [ ] **Step 2: cmd_event を置き換え**

既存 `cmd_event() { ... }` を以下で置き換える:

```bash
# event: hooks用。stop=活動記録して状態編集（スロットルなし・pingしない）。attention=新規メッセージ＋10分スロットル。
cmd_event() {
  local name="${1:-}" type="${2:-}"; validate_name "$name"
  local dir="$STATE_ROOT/task-$name"; mkdir -p "$dir"
  case "$type" in
    stop)
      date +%s > "$dir/last-activity"
      edit_status_or_post "$name"
      ;;
    attention)
      local last_file="$dir/last-attention" now last
      now=$(date +%s)
      if [ -f "$last_file" ]; then
        last=$(cat "$last_file" 2>/dev/null || echo 0)
        if [ $((now - last)) -lt 600 ]; then
          echo "[task.sh] event attention: スロットリング中（$((now-last))秒、10分未満）"; return 0
        fi
      fi
      echo "$now" > "$last_file"
      post_webhook "⚠ [task/$name] 要対応（許可待ち/アイドル）"
      ;;
    *) die "event: 不明なイベント種別 '$type'（stop|attention）" ;;
  esac
}
```

- [ ] **Step 3: cmd_done を追加**

`cmd_event` 定義の直後に以下を追加する:

```bash
# done: 全タスク完了。新規メッセージ（✅・ping）＋状態メッセージを完了表示へ最終編集。
cmd_done() {
  local name="${1:-}"; [ -n "$name" ] || die "done: 使い方 task.sh done <name> <message...>"
  shift; validate_name "$name"
  local msg="$*"; [ -n "$msg" ] || die "done: メッセージが空です"
  local dir="$STATE_ROOT/task-$name"; mkdir -p "$dir"
  post_webhook "✅ [task/$name] 完了: $msg"
  printf '%s' "$msg" > "$dir/milestone"
  local id; id="$(cat "$dir/status-msg-id" 2>/dev/null || echo '')"
  { [ -n "$id" ] && discord_edit "$id" "$(render_status "$name" done)"; } || true
}
```

- [ ] **Step 4: main に done 分岐を追加**

`main()` の case 文の `notify)          cmd_notify "$@" ;;` の行の直後に、次を追加する:

```bash
    done)            cmd_done "$@" ;;
```

- [ ] **Step 5: cmd_dispatch の末尾通知を状態メッセージに変更**

`cmd_dispatch` 内の末尾にある

```bash
  post_webhook "🔧 [task/$name] dispatch完了: $wt（base $base）$([ "$no_claude" -eq 1 ] && echo ' / --no-claude' || echo '')"
  echo "[task.sh] dispatch完了: task/$name"
```

を、以下で置き換える:

```bash
  # 状態メッセージを送信しIDを保存（以降 notify/stop がこれを編集で更新する）。
  local sid
  sid="$(discord_post "$(render_status "$name")")"
  if [ -n "$sid" ]; then echo "$sid" > "$dir/status-msg-id"; echo "[task.sh] 状態メッセージID: $sid"
  else echo "[task.sh] 状態メッセージID取得できず（以降は新規POSTにフォールバック）"; fi
  echo "[task.sh] dispatch完了: task/$name"
```

- [ ] **Step 6: 起動プロンプトの notify 行を差し替え**

`cmd_dispatch` 内の `prompt_file` ヒアドキュメントにある

```
- 節目（フェーズ完了）と最終完了時、および判断に迷って停止する時は必ず
  ops/task.sh notify $name "<メッセージ>" を実行して進捗を通知すること。
```

を、以下で置き換える:

```
- 節目（フェーズ完了）や判断に迷って停止する時は ops/task.sh notify $name "<メッセージ>"
  で途中経過を通知すること（状態メッセージが編集で更新される・pingは飛ばない）。
- 全タスク完了時は必ず一度だけ ops/task.sh done $name "<完了要約>" を実行して完了を通知すること。
```

- [ ] **Step 7: 構文チェック**

Run: `bash -n ops/task.sh && echo SYNTAX_OK`
Expected: `SYNTAX_OK`

- [ ] **Step 8: スタブで通知ルーティングを統合テスト**

Run:
```bash
export OPS_HOME=/tmp/tnstate; rm -rf "$OPS_HOME"; mkdir -p "$OPS_HOME/state/task-demo"
cat > "$OPS_HOME/state/task-demo/meta.json" <<EOF
{"name":"demo","branch":"task/demo","base":"origin/develop","worktree":"/nonexistent","started_at":"$(date -Iseconds)"}
EOF
export TASK_WEBHOOK_URL=https://example/wh TASK_HTTP_STUB=/tmp/th; rm -rf /tmp/th
OPS_HOME=/tmp/tnstate ops/task.sh notify demo "Step 1完了"      # id無し → POST(フォールバック)
echo stub-msg-1 > "$OPS_HOME/state/task-demo/status-msg-id"
OPS_HOME=/tmp/tnstate ops/task.sh notify demo "Step 2完了"      # PATCH(編集)
OPS_HOME=/tmp/tnstate ops/task.sh event demo stop               # PATCH(編集)
OPS_HOME=/tmp/tnstate ops/task.sh event demo attention          # POST(新規)
OPS_HOME=/tmp/tnstate ops/task.sh event demo attention          # スロットル(記録なし)
OPS_HOME=/tmp/tnstate ops/task.sh done demo "全完了"            # POST(✅) + PATCH(最終編集)
echo "=== calls ==="; cut -f1 /tmp/th/calls
```
Expected: `calls` の1列目が上から `POST / PATCH / PATCH / POST / POST / PATCH`（attentionの2回目はスロットルで行が増えない＝計6行）。`milestone`・`last-activity` が記録されている。

- [ ] **Step 9: コミット**

```bash
git add ops/task.sh
git commit -m "feat(ops): task.sh notify/stop edit status in place; attention/done post new; dispatch seeds status message"
```

---

### Task 4: 検証・仕上げ

**Files:** Modify `ops/task.sh`（先頭コメントに通知仕様を1行追記）

- [ ] **Step 1: 先頭コメントに通知方式を追記**

`ops/task.sh` の設計コメント（`# 設計の正:` の行の直後）に、次の1行を追加する:

```bash
# 通知: dispatchで状態メッセージを1つ送り、notify/stopはそれを編集で更新、attention/doneは新規メッセージ（ping）。
```

- [ ] **Step 2: 後方互換の確認（status-msg-id無しでnotifyが新規POSTになる）**

Run:
```bash
export OPS_HOME=/tmp/tnstate2; rm -rf "$OPS_HOME"; mkdir -p "$OPS_HOME/state/task-old"
cat > "$OPS_HOME/state/task-old/meta.json" <<EOF
{"name":"old","branch":"task/old","base":"origin/develop","worktree":"/nonexistent","started_at":"$(date -Iseconds)"}
EOF
export TASK_WEBHOOK_URL=https://example/wh TASK_HTTP_STUB=/tmp/th2; rm -rf /tmp/th2
OPS_HOME=/tmp/tnstate2 ops/task.sh notify old "進捗"
cut -f1 /tmp/th2/calls
```
Expected: `POST`（status-msg-id が無いので新規POSTにフォールバック）。

- [ ] **Step 3: 名前検証がdoneでも効くこと**

Run: `OPS_HOME=/tmp/tnstate2 ops/task.sh done "Bad Name" x 2>&1 | head -1`
Expected: `task.sh: 不正なタスク名 'Bad Name'（許可: [a-z0-9-] のみ）`

- [ ] **Step 4: 最終構文チェック**

Run: `bash -n ops/task.sh && echo ALL_SYNTAX_OK`
Expected: `ALL_SYNTAX_OK`
（`ops/task.sh` のみの変更で src/api/ビルドには触れないため pnpm ビルドは不要）

- [ ] **Step 5: コミット**

```bash
git add ops/task.sh
git commit -m "docs(ops): note task.sh notification model in header comment"
```

- [ ] **Step 6: 停止（レビュー待ち）**

push・マージはしない。人間のレビューを待つ。完了時は
`ops/task.sh done <自名> "task.sh通知最適化 実装完了・全検証通過・pushしていない"` を実行して通知する。

---

## 受け入れ条件（全て満たすこと）

1. `bash -n ops/task.sh` が通る
2. dispatch → `discord_post`（POST_WAIT）1回・`status-msg-id` 保存（スタブID）
3. notify（status-msg-id あり）→ PATCH（編集）、`milestone` 記録
4. event stop → PATCH（編集）、`last-activity` 記録、連続でもスロットルされない
5. event attention → POST（新規）、10分スロットルが効く
6. done → POST（✅ 完了）＋ PATCH（最終編集・完了表示）
7. status-msg-id 無し（古いタスク）→ notify/stop が POST にフォールバック
8. `render_status` が経過・最新（milestone）・最終活動を含む
9. 名前検証が done でも不正名を拒否する
10. コミットが論理単位で分かれ、どれも push されていない
