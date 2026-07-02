# 作業ログ

作業の進捗・決定事項・問題と修正を時系列で記録する。

---

## 2026-07-02 — Webアカウント登録・パスワード再設定機能を実装完了

Subagent-Driven Developmentで8タスクを実装（コミット`d73a301`〜`3dcafe2`、最終review-fixとして`91aed7b`）。

- `api/lib/email.js`: Resendによるメール送信モジュール
- `password_reset_tokens`テーブル + `POST /api/auth/request-password-reset`・`POST /api/auth/reset-password`
- CORSに`https://lms.waiteu.dev`を追加、`/checkout-success`の文言を未インストールユーザー向けに修正
- `landing/register.html`・`forgot-password.html`・`reset-password.html`（素のHTML/JS）
- 拡張機能`LoginModal`に`forgot`モードを追加

各タスクは実装→レビューの2段階チェックを経て全て承認（Spec ✅、Minor指摘のみ）。最終全体レビューで`api/.env.example`に新規環境変数（`RESEND_API_KEY`・`RESEND_FROM_EMAIL`）が抜けている点のみ指摘され、修正済み。

### 事故: api/node_modulesの一時破損

作業途中、コマンドの`cd api &&`チェーンが後続コマンドにも影響し、誤って`api/`配下でpnpmコマンドを実行してしまい、`node_modules`がpnpm構造に変換され`better-sqlite3`のネイティブバイナリが壊れた（`api/pnpm-lock.yaml`・`api/pnpm-workspace.yaml`も誤生成）。該当ファイルを削除し`npm install && npm rebuild better-sqlite3 bcrypt`で復旧、テスト全件成功を再確認した。

### 未実施・要フォローアップ

- Resendアカウント作成・送信ドメインのDNS認証（ユーザー側の作業）
- ラズパイの`.env`・`.env.production`・`.env.test`に`RESEND_API_KEY`・`RESEND_FROM_EMAIL`を追加
- 実際のブラウザでの動作確認（登録→Stripeチェックアウト→パスワード再設定メール受信→新パスワード設定→ログイン）は未実施
- `develop`は`main`から104コミット先行中。main へのマージ・PRはPhase C（Phase B完了後）まで行わない方針を維持

---

## 2026-07-02 — Phase A完了: 本番モードへ切り替え

`bash ~/pm2-env.sh prod`を実行し本番Stripeキーへ切り替え。`letus-api`再起動・ヘルスチェック正常を確認。

これでv1.2.0 Phase A（リリースを本番稼働させるための残タスク）が全て完了。次はPhase B（付加価値機能: Discord→カスタム通知ルール→統計→スヌーズ）、およびユーザーから追加要望のあったアカウント・Webサイト機能（パスワード再設定・ホームページ登録・マイページ）の設計に進む。

---

## 2026-07-02 — Phase A: テスト決済検証・E2Eテスト完了、current_period_endバグ修正

### 発覚した問題1: pm2再起動漏れ

Task 1で`webhook.js`・`server.js`をラズパイ上でコミットしたが、pm2プロセスを再起動していなかったため、実際に動いているサーバーは2026-06-29時点の古いコードのまま稼働していた。ユーザーが最初に行ったテスト決済（`user_id=5`）は旧コードで処理され、`current_period_end`がnullのまま記録された。`pm2 restart letus-api`で修正版を反映。

### 発覚した問題2: Stripe APIバージョンの仕様変更

pm2再起動後も再テスト決済（`user_id=6`）で`current_period_end`がnullのままだった。調査の結果、**Stripeの現行APIバージョンでは`current_period_end`がSubscriptionオブジェクト直下ではなく`items.data[0].current_period_end`に移動している**ことが判明（実際のテストサブスクリプションで確認: `sub.current_period_end` = undefined、`sub.items.data[0].current_period_end` = 実値）。

`api/routes/webhook.js`に`getPeriodEndIso()`ヘルパーを追加し、`items.data[0].current_period_end`を優先的に参照（旧APIバージョンのアカウント向けにトップレベルへのフォールバックも維持）。コミット`4328460`、ラズパイにpull・再起動して反映。

### 検証結果

- 3回目のテスト決済（`user_id=7`）で`current_period_end`が正しく記録されることを確認（`2026-08-02T05:50:28.000Z`）
- 拡張機能のプレミアム設定パネルで次回請求日（8月2日）が正しく表示されることを確認
- プレミアム機能（メモ・優先度編集/テーマ切替）が実際に操作できることを確認
- Task 2（テスト決済検証）・Task 3（v1.2.0フルフローE2Eテスト: 登録→ログイン→決済→Webhook→サブスク有効化→プレミアム機能利用）完了

### 追加実装: 手動追加課題のプレミアムメモ対応

サブスクライバーは手動追加課題にもメモ・優先度を編集できるよう`AssignmentMemo`をダッシュボードの4セクション（24時間以内/明日まで/今週/それ以降）に接続。作成時に入力したメモをプレミアムメモストレージにも同時保存し、編集可能な状態で引き継がれるようにした（コミット`138bd92`）。

