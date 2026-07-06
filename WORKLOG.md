# 作業ログ

作業の進捗・決定事項・問題と修正を時系列で記録する。

---

## 2026-07-06 — リタスを独立リポジトリ `C:\dev\litas` へ分離、v1.0.0系列に改版

モバイルアプリ「リタス」の開発を本リポジトリ（feature/v2.0.0の`app/`）から分離した。

- `git subtree split --prefix=app` で**コミット履歴を保持して移管**（53コミット）。`feature/v2.0.0` の `app/` は凍結
- リタスは**v1.0.0からリリース**（「v2.0.0」呼称廃止）。app.json / package.json 改版済み
- 新リポジトリに CLAUDE.md / README / TASKS.md / docs/handover.md（引継ぎ文書）＋設計ドキュメント3点を整備
- 分離でホイストが外れた `@types/react` をdevDepに追加し、`pnpm typecheck` エラーゼロ・vitest 99件通過を確認
- 本リポジトリに残るリタス関連: バックエンドAPI（devices/token・assignments/state）、LP（landing/）、changelogへのリタス情報掲載
- 残作業: GitHubリモート作成・push（gh CLI未導入のため手動）、EASプロジェクトの向き先確認

---

## 2026-07-06 — ロードマップのフェーズ構成を再定義（フェーズ2=CLASS連携・フェーズ3=リタス）

`docs/roadmap.md` と `public/changelog.html` のロードマップを再構成。コード変更なし、ドキュメントのみ。

- フェーズ2 = **CLASS連携（アプリ実装に先立ち実装）**: 旧フェーズ4「時間割連携」を前倒し。リタスの時間割機能の土台（CLASSパーサ・`/api/timetable`・科目連携）をアプリ実装前に確立する
- フェーズ3 = **モバイルアプリ「リタス（Litas）」との連携**: 旧フェーズ3を改称し、2026-07-04のアプリ単体完結アーキテクチャ・9月公開目標・事前登録LP（lms.waiteu.dev/app）を反映
- 旧フェーズ2「サブスク解禁」はフェーズ1.5（無料開放＋パス型決済、v1.2.0仕上げ）に改組、旧フェーズ2.5「データ同期基盤」は廃止（アプリ単体完結に吸収）を明記
- **以降のchangelogにはリタス関連の情報を掲載する**（CLAUDE.mdにルール追記済み）。changelog.htmlのロードマップカードも新構成（1 / 1.5 / 2=CLASS / 3=リタス）に更新

---

## 2026-07-05 — モバイルストア事業者アカウント登録プラン確定

v2.0.0モバイルアプリを**個人事業主(組織)アカウント**でApp Store/Google Play公開する方針を決定。本名非公開・屋号のみ表示が目的（参考: https://zenn.dev/zawascript/articles/2026-04-store）。

- 確定: 屋号=**waiteu** / 事業サイト=**waiteu.dev流用**（Cloudflare+GSC所有確認済みでGoogleのドメイン確認をほぼスキップ可） / 開業届=今週中着手
- 費用: Apple 12,980円/年 + Google $25(一回) + バーチャルオフィス660円/月〜 + povo基本0円 ≒ 初期2万円。所要はGoogle約1週間・Apple約2週間で、9月公開には7月中のD-U-N-S着手が必須
- 実行計画をドキュメント化: `docs/mobile-store-registration.md`（依存順・つまづき回避・代行可否の切り分け）
- 特商法表記ドラフト作成: `docs/tokushoho-draft.html`。住所(バーチャルオフィス)・電話(povo)・価格が埋まるまで`docs/`保管。`landing/`へ置くと develop push で lms.waiteu.dev に自動デプロイされるため未完成公開を回避
- 私が代行不可（本人性/決済要）: 開業届・バーチャルオフィス契約・povo契約・D-U-N-S申請・Apple/Google本人確認

---

## 2026-07-05 — 自走タスクランチャーCLI（ops/task.sh）設計・デスクトップ自走開始

「開発の自動化を加速」の第1弾（優先度: B自走運用強化→A/C/Dは将来）。長タスクのデスクトップ自走運用（worktree/tmux/claude起動/進捗確認/掃除が全て手作業）を1本のCLIに統合する。

