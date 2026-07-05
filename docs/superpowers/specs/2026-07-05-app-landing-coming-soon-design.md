# v2.0.0 アプリ用ランディング（Coming Soon＋事前登録）設計

作成日: 2026-07-05
対象: v2.0.0 モバイルアプリの公開前ランディングページと事前登録受け皿

## 背景と目的

v2.0.0はスマホ単体でLETUS課題通知を完結するモバイルアプリ（iOS/Android、公開目標2026年9月）。
競合TUSappが存在し、モバイルプッシュの前倒しが最優先。公開前に事前登録（waitlist）を
集めておき、公開時に「出ました」と一斉連絡できる導線を今のうちに用意する。

拡張機能とアプリはターゲット（理科大生）が同じなので、ドメイン・ブランド・SEOは
既存の `lms.waiteu.dev` に統合したまま、アプリ専用の独立ページを1枚足す。

## スコープ決定（確定事項）

- **配置**: 別ドメインの新サイトは作らない。`lms.waiteu.dev` 配下に独立ページ `landing/app.html`（URL `/app`）。
- **見た目**: 既存 `index.html` のデザインシステムを流用（インラインCSS、紫グラデ、
  配色変数 `--accent`/`--violet`/`--grad-btn` 等、同じヘッダー/フッター/カード）。新規デザインは起こさない。
- **公開タイミング**: 今すぐ公開（Coming Soonティザー）。フル製品ランディングではなく事前登録ページとして出す。
- **事前登録の受け皿**: メール収集。app.htmlのフォーム → letus-apiの新エンドポイントに保存。
- **フェーズ2（ストア登録可能後）**: 収集メール宛にストア事前予約リンクを一斉送信＋
  ページCTAをストアバッジに差し替え。今回は作らない。

## 命名・ブランディング（2026-07-06確定）

- **アプリ名 = リタス**（カタカナが主表記）。ローマ字サブ表記 = **Litas**（L始まりで旧「LETUS Task Watcher」の名残）。
  - 由来: レタス（LETUS≒lettuce）を一母音ずらした造語。「リ」で理科(リカダイ)もかすめる。LETUS同一名でないため商標リスクは低減しつつ認知の連続性を保つ。
  - 副題: 「東京理科大 非公式・LETUS/CLASS対応」。芝浦ScombApp等の前例に倣い非公式を明示。
- **アイコン**: 既存マーク（`public/favicon.svg` のジグザグ形）を**翠（ティール #0f9e75）に色替え**して流用。拡張機能は現行紫のまま。翠はレタスのオマージュ。
- **X**: 公開告知は `@yning_y2`（[[project_x_account]]）。カード画像デプロイ後に告知する順序を守る。
- **可用性確認結果**: カタカナ「リタス」は日本の学生アプリ領域で同名なし（Penmark/すごい時間割等は別名）。英字「Litas」は国際的に既存アプリ（Collective by The Litas 等）・暗号資産・litas.ioと衝突するため、新規ドメイン/ハンドルは取りに行かず、ランディングは `lms.waiteu.dev/app`・Xは `@yning_y2` を使う。ローマ字はロゴのサブ表記に留める。App Store Connectでの正式な名称予約は申請時に最終確認。
- 拡張機能名「LETUS Task Watcher」は据え置き。コード/内部識別子はコード名を継続（設計docの既定方針）。

## アーキテクチャ

### フロント: `landing/app.html`

静的1枚ページ。既存 `index.html` のCSSと構造を流用し中身のみ差し替え。
Cloudflare Pages（developブランチ、Build watch paths=`landing/*`）でpush時に自動デプロイ。

セクション構成:

1. ヒーロー: 「LETUSの課題通知を、スマホだけで。近日公開」＋メール事前登録フォーム
2. 価値訴求: モバイルプッシュ／時間割連携／PC拡張機能なしで単体完結（コンペ差別化）
3. 「登録すると何が届く？」: 公開時にメールで通知するだけ、という安心の明示
4. 相互リンク: 「今すぐPCで使うならこちら」→ `index.html`
5. FAQ抜粋＋フッター（`privacy.html` リンク）

