# 朝の開発ダイジェスト（ops/dev-digest.sh）設計

日付: 2026-07-05
ステータス: 承認済み（対話でC＝残タスク+進捗の統合サマリー / 毎朝必ず送る / 新チャンネル#dev-digest / LLM要約レイヤーをAPIキー＋自前予算＋Haiku 4.5で含める、を確定）

## 目的

残タスクの棚卸しと前日の進捗を、毎朝1通のダイジェストとして受け取る。
「今これだけ残っている」を忘れず、「昨日何が進んだか」を振り返るため。
既存の監視4本（nightly/canary/raspi-health/competitor-watch）と同じ
決定論的・トークン消費ゼロのopsスクリプトとして追加し、朝の開発ヘルスチェックに並べる。

## スコープ

- 対象: デスクトップWSL2の既存ops基盤。run.sh経由でCIクローン（origin/develop同期）を読む
- 読むのは常に **push済みの develop**。作業中・未pushの内容は映らない（監視系と同じ挙動・意図的）
- **土台は決定論（トークンゼロ）**で全項目を機械的に算出する。その上に**任意のLLM要約1行**を
  重ねる二層構成。LLM層は予算・計測・自動停止のガード付き（後述）で、無効化すれば
  既存監視4本と同じゼロトークン運用に戻る
- 送信先は #dev-digest（新チャンネル）専用webhook。監視アラート(#ops-alerts)とは分離

## 送信内容

1通のDiscordメッセージ（≤1900字、超過分は切り詰め）。以下3項目は**決定論**（トークンゼロ）:

1. **残タスク**: TASKS.md の `[ ]`(未着手)と `[~]`(進行中)の件数、および優先度見出し(`##`)
   ごとの項目名一覧。各節が長い場合は先頭数件＋「ほかN件」で切り詰め
2. **昨日の動き**:
   - **完了になったタスク**: 前回実行時のTASKS.mdスナップショットとの差分で `[x]` に
     変わった項目（項目名の見出し行テキスト）
   - **コミット**: 前回実行時刻以降の origin/develop コミット件名一覧（`git log --since` /
     または前回HEADからの範囲）
   - **自走タスク**: `ops/task.sh list` の走行中(tmux alive)セッション件数（0なら省略可）
3. **次の候補**: TASKS.md で最上位の未完了タスク（ファイル先頭＝優先度が高い順）を1件

加えて、LLM層が有効なときは末尾に **AI要約1行**（今日の注目点）と **消費状況1行** を付ける。

### メッセージ書式（例）

```
📋 開発ダイジェスト 7/6(月)
残: 未着手7 / 進行中0
  収益化: entitlement実装 / パス型決済 / 統計・スヌーズ / Chrome申請
  v2.0.0: RNセットアップ / LETUS収集 ほか5件
昨日: ✅完了0  📝コミット3件（task.shマージ ほか）  🔧自走0
次の候補: entitlement変更の実装
🧠 要約: 昨日はops基盤（task.sh）を完成させた。残タスクは収益化に集中しており次はentitlement実装が本丸。
📊 AI消費: 今月 $0.09/$0.50 (18%) ・ 今日 1,240 tokens
```

決定論の土台だけで意味が通る書式にし、LLMの2行は付加。LLM層が無効・予算到達・
APIキー未設定なら、`🧠`/`📊` の2行を落として決定論部分だけ送る。

## 新規・変更するもの

- **`ops/dev-digest.sh`（新規）**: 本体。common.shをsourceし、上記を組み立てて投稿
- **`ops/lib/common.sh`（変更）**: 現在 `notify()` は `OPS_WEBHOOK_URL` 固定。
  送信先URLを引数に取る `notify_to <url> <msg>` を追加し、既存 `notify()` は
  `notify_to "$OPS_WEBHOOK_URL" "$msg"` を呼ぶ薄いラッパに変更（後方互換）。
  dev-digestは `notify_to "$DEV_DIGEST_WEBHOOK_URL" "$msg"` を使う
- **`~/ops/ops.env`（リポジトリ外）**: `DEV_DIGEST_WEBHOOK_URL` を追記
  （ユーザーがDiscord UIで#dev-digest作成→URLを受領後に配線）
- **状態 `~/ops/state/dev-digest/`（リポジトリ外）**:
  - `tasks-prev.md` — 前回実行時のTASKS.mdスナップショット（完了差分の基準）
  - `last-run` — 最終実行時刻（epoch秒、コミット範囲の下限）