- 設計確定: フルライフサイクルCLI `ops/task.sh`（dispatch/status/peek/notify/event/collect/clean）。進捗検知はClaude Code hooks（Stop/Notification→webhook）＋プラン規約（節目でnotify実行）の併用。通知は`TASK_WEBHOOK_URL`（未設定なら`OPS_WEBHOOK_URL`にフォールバック、#task-runner新設は手動作業のため保留）
- スペック: `docs/superpowers/specs/2026-07-05-task-runner-cli-design.md` / プラン: `docs/superpowers/plans/2026-07-05-task-runner-cli.md`（`dda87bf`）
- 実装はデスクトップのclaudeに自走ハンドオフ（worktree `~/dev/wt-task-runner`・ブランチ`task/task-runner`・tmux `task-task-runner`・skip-permissionsはユーザー明示承認済み・push禁止でローカルコミットのみ）
- **障害と対処**: SSH短命セッションから起動したtmuxがWSLインスタンス停止（最後のコンソール終了後の自動シャットダウン）で巻き添え死 → Windowsスケジュールタスク`WSL-KeepAlive`（onlogon・`wsl sleep infinity`、ユーザー承認済み）を新設して解決。今後の夜間自走の前提インフラ
- 進捗はDiscord #ops-alertsにチェックポイント通知が飛ぶ。完了後レビュー→developへの取り込みは翌日以降
- **完了・マージ済み（`27b51c1`）**: デスクトップ自走が4コミットで実装完遂（`ops/task.sh` 368行＋README）。ノート側で受け入れ条件7項目を実機再検証（構文・名前検証拒否・スタブdispatch一巡・hooks絶対パスJSON・clean dirtyガード＋--force・残留ゼロ）。rebase→ff→pushでdevelop統合、worktree/ブランチ/tmux/state掃除済み
- レビュー指摘（ブロッカーなし）: ①JSON生成/解析はpython3使用（スペックのheredoc方針から変更、エスケープが堅い・WSL常在で実害なし）②Stopフックは毎ターン発火し10分スロットルで約10分おきに「応答完了」pingが飛ぶ＝真の完了信号ではない、意味的完了は`notify`で担保
- 前提インフラ`WSL-KeepAlive`（onlogon・`wsl sleep infinity`）新設で夜間tmux永続を確保。今後の長タスクは `ops/task.sh dispatch <name> <plan>` で投げられる

---

## 2026-07-04 — TASKS.mdのロードマップをv2.0.0全面改定に追従させる

`TASKS.md`が2026-07-01時点のロードマップ（v1.3.0データ同期基盤・v2.0.0=拡張収集/アプリビューア構成）のまま残っており、同日中に別セッションで確定した「無料開放ファースト」全面改定（`docs/superpowers/specs/2026-07-04-free-first-strategy-design.md`）と食い違っていたため整合を取った。コード変更なし、ドキュメントのみ。

- 「v1.3.0: データ同期基盤」セクションを削除（独立バージョンとして廃止、v2.0.0のAPI拡張に吸収済み）
- 「v1.2.0 Phase B残・Phase C」セクションを新規追加: entitlement変更（メモ/優先度/テーマ無料化、設計・計画済み・未実装）、パス型決済（半期/年一回払い）、統計/スヌーズ（任意後回し）、Phase C申請
- 「v2.0.0」セクションをアプリ単体完結（WebViewでLETUS+CLASSを直接収集、拡張機能はPC向けサブ機能に格下げ）の初版最小スコープに全面書き換え。競合（TUSapp開発者）の存在とタイムライン（2026年9月公開目標）を明記

---

## 2026-07-04 — ops自動化基盤（トークン消費ゼロの定期監視）構築

デスクトップ（dev-desktop/WSL2）で定期実行する監視スクリプト群 `ops/` を追加（`d1fb736`〜`2865382`）。定常運転はLLM不使用・Discord webhook通知のみ（webhook設定は保留中、未設定時はstdoutフォールバック）。

