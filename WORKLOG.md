# 作業ログ

作業の進捗・決定事項・問題と修正を時系列で記録する。

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
