# v1.2.0 Phase A: リリース完了 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v1.2.0（サブスク基盤）を本番Stripeキーで実際に稼働する状態にする。新規コードはほぼなく、既存の未コミット変更のデプロイと動作検証が中心。

**Architecture:** ラズパイ4上の`/home/pi/lms-task-watcher`（`develop`ブランチ、リポジトリと同一）でAPIをpm2運用。`pm2-env.sh`スクリプトでテスト/本番用の環境変数（`.env.test` / `.env.production`）を切り替える。

**Tech Stack:** Node.js + Express（`api/`）、SQLite、Stripe、pm2、Cloudflare Tunnel。

## Global Constraints

- ラズパイへのSSH: `ssh -i ~/.ssh/lmspi_key pi@100.98.8.76`（Tailscale経由）
- pm2コマンドはログインシェルでもnvmが自動ロードされないため、都度 `export NVM_DIR=$HOME/.nvm; [ -s $NVM_DIR/nvm.sh ] && . $NVM_DIR/nvm.sh;` を前置する
- `api/.env.test`・`api/.env.production`の内容は絶対にcat・echoで出力しない（クレデンシャル）。存在確認は`ls`のみ
- 本番切り替え（Task 4）の実行前に必ずユーザーへ確認を取る
- ラズパイ側の`api/routes/webhook.js`・`api/server.js`は2026-07-02時点でリポジトリと同一の未コミット差分を持つことを確認済み（設計書 `docs/superpowers/specs/2026-07-02-v120-release-completion-design.md` 参照）。新規コード変更はしない、コミットのみ

---

### Task 1: ラズパイAPI変更をコミット・push

**Files:**
- Modify (raspi上のみ, リポジトリと同一パス): `api/routes/webhook.js`, `api/server.js`, `api/package-lock.json`

**Interfaces:**
- 変更なし。既存の未コミット差分をそのままコミットするだけ（ロジック変更は既に適用済み）

- [ ] **Step 1: 差分を再確認する**

Run:
```bash
ssh -i ~/.ssh/lmspi_key pi@100.98.8.76 "cd /home/pi/lms-task-watcher && git status --short && git diff --stat"
```
Expected: `api/routes/webhook.js`, `api/server.js`, `api/package-lock.json` が modified、`.env.production`/`.env.test`が untracked のまま表示される

- [ ] **Step 2: コミットする**

Run:
```bash
ssh -i ~/.ssh/lmspi_key pi@100.98.8.76 "cd /home/pi/lms-task-watcher && git add api/routes/webhook.js api/server.js api/package-lock.json && git commit -m 'fix(api): handle null period_end, add checkout redirect routes'"
```
Expected: commit succeeds, `.env.*` ファイルは`git status`から消えない（stageされていないことを確認）

- [ ] **Step 3: pushする**

Run:
```bash
ssh -i ~/.ssh/lmspi_key pi@100.98.8.76 "cd /home/pi/lms-task-watcher && git push origin develop"
```
Expected: push succeeds、`git log --oneline -3`で新しいコミットがdevelopの先頭に来る

- [ ] **Step 4: ローカルのdevelopにpullして反映を確認**

Run:
```bash
git pull origin develop
git log --oneline -3
```
Expected: ラズパイでコミットした内容がローカルにも反映される

---

### Task 2: テスト決済の再実行と検証

**Files:** なし（コード変更なし、動作検証のみ）

**Interfaces:**
- 検証対象: `POST /webhook/stripe`（`checkout.session.completed`ハンドラ）が`current_period_end`を正しくDBに保存すること
- 検証対象: 拡張機能のプレミアム設定パネルが`getSubscriptionCurrentPeriodEnd()`（`src/core/auth.ts`、呼び出し元 `src/App.tsx`）経由で次回請求日を表示すること

- [ ] **Step 1: pm2ログを監視状態にする**

Run:
```bash
ssh -i ~/.ssh/lmspi_key pi@100.98.8.76 "export NVM_DIR=\$HOME/.nvm; [ -s \$NVM_DIR/nvm.sh ] && . \$NVM_DIR/nvm.sh; pm2 logs letus-api --lines 0"
```
（バックグラウンドで実行し、決済完了までログを見続ける。ユーザーの決済操作を待つ）

- [ ] **Step 2: ユーザーがテスト決済を実行**

ユーザーがブラウザで拡張機能からアップグレードフローを開始し、Stripeテスト用カード（`4242 4242 4242 4242`）で決済を完了する。この操作はユーザー自身が行う。

