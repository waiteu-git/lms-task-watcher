# 作業ログ

作業の進捗・決定事項・問題と修正を時系列で記録する。

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
