# パス型決済 設計

## 背景

上位方針 `2026-07-04-free-first-strategy-design.md`（無料開放ファースト）§3 に従い、学生のクレジットカード非保有問題への回答として、現行の月額サブスク（Stripe subscription、カード限定）に加えて**一回払いのパス型決済**を導入する。

- **半期パス ¥720 / 年パス ¥1,200（一回払い）を主軸**。Stripe のコンビニ決済・PayPay（いずれもクレカ不要）が使える
- 月額 ¥120 はカード・Visaデビット・プリペイド派向けに併存
- 販売は Web（lms.waiteu.dev、既存マイページ基盤）で行い、アプリは購入状態を反映するだけ（Apple IAP 手数料回避）

現行実装（`api/routes/subscription.js`・`api/routes/webhook.js`・`subscriptions` テーブル・`src/core/auth.ts`）は月額サブスク前提で、エンタイトルメントは `status='active'` ＋ `current_period_end` で駆動している。月額は Stripe の `customer.subscription.updated` webhook が `current_period_end` を更新し、`customer.subscription.deleted` で失効する。

## スコープ

- v1 は **PayPay ＋ カード**（同期・即時有効化）。**コンビニ決済（非同期）は fast-follow**（保留状態・`async_payment_succeeded` 待ちの UX/実装が重いため今回は含めない）
- 月額サブスク（継続課金）とパス（一回払い）を**共存**させる
- 実装は下記「実装前の外部準備」が完了してから着手する（本設計・計画までは先行して用意）

### スコープ外（今回入れない）

- コンビニ決済（非同期）— fast-follow
- パスの返金・途中解約 UI（一回払いは失効を待つのみ、返金は Stripe ダッシュボードで個別対応）
- 自動での月額→パス切替（二重課金防止は警告で行い、自動解約はしない）

## 実装前の外部準備（ユーザー / Stripe ダッシュボード、実装のゲート）

1. **Stripe JP アカウントで PayPay が有効化できるか・一回払い（`mode:payment`）で使えるかを確認**（free-first 戦略 §7 の要検証項目）。使えない場合は決済手段を card のみに縮退して仕切り直す
2. Stripe Price を 3 つ用意しIDを控える:
   - 月額 ¥120（recurring、既存の `STRIPE_PRICE_ID` を流用）
   - 半期パス ¥720（one-time）
   - 年パス ¥1,200（one-time）
3. ラズパイ `.env` に `STRIPE_PRICE_HALFYEAR` ・ `STRIPE_PRICE_YEAR` を追加（既存 `STRIPE_PRICE_ID` は月額として維持、コード上のエイリアス名は `STRIPE_PRICE_MONTHLY` として参照してもよいが env キーは互換のため `STRIPE_PRICE_ID` を残す）

## データモデル

`subscriptions` テーブルは現行のまま（新カラムなし）。パスと月額の区別は既存の `stripe_subscription_id` の有無で行う:

- **月額（継続課金）**: `stripe_subscription_id` あり、`status='active'`、`current_period_end` は webhook で更新される
- **パス（一回払い）**: `stripe_subscription_id` は NULL、`status='active'`、`current_period_end` は購入時に固定値（`max(既存, now) + パス期間`）

## エンタイトルメント失効モデル（cron 不使用）

パスは将来の webhook が来ない（月額のような `subscription.deleted` で失効しない）ため、**「有効 ＝ status が active 系 かつ `current_period_end > now`」に統一**する。これで月額（webhook で期限が延びる）とパス（固定期限で自然失効）を cron なしに両立する。

- **サーバー `GET /api/subscription/status`**: `status` をそのまま返すのに加え、`current_period_end <= now` の場合は実効的に非アクティブとして扱う（レスポンスの `status` を `'inactive'` に正規化する、または `active` フラグを別途返す。既存フィールドとの互換のため `status` を正規化する方針）
- **クライアント `src/core/auth.ts` `isSubscriptionActive`**: キャッシュした `subscriptionStatus` が active でも、キャッシュした `subscriptionCurrentPeriodEnd <= now` なら非アクティブと判定する（パスの失効をクライアント側でも即時反映。現状のキャッシュ TTL 7 日＋グレース 3 日だと最大約 10 日失効が遅れるため）

## チェックアウト（`POST /api/subscription/checkout` 拡張）

リクエストボディに `plan`（`'monthly'` | `'halfyear'` | `'year'`）を受ける。未指定時は後方互換で `'monthly'`。