- **スケジューラ**: Windowsタスク `LMS-DevDigest` を毎日07:15に登録
  （raspi 07:00 と canary 07:30 の間）。run.sh経由で `dev-digest` を渡す

## データの算出方法（決定論・詳細）

- **残タスクのカウント/一覧**: `grep -E '^\s*- \[ \]'` と `[~]` を数える。
  優先度見出しは `grep -nE '^## '` で区切りを取り、各見出し配下の未完了項目のタイトルを抽出。
  **タイトル抽出はチェックボックス接頭辞 `- [ ] ` / `- [~] ` を除去し、`**`マーカーがあれば
  剥がして先頭〜40字程度で切る**（太字必須にしない。v2.0.0系の非太字項目も拾えるように）
- **完了差分**: 現在のTASKS.mdと `tasks-prev.md` を比較。前回 `[ ]`/`[~]` で今回 `[x]` に
  なった行を「完了」として拾う。比較後、現在のTASKS.mdを `tasks-prev.md` に上書き保存
- **コミット範囲**: `last-run` があればそのepoch以降を `git -C <CI> log --since=@<epoch>`、
  無ければ直近24時間。実行後に現在時刻を `last-run` に保存
- **自走タスク**: `<CI>/ops/task.sh list` を呼び、TMUX列が alive の行数を数える
  （task.shはstate読み取りのみで副作用なし。CIクローンのtask.shで可）
- **次の候補**: TASKS.md を上から走査し最初の `[ ]`/`[~]` 項目のタイトル（上記の抽出方法で）

## LLM要約レイヤー（トークン計測・予算・自動停止つき）

決定論の土台を組み立てた後、その要約テキストをAnthropic APIに渡して
「今日の注目点」を1〜2文で生成する。呼び出しは raw HTTP（curl）で行い、
既存opsのcurl運用と揃える。SDKやPythonプロジェクトは導入しない（JSON整形はpython3で）。

### モデルと呼び出し

- モデル: `claude-haiku-4-5`（最安・日次要約に十分）。入力$1 / 出力$5 per MTok
- `POST https://api.anthropic.com/v1/messages`、ヘッダ `x-api-key: $ANTHROPIC_API_KEY`・
  `anthropic-version: 2023-06-01`・`content-type: application/json`
- ボディ: `{"model":"claude-haiku-4-5","max_tokens":300,"system":<簡潔な指示>,
  "messages":[{"role":"user","content":<決定論ダイジェスト全文>}]}`。
  thinking/effort/temperature等は付けない（Haiku 4.5は最小構成で呼ぶ）
- `max_tokens:300` が1回あたり出力の**ハード上限**。入力は決定論ダイジェスト（数千トークン）に限定
- 応答から `.content[0].text`（要約）と `.usage.input_tokens`/`.output_tokens` を python3で取り出す

### トークン会計（台帳）

- `~/ops/state/dev-digest/token-ledger.jsonl` に1呼び出し1行を追記:
  `{"date":"2026-07-06","model":"claude-haiku-4-5","input":6120,"output":180,"cost_usd":0.0015}`
- コスト = input/1e6×1 + output/1e6×5（Haiku 4.5料金）
- **正確なトークン数はAPI応答の`usage`が返す**ので、推定ではなく実測を記録する

### 予算とサーキットブレーカー（想定超過で自動停止）

`~/ops/ops.env` に設定（すべて任意、未設定なら安全側=LLM無効）:
- `DIGEST_LLM_ENABLED`（`1`で有効。既定=無効）
- `ANTHROPIC_API_KEY`（APIキー。未設定ならLLM層は動かない）
- `DIGEST_MONTHLY_BUDGET_USD`（既定 `0.50`。日次見積$0.01×31≒$0.3に対し余裕）

呼び出し前チェック（順に評価、1つでも該当ならLLMをスキップして決定論のみ送信）:
1. `DIGEST_LLM_ENABLED != 1` または `ANTHROPIC_API_KEY` 未設定 → スキップ（通知に注記しない）
2. **キルスイッチ** `~/ops/state/dev-digest/llm-disabled` が存在 → スキップし、
   本文に「AI要約は自動停止中（手動で再開が必要）」を注記