フォーム要素:
- メール入力（必須、client＋server両方でバリデーション）
- 同意チェックボックス（`privacy.html` へのリンク）
- honeypot隠しフィールド（スパム対策、CSSで不可視）
- 送信後は同ページ内で成功/失敗ステートを表示（ページ遷移なし）

### バック: letus-api（ラズパイ port 3000, Express + better-sqlite3 + Resend）

新テーブル `waitlist`（`api/db/sqlite.js` の冪等 `CREATE TABLE IF NOT EXISTS` パターンに追加）:

```sql
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'app-landing',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at TEXT
);
```

新ルート `POST /waitlist`（`api/routes/waitlist.js`、`auth.js` の作法に倣う）:

- honeypotフィールドが空でなければ黙って200（ボット判定）
- メール形式バリデーション（不正なら400）
- `INSERT OR IGNORE INTO waitlist (email, source)`
- 登録済み/新規いずれも常に200（列挙攻撃回避、waitlistは冪等成功で十分）
- IP単位の軽いレート制限（短時間の連投を抑制）

`app.js`（またはルータ登録箇所）に `/waitlist` をマウント。

### フェーズ2（今回スコープ外・設計メモのみ）

ストア登録が済んだら、`waitlist` からメールをSELECTしてResendで
ストア事前予約リンクを一斉送信する使い捨てスクリプトを用意し、送信済みは `notified_at` を更新。
app.htmlのヒーローCTAをメールフォームからストアバッジ（App Store / Google Play）に差し替える。

## データフロー

```
ユーザーがメール入力 → POST /waitlist
  → honeypotチェック → メール形式バリデーション
  → INSERT OR IGNORE → 常に200「登録ありがとう」
（フェーズ2）管理スクリプトが SELECT email → Resend一斉送信 → notified_at 更新
```

## エラーハンドリング

- 不正メール: client側で即時、server側でも400
- 重複登録: 200（冪等成功、登録済みかは応答から判別不能にする）
- API停止時: フォームはリトライ促す表示、ページ自体は情報ページとして機能継続
- スパム: honeypot＋IPレート制限。botは黙って200で弾く

## SEO・相互リンク

- canonical `https://lms.waiteu.dev/app`、OGP（og:title/description/image）、viewport
- `landing/sitemap.xml` に `/app` を追加
- 構造化データ: `MobileApplication`（ストアURLはまだ無いので coming soon 表現、`installUrl`は付けない）
- `index.html` のFAQ「スマホアプリ開発中」記述から `/app` へリンク
- `privacy.html` にwaitlistメール収集の一文を追記

## プライバシー・法務

- 収集するPIIはメールアドレスのみ。用途は公開通知に限定する旨をフォーム近傍と `privacy.html` に明記
- 同意チェックボックス必須

## テスト

- API: `api/tests/waitlist.test.js`（`auth.test.js` に倣う）
  - 正常登録 → 200
  - 不正メール → 400
  - 重複登録 → 200（冪等）
  - honeypot埋まり → 200（DBには入らないことを確認）
- フロント: preview_* で手動検証（フォーム送信 → 成功ステート表示、コンソール/ネットワークエラーなし）

## デプロイ

- `landing/*` はpushで Cloudflare Pages 自動反映
- `api/` 変更は必ず `pm2 restart` までセットで実施（ラズパイ）

## やらないこと（YAGNI）

- ダブルオプトイン確認メール（フェーズ2の送信が実質の確認）
- 事前登録の管理UI（フェーズ2一斉送信は使い捨てスクリプト）
- 多言語化
- ストアバッジ/リンク（ストア登録前のため）

## 棄却した代替案

- **外部フォーム（Google Forms/Tally）**: バックエンドゼロだがブランド外・データ分散・
  フェーズ2で自前メール送信ができない。既存sqlite＋Resendがあるので自前が優位。
- **index.htmlにアプリ節を追記するだけ**: 手数は最小だが、拡張機能ページとアプリの
  訴求作法が混ざりぼやける。独立ページで維持する方針を採用。