- `ops/nightly.sh`（毎日03:30）: origin/developのCIクローンで install/build/lint/vitest(src)/api-test。**初回実行でmanualAssignment.test.tsの時刻依存バグを検出**→フェイクタイマー固定で修正（`248b90b`、18時以降実行でnow+30hが「明後日」になり失敗する問題）
- `ops/canary.sh`（毎日07:30）: LETUSログインページ生存+DOMマーカー、iCal形式（MOODLE_ICAL_URL設定時）。Stage B（実セッションでのパーサ実走）は認証方式決定後
- `ops/raspi-health.sh`（毎日07:00）: 公開API/内部API/ディスク/バックアップ最終実行結果（バックアップHDDは実行時のみマウントされる設計と確認、systemctl showで判定）
- `ops/competitor-watch.sh`（毎週月09:00）: LETask（App Store id 6762050344, iOS, カレンダーリンク方式, 2026-04リリース）のバージョン・評価数の変化検知
- 実行系: Windowsタスクスケジューラ→`wsl.exe`→固定ランチャー`~/ops/run.sh`（実行前にCIクローンをorigin/developへ同期。開発ツリーの未push/divergedに非依存）。スケジューラ経由のE2Eで結果コード0確認
- 秘密情報は `~/ops/ops.env`（リポジトリ外）。Discordの#ops-alerts+webhook作成はBotトークン流用が自動ガードで停止→ユーザー判断待ち
- メモ: デスクトップ開発ツリーに未pushコミット`f5f315f`あり（別セッションの作業、touch せず）

---

## 2026-07-04 — リポジトリ非公開化＋透明性レポートページ公開

方針転換: ソース公開の信頼効果は限定的（拡張は配布物から誰でも検証可能）と判断し、リポジトリをprivate化。代わりに「わかる人向け」の技術検証文書 `landing/transparency.html`（https://lms.waiteu.dev/transparency）を公開（`47f74ed`）。内容: 通信先はletus.ed.tus.ac.jpのみ・host_permissionsによる技術的保証・自分で検証する3手順（インストール済みコード閲覧/Service WorkerのNetwork監視/storage確認）・ソース公開方針（監査目的の閲覧は問い合わせで対応）・脆弱性報告窓口。未リリース機能（v1.2.0のAPI同期）には触れず「通信先が増える場合はリリース時に更新」とだけ記載。

- landing/index.html・privacy.htmlのフッターGitHubリンク→透明性レポートに差し替え（404回避）、sitemap.xmlに追加
- private化はGitHub API（PATCH、既存credential使用）で実行、200確認
- 事後検証: 未認証API=404（非公開確認）／ラズパイfetch=OK（SSH鍵認証のため影響なし）／Cloudflare Pagesデプロイ=OK（transparency 200）

## 2026-07-04 — source-availableライセンス追加（main / develop）

公開リポジトリが第三者（類似アプリ開発者）にcloneされロジックを参照されている事実を確認。ユーザーによる監査可能性のため公開は維持しつつ、閲覧・監査・動作確認目的のビルドのみ許可し、複製・転用・再配布（ストア公開含む）・商用利用を禁止する独自ライセンス（日英併記、日本語優先）を`LICENSE`として追加、READMEに「オープンソースではない」旨を明記。main（`371c869`）とdevelop（`65e0160`）の両方にコミット。qa/v1.1.x-releaseは未反映。

---

## 2026-07-04 — カスタム通知ルール（Phase B②）実装完了

Subagent-Driven Developmentで6タスク実装（コミット`1b19756`〜`c3911a5`）＋最終レビュー後の修正`ce061b5`。tsc0・src vitest 126/126・api jest 61/61。設計: `docs/superpowers/specs/2026-07-04-custom-notification-rules-design.md`、計画: `docs/superpowers/plans/2026-07-04-custom-notification-rules.md`。

- サブスクライバーがダッシュボードで締切通知のタイミングを設定可能（全体しきい値セット＋コース別上書き/ミュート）。無料/失効は固定1h/3h/24h（面での線引き＝ダウングレードなし、free-first方針準拠）
- `api/`: `user_settings`に`notification_rules`・`notification_rules_updated_at`カラム追加、`POST/GET /api/user/settings`拡張（クライアント供給ISOタイムスタンプをそのまま保存＝TZずれ回避、theme/rulesはカラム独立更新）
- `src/background/notificationRules.ts`（新規・純粋関数）: `resolveThresholds`（muted→null）・`pickThresholdToNotify`（最小未通知しきい値）
- `src/core/premium.ts`: ルールstorage・`syncToServer`拡張・`pullSettingsFromServer`（ISO文字列比較のlast-write-wins）。**同期は通知ルールのみ、テーマは各デバイス独立**
- `src/background/index.ts`: `checkDeadlineWarningNotifications`をルール適用に改修（`isSubscriptionActive`でゲート、手動課題もcourseId経由で対象）
- `src/App.tsx`/`ProBanner.tsx`/`App.css`: ダッシュボードUI（全体＋コース別）、ログイン/mount時のpull、非サブスクの`ProBanner`にカスタム通知ルール＋「快適装備＋開発支援」文面