- [ ] **Step 3: Webhookログを確認**

pm2ログに`checkout.session.completed`受信と、`current_period_end`取得成功のログ（またはエラーがないこと）を確認する。`console.error('Failed to fetch subscription period_end:', ...)`が出ていないことを確認する。

- [ ] **Step 4: DBの値を直接確認**

Run:
```bash
ssh -i ~/.ssh/lmspi_key pi@100.98.8.76 "sqlite3 /home/pi/lms-task-watcher/api/data/app.db 'SELECT user_id, status, stripe_customer_id, current_period_end FROM subscriptions ORDER BY updated_at DESC LIMIT 1;'"
```
Expected: `current_period_end`がnullではなく、決済時刻から約1ヶ月後のISO日時になっている

- [ ] **Step 5: 拡張機能側の表示を確認**

拡張機能のダッシュボード→プレミアム設定パネルを開き、次回請求日が Step 4 の値と一致することを確認する（不一致ならキャッシュ更新ロジック `subscriptionCheckedAt` 周りを疑う）

---

### Task 3: v1.2.0フルフローE2Eテスト

**Files:** なし（動作検証のみ）

**Interfaces:**
- 検証対象: 未登録ユーザーの新規登録〜プレミアム機能利用までの一連のフロー

- [ ] **Step 1: 未登録メールで新規登録**

拡張機能から新規メールアドレスで登録し、ログイン状態まで到達することを確認する（メール確認フローは実装されていないため、登録完了＝ログイン済み）

- [ ] **Step 2: チェックアウトへ遷移**

ログイン後、アップグレードボタンからStripe Checkoutページに遷移することを確認する（`ProBanner`のログイン済み分岐 — 直接チェックアウトに飛ぶこと）

- [ ] **Step 3: テスト決済とWebhook受信を確認**

Task 2と同様の手順でテスト決済を行い、pm2ログで`checkout.session.completed`受信を確認する

- [ ] **Step 4: サブスク有効化とプレミアム機能利用を確認**

拡張機能を開き直し（または起動時の自動フェッチで）`subscriptionStatus`が`active`になること、プレミアム機能（メモ・優先度・テーマ変更など）が実際に操作できることを確認する

- [ ] **Step 5: 結果をWORKLOG.mdに記録**

`WORKLOG.md`にE2Eテスト結果（成功/失敗、確認した項目）を追記する。[[feedback_worklog_frequency]]の方針に従う

Run:
```bash
git add WORKLOG.md
git commit -m "chore: record v1.2.0 E2E test results"
```

---

### Task 4: 本番モードへの切り替え

**Files:** なし（ラズパイ上の環境切り替えのみ）

**Interfaces:**
- 使用スクリプト: `~/pm2-env.sh prod`（内容は既存、変更しない）

- [ ] **Step 1: ユーザーに実行確認を取る**

Task 1〜3が全て成功したことを踏まえ、本番Stripeキーへの切り替えを実行してよいか、ユーザーに明示的に確認する（本番決済が実際に発生するようになるため）

- [ ] **Step 2: 本番モードへ切り替え**

Run:
```bash
ssh -i ~/.ssh/lmspi_key pi@100.98.8.76 "bash ~/pm2-env.sh prod"
```
Expected: スクリプトが正常終了し、pm2プロセスが再起動する

- [ ] **Step 3: プロセス状態を確認**

Run:
```bash
ssh -i ~/.ssh/lmspi_key pi@100.98.8.76 "export NVM_DIR=\$HOME/.nvm; [ -s \$NVM_DIR/nvm.sh ] && . \$NVM_DIR/nvm.sh; pm2 list"
```
Expected: `letus-api`が`online`状態、直近再起動時刻が切り替え実行時刻と一致する

- [ ] **Step 4: 本番エンドポイントの疎通確認**

Run:
```bash
curl -s https://api.waiteu.dev/health
```
Expected: `{"ok":true}`（HTTP 200）

- [ ] **Step 5: WORKLOG.mdに本番切替を記録**

Run:
```bash
git add WORKLOG.md
git commit -m "chore: switch v1.2.0 backend to production Stripe mode"
```

---

## 完了条件

- Task 1〜4の全チェックボックスが完了
- 本番Stripeキーでの決済が実際に成功し、`current_period_end`が正しく表示される
- Chrome Web Store申請（Phase C）はこの時点では行わない — Phase B（付加価値機能）完了後に着手する
