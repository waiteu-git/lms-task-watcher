# Discordコミュニティ機能 設計

## 背景

Phase B（付加価値機能）の①として、`project_subscription_plan.md`メモリに「限定Discordサーバー招待（最優先・実装コストほぼゼロ想定）」と記載されていた。ブレインストーミングの結果、以下の理由で当初想定より規模が大きい設計になった。

- 解約時の自動退出をBotで行いたい（手動運用ではなく自動化）
- 受講しているコースごとにDiscordロール・専用チャンネルを持たせ、同じ授業を取っている学生同士が交流できるようにしたい
- サブスクライバーだけでなくベータテスター（無償の拡張機能テスト協力者）も別ルートでサーバーに参加できるようにしたい

## スコープ

- サブスクライバー向け: Discordアカウント連携（OAuth2）→ サーバーへの自動参加・ベースロール付与、マイページでのコース選択に基づくロール・専用チャンネルの自動作成/付与、解約時の自動kick
- ベータテスター向け: 開発者が個別に渡す固定招待リンクでの参加（自動化対象外、ロールは手動付与）
- コース名の表記ゆれ吸収・ロール名の事後更新は今回のスコープ外（YAGNI）

## データモデル

### 既存テーブルの変更

`subscriptions`テーブルに`discord_user_id`カラムを追加（連携済みDiscordユーザーIDを保持、未連携は`NULL`）。

### 新規テーブル

```sql
CREATE TABLE IF NOT EXISTS user_courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  course_id TEXT NOT NULL,
  course_name TEXT NOT NULL,
  discord_role_wanted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, course_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS discord_course_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id TEXT NOT NULL UNIQUE,
  course_name TEXT NOT NULL,
  discord_role_id TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- `user_courses`は「拡張機能が検出した全コース」をユーザーごとに保持する。拡張機能側の「スキャン対象の有効/無効」設定とは独立しており、`discord_role_wanted`（マイページでの明示的なチェック）だけがDiscordロール付与のトリガーになる
- `discord_course_roles`はコースごとに1件（ユーザーごとではない）。同じコースを選んだ学生全員が同じロール・同じチャンネルを共有する

## アーキテクチャ

```
[拡張機能] --検出した全コース--> POST /api/user/courses（サブスクライバーのみ）--> user_courses に同期

[mypage.html] --コース一覧を表示、チェックボックスでdiscord_role_wantedを選択--> PATCH /api/user/courses/:courseId
                --「Discordと連携する」ボタン--> Discord OAuth2 (identify + guilds.join)
                --> GET /api/discord/callback --> コード交換 → guild join API + ロール/チャンネル付与

[Stripe Webhook] --customer.subscription.deleted--> discord_user_id があれば kick API 呼び出し
```

常時接続のBotプロセスは持たない。全てDiscordのREST APIを既存のExpress APIサーバーから呼び出す形で完結させる。

## 1. Discord連携フロー（サブスクライバー）

1. ユーザーがマイページで「Discordと連携する」を押す
2. `identify` + `guilds.join`スコープでDiscord OAuth2認可画面へ遷移
3. 認可後、Discordが`GET /api/discord/callback?code=...`にリダイレクト
4. バックエンドがcodeをアクセストークンに交換し、Discordユーザーidを取得
5. `PUT /guilds/{DISCORD_GUILD_ID}/members/{discordUserId}`（Bot tokenで認証、ユーザーのアクセストークンとBase Subscriberロールを指定）を呼び、サーバーへ追加
6. その時点で`user_courses`に`discord_role_wanted=1`の行があれば、対応するコースロールも同時付与（無ければ後述の「コースロール同期」と同じロジックで作成）
7. `subscriptions.discord_user_id`に保存し、mypage.htmlへリダイレクト（連携完了表示）

新規環境変数: `DISCORD_CLIENT_ID`・`DISCORD_CLIENT_SECRET`・`DISCORD_BOT_TOKEN`・`DISCORD_GUILD_ID`・`DISCORD_SUBSCRIBER_ROLE_ID`

## 2. コース同期・ロール/チャンネル自動作成

- 拡張機能は検出した全コース（`id`・`name`）を`POST /api/user/courses`でサブスクライバーの場合のみ同期する
- マイページはこの一覧をチェックボックス付きで表示し、ユーザーが選択すると`discord_role_wanted`を更新する`PATCH /api/user/courses/:courseId`を呼ぶ
- `discord_role_wanted`が`true`になった時点（かつ`discord_user_id`が設定済みの場合）で以下を実行:
  1. `discord_course_roles`に該当`course_id`の行があるか確認
  2. 無ければDiscordのロール作成API（表示名は`course_name`）＋テキストチャンネル作成API（そのロールのみ閲覧・投稿可能な権限オーバーライト）を実行し、`discord_course_roles`に保存
  3. ユーザーにそのロールを付与するAPIを呼ぶ
- `discord_role_wanted`が`false`に戻された場合は、そのユーザーからロールのみ剥奪する（ロール・チャンネル自体は他の受講者のために残す）

## 3. 解約時の自動退出

既存の`api/routes/webhook.js`の`customer.subscription.deleted`ハンドラに追加。`discord_user_id`が設定されていれば`DELETE /guilds/{DISCORD_GUILD_ID}/members/{discordUserId}`を呼び、サーバーから完全にkickする（ロール単位の剥奪ではなく退出させる）。

## 4. Discordサーバー構成

**固定チャンネル:**
- `#ようこそ・ルール`
- `#お知らせ`
- `#勉強法シェア`
- `#課題雑談`
- `#バグ報告・要望`
- `#ベータテスター`（Beta Testerロール限定）

**コース別チャンネル（動的作成）:** 2章の仕組みで自動作成。対応するコースロールを持つ人だけが閲覧・投稿できる。

**参加ルート:**
- サブスクライバー: 1章のOAuthフローで自動参加
- ベータテスター: 開発者が個別に渡す固定招待リンクで参加。ロールは開発者が手動で付与する（自動化対象外）

## 事前準備（ユーザー側、実装前に必須）

- Discordサーバー本体の作成、固定チャンネルの用意
- Discord Developer Portalでアプリケーション作成 → Bot作成・トークン発行
- OAuth2のリダイレクトURLに`https://api.waiteu.dev/api/discord/callback`を登録
- Botをサーバーに招待（権限: Manage Roles, Manage Channels, Kick Members, Create Instant Invite）
- Botのロールをサーバー内で上位に配置（Discord仕様上、Bot自身より下位のロールしか付与・管理できないため）
- 「Subscriber」ベースロールと「Beta Tester」ロールを手動作成し、ロールIDを控える
- ベータテスター向けの固定招待リンクを発行

## テスト・検証方針

新規バックエンドエンドポイント（`/api/user/courses`・`/api/discord/callback`・webhook拡張分）はDiscord APIをモックしてJestテストを書く（`api/tests/webhook.test.js`がStripeをモックしているのと同じパターン）。実際のDiscordサーバーへの参加・ロール付与・kickの動作は、テスト用Discordサーバーを用意して手動確認する。

## 完了の定義

- マイページからDiscord連携ボタンでサーバーに自動参加できる
- マイページでコースを選択すると、対応するロール・専用チャンネルが自動作成され付与される
- 解約すると自動的にサーバーから退出させられる
- ベータテスターは別の固定招待リンクから参加できる
