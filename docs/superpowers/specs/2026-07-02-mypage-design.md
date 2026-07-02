# マイページ機能 設計

## 背景

v1.2.0の追加要望3件（[[project-v120-phasing]]参照）のうち、①パスワード再設定・②ホームページ登録は完了済み。③マイページ機能（支払い方法更新・次回請求日・統計情報表示）を今回設計する。

①②のログインセッション（JWT + `localStorage`）が前提となるため、①②完了後の着手が適切なタイミングだった。

## スコープ

- 対象: 支払い方法の更新（Stripeカスタマーポータル経由）、サブスク状態・次回請求日の表示
- **統計機能は今回のスコープ外**。理由: 背景スキャナー（`src/background/index.ts`）は課題ページのテキストから「提出済み/未提出」という状態のみを判定しており、実際の提出日時を一切パースしていない。提出タイミング傾向の統計を出すには、LETUSの課題ページから提出日時をパースする新しいスクレイピング機能が別途必要（別プロジェクトとして着手する）
- ユーザーからの明示的な方針: テーマ切替など拡張機能の実際の動作に関わる設定は、マイページではなく拡張機能のダッシュボード側に留める。マイページはアカウント・課金情報に限定する

## アーキテクチャ

```
[landing/login.html] --email+password--> POST /api/auth/login（既存）--JWT--> localStorage保存 --> mypage.htmlへリダイレクト

[landing/mypage.html] --Authorization: Bearer <JWT>--> GET /api/subscription/status（既存）でステータス・次回請求日表示
                      --「支払い方法を管理」ボタン--> POST /api/subscription/billing-portal（新規）--> Stripeカスタマーポータルへリダイレクト
```

支払い方法更新はStripeカスタマーポータル（Stripeがホストする画面）にリダイレクトする方式を採用する。独自UIをStripe Elementsで構築する案は、PCI準拠の実装負担に対して得られる価値（表示のカスタマイズ性）が見合わないため採用しない。

## 1. バックエンド

### 新規エンドポイント（`api/routes/subscription.js`に追加）

**`POST /api/subscription/billing-portal`**（`requireAuth`必須）
- `req.userId`から`subscriptions`テーブルの`stripe_customer_id`を取得
- `stripe_customer_id`が無ければ404（未登録・チェックアウト未完了のユーザー）
- `stripe.billingPortal.sessions.create({ customer: stripe_customer_id, return_url: 'https://lms.waiteu.dev/mypage.html' })`を実行
- 成功時 `{ url: session.url }` を返す。Stripe API呼び出し失敗時は500

既存の`GET /api/subscription/status`（`{ status, currentPeriodEnd }`を返す）はそのまま利用し、変更しない。

## 2. Webサイト（`landing/`に素のHTML/JS追加）

### localStorageキー（新規、Webサイト側で初めて使用）

`register.html`は現状トークンを永続化しておらず（チェックアウトへの一時利用のみ）、Webサイト側にlocalStorageの利用実績がないため、キー名をここで定義する:
- `authToken`: JWT文字列
- `authTokenExpiresAt`: ISO文字列（`/api/auth/login`のレスポンスの`expiresAt`をそのまま保存）

### `landing/login.html`（新規）

- `register.html`と同じCSS変数・ヘッダー/フッター構造
- メール・パスワード入力 → `POST /api/auth/login` → 成功時`authToken`・`authTokenExpiresAt`を`localStorage`に保存 → `mypage.html`へ`location.href`で遷移
- 認証エラー時はエラーメッセージ表示
- 「パスワードをお忘れですか？」→ `forgot-password.html`へのリンク

### `landing/mypage.html`（新規）

- ページ読み込み時に`localStorage`から`authToken`を読む。無ければ即座に`login.html`へリダイレクト
- `GET /api/subscription/status`を`Authorization: Bearer <token>`付きで呼ぶ
  - トークン期限切れ等で401が返ってきた場合は`localStorage`をクリアして`login.html`へリダイレクト
  - `status === 'active'`: メールアドレス・次回請求日（`currentPeriodEnd`をロケール表示）・「支払い方法を管理」ボタンを表示。ボタン押下で`billing-portal`エンドポイントを呼び、返ってきた`url`へ`location.href`でリダイレクト
  - `status !== 'active'`（`inactive`等）: 「現在サブスクリプションが有効ではありません」という文言と、`register.html`（新規登録）へのリンクを表示（再登録は新規登録と同じ導線を使う。個別の「再開」フローは持たない）
- 「ログアウト」ボタン: `localStorage`から`authToken`・`authTokenExpiresAt`を削除して`login.html`へリダイレクト

### `landing/register.html`の軽微な追記

フッター付近に「ログインはこちら」→ `login.html`へのリンクを追加する（現状`register.html`から`login.html`への導線が無いため）。

## 前提作業（ユーザー側、実装前に必須）

Stripeダッシュボード → Settings → Billing → Customer portal で以下を設定する:
- Customer portalを有効化
- 許可する操作（支払い方法の更新は必須。請求書履歴・サブスク解約は任意）を選択
- ビジネス情報（利用規約URL・プライバシーポリシーURL等）を入力（Stripeの要求に従う）

## テスト・検証方針

`api/tests/subscription.test.js`は現状存在しないため新規作成する。既存の`auth.test.js`と同じパターン（supertest + インメモリsqlite）で、`billing-portal`エンドポイントのテストを書く。Stripeの`billingPortal.sessions.create`は`webhook.test.js`が`stripe.webhooks.constructEvent`をモックしているのと同様に`jest.mock('stripe', ...)`でモックする。

Webサイトの新規ページ（`login.html`・`mypage.html`）は既存の`landing/`同様に自動テストを設けず、ブラウザでの手動確認とする（Stripeカスタマーポータルへの実際の遷移・支払い方法更新を含む）。

## 完了の定義

- `login.html`からログインし、`mypage.html`にサブスク状態・次回請求日が正しく表示される
- 「支払い方法を管理」からStripeカスタマーポータルに遷移し、実際に支払い方法を更新できる
- 未認証（トークン無し・期限切れ）で`mypage.html`にアクセスすると`login.html`にリダイレクトされる
- 非アクティブなサブスクユーザーには再登録導線が表示される