**最終レビュー（opus）修正:** ①アップセル文面が当初サブスクライバー向けブロックのみにあり非サブスクの`ProBanner`に無かった→追加 ②ログイン時pull未配線→`handleAfterLogin`に追加。

**要デプロイ:** APIスキーマ・ルート変更のため、ラズパイで`git pull`+`pm2 restart`が必要（未実施）。

---

## 2026-07-03 — Discordコミュニティ機能を実装完了（Phase B①）

Subagent-Driven Developmentで8タスクを実装（コミット`a0eaaa9`〜`c653699`）、最終レビュー後のセキュリティ修正2件（`9802c81`・`4d76a9a`）。全58テスト合格。

- `api/lib/discord.js`: Discord REST API v10ラッパー（常時接続Botなし）。OAuth交換・ギルド参加/退出・コース別ロール/チャンネル作成・付与/剥奪
- 新規テーブル`user_courses`・`discord_course_roles`、`subscriptions.discord_user_id`カラム追加
- `GET/POST /api/user/courses`（コース同期）、`PATCH /api/user/courses/:courseId`（ロール希望トグル）
- `GET /api/discord/callback`（OAuth連携）、`GET /api/discord/oauth-state`（後述のセキュリティ修正で追加）
- 解約webhook（`customer.subscription.deleted`）に自動kickを追加
- 拡張機能`src/background/index.ts`: サブスクライバーのみ検出コースをサーバー同期
- `landing/mypage.html`: コース選択チェックリスト＋Discord連携ボタン

**設計の要点:** コース同定は安定した`Course.id`をキーにし、コースごと1組のロール/チャンネルを全受講者で共有。拡張機能の「スキャン対象の有効/無効」とDiscordロール希望（`discord_role_wanted`）は完全に独立。

**最終レビュー（opus）で発見したセキュリティ問題と修正:**
- Issue 1: OAuthの`state`に30日有効なセッションJWTをそのまま渡しており、Discordのリダイレクトチェーンやアクセスログに長期資格情報が残る問題。→ `GET /api/discord/oauth-state`で5分・`purpose: 'discord-oauth'`の短命JWTを別途発行する方式に変更。callbackは`purpose`を検証。さらに`requireAuth`が`purpose`付きトークンを拒否するよう強化し、短命トークンの他ルートへの再利用（トークン種別混同）も防止。

**本番反映完了（2026-07-03）:** Discordサーバー/Bot/OAuthアプリの手動セットアップ完了、ラズパイ`.env`にDiscord環境変数6つ設定、`develop`をpush（landing自動デプロイ）、ラズパイ`git pull`+`pm2 restart`。検証: 本番DBにスキーマ移行適用済み、外部URL経由で`/api/discord/oauth-state`・`/callback`が401応答（ルートマウント確認）、`lms.waiteu.dev/mypage`に実client id反映済み（`curl`確認は`.html`→clean URLの308リダイレクトを`-L`で追う必要あり）。

**実機E2E検証（2026-07-03、実データ）:** サブスクライバー実アカウントで一連を検証。追加修正3件:
- `fix(discord)`: OAuth連携で既にサーバーにいるメンバー（所有者・招待リンク先行参加のベータテスター等）にロールが付かない問題。joinGuildのbody内rolesは新規参加(201)時のみ適用されるため、joinGuild後に`assignRoleToMember`で明示付与するよう修正。検証: 所有者アカウントでSubscriberロール付与を確認
- `feat(discord)`: コース別チャンネルを`DISCORD_COURSE_CATEGORY_ID`のカテゴリ配下に配置（`parent_id`）。既存17チャンネルはカテゴリへ移動
- `fix(discord)`: コースチャンネル作成時に`@everyone`のVIEW拒否のみだとBot自身が自作チャンネルを管理できなくなる（VIEW拒否はManage Channelsで上書き不可、Administratorのみバイパス）。Bot user id(=DISCORD_CLIENT_ID)へのmember overrideでVIEW権を明示付与。既存17チャンネルは一時Administrator付与で「Bot閲覧権追加＋カテゴリ移動」を一括実行→admin解除後もoverride有効を確認
- 検証結果: 拡張機能→コース同期56件、コース選択→ロール/チャンネル自動作成17件、全17件カテゴリ配下・Botがadminなしで管理可能。解約kickは`at_period_end`設定確認済み（実発火は有効期間末）