### 新規要望（Phase A完了後に着手予定）

ユーザーから以下3件の要望を受領、Phase A完了後に個別にブレインストーミングして設計する方針（詳細はメモリ`project_v120_phasing.md`参照）:
1. パスワード再設定機能（メール送信基盤の新規構築が前提）
2. ホームページからのアカウント登録・サブスク申し込み
3. マイページ機能（支払い方法更新・次回請求日・統計情報表示）。拡張機能の動作に関わる設定（テーマ切替等）は引き続き拡張機能ダッシュボード側で管理する方針

---

## 2026-07-02 — v1.2.0本格開発着手、qa/v1.1.x-releaseをdevelopにマージ

### 経緯

v1.2.0の残タスク（Phase A）着手前に、`develop`が`qa/v1.1.x-release`から35コミット分（手動課題タイムライン統合・通知ID固定化・バッジ修正等）遅れていることが判明。ユーザー確認のうえ、先に全件マージしてからPhase Aを続行する方針にした。

### 対応

- `git merge qa/v1.1.x-release` を実行、実コンテンツ衝突4ファイル（`public/changelog.html`, `src/App.css`, `src/App.tsx`, `src/content/manualTaskWidget.ts`）を手動解決
  - `App.tsx`: developの独立`ManualAssignmentSection`を廃止し、qaの統合タイムライン（`mergeTimeline`+`ManualAssignmentCard`）を採用。`AssignmentMemo`は元々のスコープ通り`scan`種別のみに再接続
  - `manualTaskWidget.ts`: qa側の新しい型・CRUD関数を採用。その過程で **qa側に未定義変数`enabledCourses`参照のバグ（2026-06-29に一度修正したはずの「有効/無効に関わらず全コース表示」の巻き戻り）を発見し修正**
- マージ後 `pnpm tsc -b` エラーなし、`vitest run` 82/82件成功（`api/tests/*`のjest形式失敗はマージ前から存在する既知の問題で無関係）、`pnpm build` 成功を確認
- コミット `a267155` としてpush済み

### 一時的な混乱（マージ失敗→reset）

初回の`git merge`試行時にgitが中途半端な状態（`.git/MERGE_HEAD`なしだがワーキングツリーにリネーム・削除が部分適用）を残した。未コミット変更のみだったため、ユーザー確認のうえ`git reset --hard HEAD`で復元してから再実行した。

---

## 2026-07-01 — バージョンロードマップ確定

### 決定事項

今後のバージョン展開を整理・確定した。設計書: `docs/superpowers/specs/2026-07-01-version-roadmap-design.md`

- v1.1.0（手動課題追加）はv1.2.0を待たず**単独で**ベータテスト結果待ち→ストア審査提出する
- v1.2.x: サブスク付加価値追加（Discord→カスタム通知→統計→スヌーズ、優先度は変更なし）
- v1.3.0: データ同期基盤（旧TASKS.md「フェーズ2.5」を名称変更のみで踏襲）
- v2.0.0: モバイルアプリ新規リリース。**旧フェーズ4（時間割連携）を独立の先行フェーズとせず、v2.0.0の初期スコープに統合**（モバイルアプリは課題管理＋時間割を最初からセットで出す方針のため）

### 対応したドキュメント整理

- `TASKS.md`: 重複していた「フェーズ2.5」「フェーズ4」セクションを解消し、「v1.3.0」「v2.0.0」の見出しに統一
- メモリ: `project_branch_strategy.md`のバージョン計画、`project_subscription_plan.md`のフェーズ表記を更新。新規メモリ`project_version_roadmap.md`を作成

---

## 2026-06-29

### manualTaskWidget: enabledCourses フィルタ削除

**変更ファイル:** `src/content/manualTaskWidget.ts`

**問題:** `initManualTaskWidget()` 内で `courses.filter(c => c.enabled)` を使い、有効化済みコースのみに絞り込んでいた。その結果、コースが未有効化の状態ではウィジェットが表示されない。

**修正:** `enabledCourses` 変数を削除し、`courses` をそのまま渡すように変更。コースが1件も存在しない場合のみ早期リターン。

**理由:** ウィジェット（手動課題追加ボタン）はコースの有効/無効に関わらず表示すべき。有効/無効フィルタはダッシュボード表示側の責務。

---

### changelog 対応（直前コミット群）

- `feat(changelog)`: ロードマップのアコーディオン化、価格表示削除
- `fix(changelog)`: MV3 CSP 準拠のため外部スクリプト方式に変更
- `feat(changelog)`: Phase 2 をサブスク tier と明記、注釈追加
- 月額料金はユーザー向け UI に表示しない方針を決定（→ memory: `feedback_pricing_display.md`）

---

### ブランチ状況

