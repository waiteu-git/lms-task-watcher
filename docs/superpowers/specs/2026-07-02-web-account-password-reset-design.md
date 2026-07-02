# Webサイト アカウント登録・ログイン・パスワード再設定 設計

## 背景

Phase A（v1.2.0リリース完了）に続き、ユーザーから3件の要望があった: パスワード再設定、ホームページからのアカウント登録・サブスク申し込み、マイページ機能。3つには依存関係があるため分割し、まず土台となる「①Webサイトからのアカウント登録・サブスク申し込み」と「②パスワード再設定」をまとめて1つのサブプロジェクトとして設計する。「③マイページ」は①のログインセッションを前提とするため、①②完了後に別途設計する。

ホームページからの登録・サブスク申し込みの目的は、**拡張機能未インストールの状態でも先に登録・決済できるようにする**こと（マーケティング上の離脱防止）。

## 現状

- `landing/`は静的HTML（ビルド不要）。Cloudflare Pagesでホスティングされ、DNSはCloudflare上でCNAME登録済み。ラズパイ（`api.waiteu.dev`）とは別
- バックエンドAPI（Express、ラズパイ + Cloudflare Tunnel）に`/api/auth/register`・`/login`・`/refresh`が実装済み（JWT・30日有効、bcryptハッシュ）
- `/api/subscription/checkout`（要認証）がStripe Checkoutセッションを作成し、成功時は`api.waiteu.dev/checkout-success`にリダイレクトする
- CORS許可オリジンは現状`https://api.waiteu.dev`と`chrome-extension://*`のみ。`https://lms.waiteu.dev`からのfetchは全てブロックされる
- パスワード再設定・メール送信の仕組みは一切存在しない

## アーキテクチャ

```
[landing/register.html]──register──▶[POST /api/auth/register]──JWT──▶[POST /api/subscription/checkout]──▶[Stripe Checkout]──▶[api.waiteu.dev/checkout-success]

[LoginModal「パスワードをお忘れですか」] ──┐
[landing/forgot-password.html]         ──┴──▶[POST /api/auth/request-password-reset]──Resend──▶[ユーザーのメール]
                                                                                                        │
                                                                                    メール内リンク（token付き）
                                                                                                        ▼
                                                                          [landing/reset-password.html]──▶[POST /api/auth/reset-password]
```

## 1. バックエンド: パスワード再設定

### スキーマ追加（`api/db/sqlite.js`）

```sql
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
)
```

トークン自体（`crypto.randomBytes(32).toString('hex')`）はメールリンクにのみ載せ、DBには`sha256`ハッシュのみ保存する。ランダム値のため、パスワードのようなbcryptの計算コストは不要。

### エンドポイント（`api/routes/auth.js`に追加）

- **`POST /api/auth/request-password-reset`** `{ email }`
  - 該当ユーザーが存在すればトークンを発行（有効期限1時間）し、`sendPasswordResetEmail()`でメール送信
  - メールアドレス列挙を防ぐため、ユーザーの有無に関わらず常に同一の成功レスポンス（`{ ok: true }`）を返す
- **`POST /api/auth/reset-password`** `{ token, newPassword }`
  - `token`をハッシュ化して`password_reset_tokens`を検索。`used_at IS NULL AND expires_at > now`を満たさなければ400
  - `newPassword`は登録時と同じ8文字以上のバリデーション
  - 該当ユーザーの`password_hash`を更新し、トークンの`used_at`を設定

### メール送信モジュール（新規 `api/lib/email.js`）

```js
const { Resend } = require('resend')
const resend = new Resend(process.env.RESEND_API_KEY)

async function sendPasswordResetEmail(to, resetUrl) {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: 'パスワード再設定 - LETUS Task Watcher',
    html: `<p>以下のリンクから新しいパスワードを設定してください（1時間有効）。</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  })
}

module.exports = { sendPasswordResetEmail }
```

- 新規依存: `resend` npmパッケージ
- 新規環境変数: `RESEND_API_KEY`・`RESEND_FROM_EMAIL`（`.env`・`.env.production`・`.env.test`に追加。Resendアカウント作成・送信ドメインのDNS認証はユーザー側の作業）

### CORS修正（`api/server.js`）

`cors()`の`origin`配列に`'https://lms.waiteu.dev'`を追加する。

### `/checkout-success`ページの文言修正（`api/server.js`）

現状「拡張機能を再度開くとプレミアム機能が使えるようになります」という、既にインストール済みであることを前提にした文言になっている。Webサイト経由の未インストールユーザーにも対応するため、「東京理科大学生向けChrome拡張機能をインストールし、登録したメールアドレスでログインしてください」という案内とChrome Web Storeへのリンクボタンを追加する。

## 2. Webサイト（`landing/`に素のHTML/JS追加）

素のHTML/JSで実装する（既存の`landing/`がビルド不要の静的サイトであるため、規模に見合わない新規ビルドパイプラインを避ける）。

- **`register.html`**: メール・パスワード（・確認用）入力 → `fetch('/api/auth/register')` → 取得したJWTで`fetch('/api/subscription/checkout')` → 返ってきた`url`へ`location.href`でリダイレクト。メール重複（409）時は「登録済みです。パスワードをお忘れの場合は<a href="forgot-password.html">こちら</a>」と案内する
- **`forgot-password.html`**: メール入力のみ → `request-password-reset`を呼び、「メールを確認してください」というメッセージを表示（成否に関わらず同じ文言）
- **`reset-password.html`**: `location.search`から`token`を取得 → 新パスワード（・確認用）入力 → `reset-password`を呼ぶ。トークンが無い場合はエラー表示
- Webサイト単体の「ログイン」ページは今回作らない（アカウント状態の確認・管理はマイページ機能の範囲、③で設計する）

## 3. 拡張機能側（`src/components/LoginModal.tsx`）

- 「パスワードをお忘れですか？」リンクを追加。押すとモーダル内の表示をメール入力のみのフォームに切り替え、`request-password-reset`を呼ぶ
- 実際に新しいパスワードを設定する操作はメールのリンクからWebサイト（`reset-password.html`）で行うため、拡張機能側でトークン入力等は扱わない

## テスト・検証方針

（訂正: 当初「`api/tests/*`はvitestでは実行できず自動テストなし」としていたが、`cd api && npx jest`で正しく実行すれば全テストが正常に通ることを確認した。リポジトリルートから`vitest run`を実行した際にvitestがjest形式のテストファイルを誤って拾っていたことが原因で、api側のテスト基盤自体は壊れていない。）

新規エンドポイント（`request-password-reset`・`reset-password`）は既存の`api/tests/auth.test.js`と同じパターン（supertest + インメモリsqlite）でJestテストを書く。Resendのメール送信は`api/tests/webhook.test.js`がStripeをモックしているのと同様に`jest.mock('resend', ...)`でモックする。Webサイトの静的HTML/JSページは既存の`landing/`同様に自動テストを設けず、ブラウザでの手動確認とする。

## 完了の定義

- Webサイトから新規メールアドレスで登録し、Stripeチェックアウトに正しく遷移する
- 登録済みメールで再度登録しようとすると適切なエラーメッセージが出る
- パスワード再設定メールが実際に届き、リンクから新パスワードを設定でき、新パスワードでログインできる
- 拡張機能のログインモーダルから再設定メールをリクエストできる
- `https://lms.waiteu.dev`からのfetchがCORSエラーにならない