**別件対応:** ラズパイの`STRIPE_PRICE_ID`が$0テスト価格のままだったのを本番価格（`price_1TncGqFFvmJkAgmIsnzEVlV6`）に戻し`.env`/`.env.production`両方更新・pm2 restart済み。

---

## 2026-07-02 — マイページ機能を実装完了

Subagent-Driven Developmentで3タスクを実装（コミット`b04a175`〜`61bc625`）。

- `POST /api/subscription/billing-portal`: Stripeカスタマーポータルセッションを発行
- `landing/login.html`（新規）: メール+パスワードログイン、JWTを`localStorage`（`authToken`/`authTokenExpiresAt`）に保存
- `landing/mypage.html`（新規）: サブスク状態・次回請求日表示、支払い方法管理ボタン、非アクティブ時は再登録導線、ログアウト
- `register.html`にログインへのリンクを追加

各タスクは実装→レビューの2段階チェックを経て全て承認（Spec ✅、Minor指摘のみ）。最終全体レビューも「そのままマージ可能」。統計機能（提出タイミング傾向）は、背景スキャナーが提出日時を一切パースしていないため今回のスコープ外とし、設計段階で明示的に除外した。

これでv1.2.0追加要望3件（パスワード再設定・ホームページ登録・マイページ）が全て完了。

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

### フォローアップ完了・実ブラウザE2E確認済み（同日中）

- Resendアカウント作成・`mail.waiteu.dev`のドメイン認証（SPF/DKIM、Cloudflare Domain Connect経由で一括設定）完了
- ラズパイ`.env.production`に`RESEND_API_KEY`・`RESEND_FROM_EMAIL`（`noreply@mail.waiteu.dev`）を追加、`pm2-env.sh prod`で反映・再起動
- 実ブラウザで一連のフローを確認: Webサイトから新規登録→Stripeチェックアウト遷移、パスワード再設定メールの実受信、リンクからの新パスワード設定、拡張機能`LoginModal`からの再設定リクエスト — 全て成功

### 発覚した問題: Cloudflare Pagesがgit連携されておらず自動デプロイされていなかった

`landing/`の新規ページをpushしても`lms.waiteu.dev`に反映されず、`.html`パスにアクセスすると`index.html`の内容が返る現象が発生。Cloudflareダッシュボードで調査した結果、**Cloudflare Pagesプロジェクト（`lms-task-watcher`）にGitリポジトリが接続されておらず、これまで手動（wranglerまたはダッシュボードアップロード）でデプロイされていた**ことが判明。過去のデプロイ履歴にコミットメッセージ風の表示があったのは、手動デプロイ時に`--commit-message`相当の説明を都度入力していたため（自動デプロイではない）。

`npx wrangler pages deploy landing/ --project-name=lms-task-watcher --branch=develop`で手動デプロイして応急対応した後、根本解決のためユーザーとCloudflareダッシュボードを見ながらGit連携を設定した。

### 修正: Cloudflare PagesにGit連携を設定し自動デプロイ化

- GitHub App「Cloudflare Workers and Pages」を`lms-task-watcher`リポジトリのみに限定して認可
- Settings → Build: Git repository = `waiteu-git/lms-task-watcher`、Production branch = `develop`、Root directory = `landing`
- Build watch paths を試行錯誤: `landing/**`ではマッチせず自動デプロイがスキップされた（`landing/index.html`の変更コミットが「skipped」に）。`landing/*`に変更したところ正常にビルド・デプロイされることを確認（Cloudflare Pagesのglobパターンの癖として要記憶）
- 検証を兼ねて`landing/index.html`のプライバシー文言修正（`chrome.storage.local`という技術用語を削除）をpush → 自動デプロイが正常動作することを確認
- **今後`landing/`配下の変更はpushのみで本番反映される**（詳細はメモリ`feedback_cloudflare_pages_manual_deploy.md`参照）

### 残タスク

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