- `develop` ブランチで v1.1.0 サブスク機能開発中
- `main` は v1.0.x バグ修正のみ
- 直前リリース: v1.1.0（手動課題追加・スキャン済みインジケーター）

---

## 2026-06-29（続き）— v1.2.0 ベータテスト・UI整備

### セッションで完了したこと

**バックエンド修正（ラズパイ）**
- `STRIPE_PRICE_ID` が `.env.test` ではなく `.env` のみ更新されていたバグを修正（`pm2-env.sh` が `.env.test` を上書きコピーする仕様だった）
- `webhook.js`: `customer.subscription.created` で `current_period_end` が null のとき `toISOString()` クラッシュ → null チェック追加
- `webhook.js`: `checkout.session.completed` でルートハンドラを async 化し、Stripe API から subscription を取得して `current_period_end` を即保存。これにより `customer.subscription.created` との競合に関係なく初回から次回請求日が正しく記録される
- `server.js`: `/checkout-success`・`/checkout-cancel` ルートを追加（Stripe 決済後のリダイレクト先）
- `server.js`: 壊れた heredoc 残骸（クォートなしルート）を修正

**フロントエンド修正（Chrome拡張）**
- `content.js` SyntaxError 修正: `manualTaskWidget.ts` の import を削除し、storage 関数をインライン化してコンテンツスクリプトを自己完結に
- `auth.ts`: `getAuthEmail()`・`getSubscriptionCurrentPeriodEnd()` 追加、`saveAuthSession` に email 引数追加、`clearAuthSession` に email キー追加
- `ProBanner`: ログイン済みの場合にメールアドレス表示、直接チェックアウト対応
- `LoginModal`: 登録・ログイン時にメールを auth storage に保存
- プレミアム設定パネル再設計: アカウントメール・次回請求日・利用可能機能一覧
- PRO → Premium に統一（バッジ・カード・モーダル全体）
- 機能リストに v1.1 機能（手動課題追加・LETUS インジケーター）を追加
- 起動時にサーバーから最新サブスク状態を取得してキャッシュ更新（Stripe 決済後に拡張を開くだけで有効化される）

### ブランチ状況（更新）

- `main`: v1.0.x（ストア審査用）
- `release/v1.1.x`: v1.1.0 リリースコミット `a748924` から新規作成・push 済み。v1.1.x のバグ修正はここで行い develop に cherry-pick
- `develop`: v1.2.0 サブスク機能開発中。最新コミット `eb9e463`

### 残タスク

- [ ] ラズパイの `webhook.js`・`server.js` 変更をリポジトリにコミット（現状は直接ファイル編集のみ）
- [ ] テスト決済を再実行して次回請求日表示を確認
- [ ] v1.2.0 フルフロー E2E テスト（登録→決済→サブスク有効→プレミアム機能）
- [ ] テスト完了後に本番モードへ切り替え（`bash ~/pm2-env.sh prod`）
- [ ] ラズパイ MicroSD → SSD 移行（次セッション予定）

---

## 2026-06-30 — ラズパイ セキュアリモートアクセス & サーバー監視環境構築

### セッションで完了したこと

**セキュリティ構成（外部ネットワークからの開発アクセス）**
- Tailscale（WireGuard VPN）をラズパイ・開発PCの両方にインストール・接続完了
  - ラズパイ Tailscale IP: `100.98.8.76`（tailnet: `y2studyabout@gmail.com`）
  - 開発PC Tailscale IP: `100.125.177.110`
- ufw を設定: SSH(22)・監視ツールポートを tailscale0 経由のみ許可、外部ポート開放なし
- fail2ban を設定: SSH 3回失敗で1時間 BAN
- SSH パスワード認証を無効化（鍵認証のみ）
  - 使用鍵: `~/.ssh/lmspi_key`
- 接続コマンド: `ssh -i ~/.ssh/lmspi_key pi@100.98.8.76`（または `ssh raspi`）

**サーバー監視環境**
- Glances v4.5.5 をインストール（venv: `/opt/glances-venv`、uvicorn で動作）
  - アクセス: `http://100.98.8.76:61208`（tailscale0のみ）
- Cockpit v337 をインストール（systemd サービス管理 WebUI）
  - アクセス: `https://100.98.8.76:9090`（tailscale0のみ）
  - ログイン: `pi` / SSHパスワード

**ポート使用状況の把握**

| ポート | サービス | 備考 |
|--------|---------|------|
| 22 | sshd | tailscale0のみ |
| 3000 | letus-api (Node.js) | cloudflared経由 |
| 3001 | travel-calculation (Node.js) | 別プロジェクト・無関係 |
| 9090 | Cockpit | tailscale0のみ |
| 61208 | Glances | tailscale0のみ |
| 20241 | cloudflared | localhost のみ |

**設計方針として記録**
- 複数サービスをラズパイで運用する際はポート・プロセス・データを分離する
- 新サービス追加時は上記ポート一覧と照合して競合を避ける

### 残タスク（引き継ぎ）

- 前セッションからの残タスクは変わらず