3. 台帳から**今月の累計コスト**を集計（「今月」=カレンダー月。台帳の`date`が現在の
   `YYYY-MM` で始まる行を合算）。`累計 ≥ DIGEST_MONTHLY_BUDGET_USD` →
   `llm-disabled` を作成し、#dev-digest に「⚠ AI要約が今月の予算$Xに到達したため停止。
   再開は llm-disabled を削除」を通知。以降は手動で再開するまで止まったまま

呼び出し後チェック:
4. 台帳に追記後、今月累計が予算を超えていたら `llm-disabled` を作成（翌日から止まる）

**設計意図**: 「予想外に食っていたら中止」を、①1回の出力上限（`max_tokens`）②月予算での
事前ブロック ③超過時のキルスイッチ＝止まったまま（勝手に再開しない）、の3段で担保する。
再開は人間が `llm-disabled` を消す明示操作。silent に課金が続くことはない。

### 消費の可視化（数日ぶんの確認）

- 毎朝の本文に `📊 AI消費: 今月 $X/$予算 (Z%) ・ 今日 N tokens` を出す
- `ops/dev-digest.sh --usage [日数]`（既定14）: 台帳から直近N日を日付・トークン・コストで
  一覧し、今月累計と予算残を表示。数日ぶんの傾向を目視できる

### 事前準備（ユーザー側・手動）

- Anthropic Console（console.anthropic.com）でAPIキーを発行し `~/ops/ops.env` に
  `ANTHROPIC_API_KEY='sk-ant-...'` を追記。**これはMax x5プランとは別のAPI従量課金**
- `DIGEST_LLM_ENABLED=1` を追記して有効化（キー追加だけでは動かない二重の明示）
- キー未設定のうちは決定論ダイジェストだけが毎朝届く（LLM層は自動的にオフ）

## 安全側の挙動（error handling）

- `DEV_DIGEST_WEBHOOK_URL` 未設定 → 投稿せずログのみ（**#ops-alertsにフォールバックしない**）。
  チャンネル作成前にスケジュール登録しても誤爆しない
- **初回実行**: `tasks-prev.md` が無い → 「完了になったタスク」節を省略し、
  現在のスナップショットを基準として保存。翌日から差分が出る
- TASKS.md欠落 → その旨1行通知。git失敗 → コミット節を省略。
  いずれも取れた分だけ送って落ちない（`set -u`、致命的でない失敗は握りつぶす）
- **LLM呼び出しの失敗**（APIエラー・タイムアウト・4xx/5xx・応答パース失敗）→
  その回のAI要約2行を落として決定論ダイジェストは通常どおり送る。台帳には記録しない
  （失敗＝課金なし、または不明なので）。curlは `--max-time 30` で上限を切る
- **`stop_reason`確認**: 応答が `refusal` 等でテキストが空でも落ちない（要約2行を省略）

## テスト方針

- **`--dry-run`**: 投稿せずメッセージをstdoutに出力するモードを用意
- **完了差分**: 偽の `tasks-prev.md`（一部を `[ ]` にしたコピー）を置いて実行し、
  差分が「完了」として出ることを確認
- **未設定ガード**: `DEV_DIGEST_WEBHOOK_URL` 未設定で投稿スキップ・ログのみを確認
- **LLM無効時**: `DIGEST_LLM_ENABLED` 未設定/`ANTHROPIC_API_KEY`未設定で
  決定論ダイジェストのみ（`🧠`/`📊`行なし）になることを確認
- **サーキットブレーカー**: 偽の台帳（累計が予算超のjsonl）を置いて実行し、
  LLMがスキップされ `llm-disabled` が作られ注記が出ることを確認
- **LLM実呼び出し**: `DIGEST_LLM_ENABLED=1`＋テスト用少額予算で1回実行し、
  要約が出て台帳に実測usageが記録されることを確認（キーはテスト時のみ一時設定）
- **`--usage`**: 台帳から直近N日の集計が出ることを確認
- **実投稿**: テスト用webhook（または本番#dev-digest）に1回送って書式を目視確認
- `bash -n ops/dev-digest.sh` / shellcheck（あれば）

## 将来拡張（今回はやらない）

- 週次のロールアップ（残タスクの増減トレンド）
- 進捗ゼロが続いた場合のリマインド強調
- LLMモデルの自動切替（普段Haiku、大きな動きがあった日だけSonnetでリッチにするなどはYAGNI）