- `plan='monthly'` → 現行どおり `mode:'subscription'`、`price=STRIPE_PRICE_ID`
- `plan='halfyear'` / `'year'` → `mode:'payment'`（一回払い）、`price=` 対応する one-time Price、`payment_method_types:['card','paypay']`、`metadata:{ pass_months: 6 | 12 }`（webhook が延長量を知るため）
- success/cancel URL は現行と同じ

不正な `plan` は 400。

## Webhook（`checkout.session.completed` 拡張、`api/routes/webhook.js`）

`obj.mode` で分岐する:

- `mode='subscription'` → 現行どおり（月額。`stripe_customer_id`・`stripe_subscription_id`・`status='active'` を設定し、`current_period_end` を Stripe から取得）
- `mode='payment'` かつ `payment_status='paid'`（パス。card/PayPay は完了時に paid）:
  - `metadata.pass_months` から期間を得る
  - `current_period_end = max(現在の current_period_end, now) + pass_months` に更新（スタック）
  - `status='active'`、`stripe_customer_id` を保存、`stripe_subscription_id` は変更しない（NULL のまま）
  - 対象行は `customer_email`（session の `customer_email` or `customer_details.email`）から `users` 経由で特定（現行の checkout.session.completed と同じ引き当て）

（コンビニ非同期は今回対象外なので `async_payment_succeeded`/`async_payment_failed` は扱わない。）

## 共存・スタック（二重課金防止）

- パスは `max(current_period_end, now)` から加算（スタック）
- **月額（継続課金）が有効なユーザーがパスを買おうとした場合、二重課金防止のため警告する**:
  - 判定: `stripe_subscription_id` あり ＆ `status='active'` ＆ `current_period_end > now`
  - `GET /api/subscription/status` のレスポンスに `hasActiveRecurring`（boolean）を追加し、UI がこれを見てパス選択時に「継続課金の月額が有効です。二重課金を避けるため、先にマイページの『支払い方法を管理』から月額を解約してください」と警告表示する
  - 自動解約はしない。ユーザーが解約せずパスを買った場合もブロックはしない（警告のみ、購入自体は成立しスタックされる）

## UI（`landing/register.html` ・ `landing/mypage.html`）

- 現行の単一「サブスクライブする」ボタンを、**プラン選択 3 択**に置き換える: 月額 ¥120／半期パス ¥720／年パス ¥1,200。選択して `POST /checkout` に `plan` を渡す
- 決済ページ（Stripe Checkout）で PayPay・カードが選べる旨を簡潔に添える
- `hasActiveRecurring` が true のとき、パス 2 種の選択に上記の二重課金警告を表示する
- 価格の扱い: 決済導線内では金額表示が必要（[[feedback_pricing_display]] は changelog・ロードマップ等の一般 UI 向けの方針であり、購入ページでの価格提示はその対象外）

## テスト方針

- **API（`api/tests`、jest）:**
  - `checkout`: `plan='halfyear'`/`'year'` で `mode:'payment'` ＋正しい price ＋ `metadata.pass_months`、`plan='monthly'`/未指定で `mode:'subscription'`、不正 plan で 400（Stripe はモック）
  - `webhook`: `checkout.session.completed` の `mode:'payment'`/`payment_status:'paid'` で `current_period_end` が `max(既存, now)+期間` にスタックされる／既存の `mode:'subscription'` 経路が不変
  - `status`: `current_period_end <= now` で実効非アクティブに正規化される、`hasActiveRecurring` の算出
- **拡張機能（`src/core/auth.test.ts`、vitest）:** `isSubscriptionActive` が「status active でも `current_period_end <= now` なら false」を返す
- **手動確認（実装後・Stripe テストモード）:** PayPay/card でパス購入 → `current_period_end` が伸びる → エンタイトルメント有効 → 期限超過で失効

## 完了の定義

- 月額・半期パス・年パスの 3 プランがチェックアウトでき、パスは card/PayPay で一回払いできる
- パス購入で `current_period_end` がスタック加算され、`current_period_end > now` の間エンタイトルメントが有効、超過で（cron なしに）失効する
- 月額継続課金が有効なユーザーにはパス購入時に二重課金警告が出る
- 既存の月額サブスク経路が回帰なく動作する
- API・auth のテストが通る
- 実装は「実装前の外部準備」（Stripe PayPay 確認＋3 Price 作成）完了後に着手する
