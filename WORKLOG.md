# 作業ログ

作業の進捗・決定事項・問題と修正を時系列で記録する。

---

## 2026-07-15 — /app LP: 電話モック3台を2026-07-14デザイン刷新後の実UIに更新

`feature/landing-mock-ui-refresh`（develop起点）。`landing/app.html` の電話モック3台が旧UI（全面翠グラデの週グリッド時間割・旧配色の課題バケット）のままだったのを、リタス本体の現行UIに合わせて全面差し替え。

### 変更内容

- **ヒーロー（時間割）**: 旧・全面グラデ+週グリッド → 現行の日ビュー。翠グラデはヘッダー帯のみ（下角丸20px）＋週切替（‹ 第14週 ›）＋曜日バー（月〜土・選択日=白タブ+today-dot）、読書面は白地のフラット行+ヘアライン（1限〜4限、実施中=翠ハイライト+左バー、教室変更=info青チップ+旧新教室、ヒント「左右にスワイプで曜日を移動」）
- **出席（目玉）**: 確認系構成（856a284）を維持したままトークンを刷新デザインに統一。翠グラデ帯+ログイン済みピル、白カード（●受付中+リング残り時間+出席確認時間）、info色の「受付開始を通知しました」チップを追加（見逃し防止の確認系訴求）、出欠内訳+「あと4回休めます」success色。科目名は時間割モックの「実施中・量子力学2」と揃えてストーリーを一貫させた。**書き込みUI（コード入力・出席するボタン）は引き続き不掲載**
- **課題**: 現行の構成に刷新。翠グラデ帯にヘッダー統計（未提出8/期限切れ2=danger/提出済み1のガラスカード）+フィルタSegmented、白地は期限グルーピング（期限切れ→今日→明日→今週→それ以降）のフラット行。意味色チップ（danger #b3261e / warn #9a5b00 / success #0b6b2f）を正典トークンどおりに適用
- **本文コピー1箇所**: 課題セクションの「24時間以内・明日・今週と、」→「期限切れ・今日・明日・今週と、」（モックのグルーピング名と矛盾しないよう最小修正。他の文言は現行LPのまま）

### 参照した正典

- Claude Designプロジェクト `0b5780f9`（DesignSyncで取得）: `screens/timetable-list.html`（日ビュー最新はこちらが正。ローカル `C:\dev\litus-design\previews\screens\timetable.html` は旧・週グリッドだった）
- ローカル正典: `assignments.html` / `home.html`（意味色・チップ・バンドの意匠）
- 実機実装: `C:\dev\litus\src\navigation\RootTabs.tsx`（浮遊白ピルタブ=時間割/ホーム/課題・アクティブ翠板 → LPモックのナビと一致することを確認）、`TimetableScreen.tsx`（曜日バー・スワイプ・今日へ戻る実装確認）

### 検証

ローカルHTTPサーバー+ヘッドレスEdgeでフルページ/狭幅/各モック拡大のスクリーンショットを撮り、3台とも意図どおり描画されることを確認。課題モックは「それ以降」の行タイトルがナビに隠れたため全体を約20px詰めて可視化。

### 残タスク

- developへの統合はユーザー確認後（pushでCloudflare Pagesに自動デプロイされるため）

## 2026-07-10 — v1.2.1リリース準備: リスク抑制パッケージ＋サブスク撤去＋ストア提出文書（Task 8）

`feature/risk-mitigation` ブランチで実装計画 `docs/superpowers/plans/2026-07-10-ltw-terms-consent-license-hardening.md` の全8タスクを完了。SDD進捗台帳: `.superpowers/sdd/progress.md`（「LTW リスク抑制パッケージ」節）。本節は最終タスク（Task 8: ストア提出文書＋最終検証）の記録。

### このリリースに含まれる独立した2つの変更

1. **サブスク・認証UIとバックエンド連携の撤去**（`5176d98`）: `App.tsx` から auth/premium/betaOverride/ProBanner/SubscriberBadge を除去、`ProBanner.tsx`/`SubscriberBadge.tsx`/`LoginModal.tsx`/`betaOverride.ts` を削除、**`manifest.json` の `host_permissions` から `https://api.waiteu.dev/*` を削除**、Stripe・バッジ画像を削除。結果: 拡張の通信先は LETUS と CLASS のみ・外部送信ゼロ
2. **リスク抑制パッケージ**（`6d2da78`〜`69f69da`）: 利用規約新設（正典 `docs/legal/terms-ja.md`、公開版 `landing/terms.html`、拡張内 `src/legal/termsBody.ts` は `pnpm gen:terms` で生成）／同意ゲート（同意するまで `runAutoScan`・収集系メッセージ3種・content script 2本のすべてを停止、未同意は拡張アイコンに `!` バッジ・Chrome通知は不使用）／`TERMS_VERSION` をビルド時定数で単一正典から注入／LICENSE 4条追記（不正利用の禁止・自己責任免責強化・違反時自動終了・準拠法=日本法東京地裁、cabetus個別許諾は無傷）／changelog最上部・welcome手順②で告知

v1.2.1 の機能修正（`ea131ed`、リスク抑制着手前から存在）も同梱: 英字入り科目ID（例`9975A06`）のコース自動選択・LETUSページ上バッジの提出状態更新・課題ページ右下表示の提出状態化。

### 実装済み（Task 8で新規作成・確認）

- `store-submission-v1.2.1.md` 新規作成。`store-submission-v1.2.0.md` と同じ節構成で、v1.2.1固有の内容を追加: 挙動変更の明示（同意までは収集・通知ゼロ、既存ユーザーへの破壊的変更）／権限は増えていない・むしろ`api.waiteu.dev`を削減した旨／規約URL公開の**手順の順序**（① `feature/risk-mitigation`を`develop`にマージしlanding公開 → ② `https://lms.waiteu.dev/terms`が200で規約本文を返すことを確認 → ③ ストア提出）
- `docs/permission-justification.md` の更新要否を確認: **更新不要と判断**。この文書はそもそも `api.waiteu.dev` に一度も言及していなかったため（`grep`で無ヒット確認）、host_permissionsからの削除に伴う記述の齟齬は生じていない
- `https://lms.waiteu.dev/terms` を実際にfetchして確認: **404ではなくトップページ（製品紹介ページ）の内容が返る**。`feature/risk-mitigation`が`develop`未マージ・`landing/terms.html`が未デプロイのため。`docs/app-landing-publish-runbook.md`の記載どおり`landing/*`はdevelopへのpushでCloudflare Pagesが自動デプロイする構成（`landing/app.html`→`/app`と同じ対応で`landing/terms.html`→`/terms`になる想定）なので、コード側の修正は不要・**develop マージが唯一の対応**
- TASKS.mdは確認のみ（リスク抑制パッケージに対応する未完了項目が見当たらず、変更なし）

### 検証（機械的検証のみ・実施済み）

- `pnpm vitest run src` → **659/659 PASS**
- `npx tsc -p tsconfig.app.json --noEmit` → exit 0・出力なし
- `pnpm build` → 成功（`dist/classTimetable.js`/`content.js`/`background.js`等を生成）
- `npx eslint src` → 新規エラーなし（`src/core/syllabusParse.ts`のirregular-whitespace 2件・`TimetableSection.tsx`/`TodayTimetable.tsx`のexhaustive-deps警告4件はいずれも既存・別件）
- `grep -nE "^[[:space:]]*import[[:space:]{'\"]" dist/classTimetable.js dist/content.js` → ヒット0件（classic content scriptにimport文が混入していないことを確認）
- `pnpm gen:terms` 再実行 → `git status --porcelain`に差分なし（規約生成物が正典と一致）

### 実機検証（未実施）

**Chromeに拡張を読み込んでの動作確認はこのセッションでは実施していない。** `store-submission-v1.2.1.md` §7に手順10項目（未同意時のバッジ・収集停止・Network無通信・同意後の復帰・再同意動作・英字科目ID自動選択・提出状態バッジ更新等）を明記した。コントローラまたはユーザーが実施し、結果を本ログに追記すること。

- [ ] §7の手順1〜10を実機で確認
- [ ] `feature/risk-mitigation` を `develop` にマージし、`https://lms.waiteu.dev/terms` が200で規約本文を返すことを確認
- [ ] 上記2件の完了後にChrome Web Storeへ提出

## 2026-07-08 — 自前バックエンド通信を無効化（凍結）＋アカウント/課金UI非表示

無料開放・凍結方針（サブスク有料化・サーバー同期はリタス公開まで停止）に合わせ、自前バックエンド（`api.waiteu.dev`）への通信を全停止し、関連UIを隠した（commit `b22e14d`、develop merge `aa3e704`）。

- 単一フラグ `BACKEND_ENABLED = API_BASE_URL !== ''`（[App.tsx](src/App.tsx)）。`.env` の `VITE_API_BASE_URL` 未設定（空）で false。`.env` はgitignoreで、コード既定 `?? ''` によりenv無しビルドは既定でバックエンド無効。再有効化は `VITE_API_BASE_URL=https://api.waiteu.dev` を設定してビルド
- 通信停止: サブスク状態取得（`/api/subscription/status`）は `token && BACKEND_ENABLED` でガード、コース同期 `syncCoursesToServerIfSubscriber` に `if (!API_BASE_URL) return`、設定/データ同期（premium.ts）は既存の空URLガードで無効
- UI非表示: ProBanner（ログイン/課金導線・LoginModal内包）・SubscriberBadge・アカウント欄・マイページ・ログアウトは `BACKEND_ENABLED && isSubscriber`／`BACKEND_ENABLED && !isSubscriber` でゲート。devパネル（サブスク状態）は元々 `__DEV_TOOLS__ || __BETA__` で本番非表示
- 通知タイミング設定（全体/コース別）はローカル保存の実機能のため、サブスク欄から `notificationRulesSettings` に抽出し、バックエンド無効時は「通知設定」欄として**全員に開放**（無料開放と整合）。メモ・優先度・テーマは元々ローカルで無変更
- 検証: `tsc -b`緑・vitest 190/190緑・`pnpm build`成功。**新distに `api.waiteu.dev` が含まれないことを確認**（通信先が焼き込まれない）

---

## 2026-07-08 — v1.2.0リリース: 時間割UI改善＋コース自動選択＋ガイド改訂

設計 `docs/superpowers/specs/2026-07-08-v1.2.0-release-timetable-onboarding-design.md` / 実装計画 `docs/superpowers/plans/2026-07-08-v1.2.0-timetable-onboarding.md` を subagent-driven（実装→独立レビュー→fix）で14タスク実装。ブランチ `feature/v1.2.0-timetable-onboarding`（develop分岐）。

- 緊急度カラー: `deadlineTier`（`src/utils/date.ts`、`ed1c462`→`a771ce6`）＝当日=today/今日を除く7日以内=week/else none。**レビュー指摘でミリ秒経過→カレンダー日基準に統一**（`today`と整合、開いた時刻で7日境界がぶれる不具合を解消）。`linkAssignmentsToSlots` に `courseCodeUrgency` 集計を追加（scan＋手動課題、提出済/期限切れ/開始前除外、today>week>none）し件数チップ（`courseCodeCounts`）を撤去（`c3acedb`/`344a283`）
- コース自動選択: `selectCoursesByTimetable`＋`Course.userToggled`（`c683611`）。片方コード一致でON・手動トグル尊重・自動DISABLEなし。background `applyAutoSelect` を UPSERT_COURSES と `chrome.storage.onChanged`（`timetable:`鍵限定・無限ループなし）に配線（`d7ea5fc`）。手動トグルで `userToggled:true`（`460d472`）
- UI: `TodayTimetable.tsx`（ポップアップに今日の時間割常設、週末→翌月曜=`resolveDisplayDay`、`de93b86`）、時間割コマ/今日の時間割に緊急度ドット＋NEWバッジ（未読更新コース=`newBadgeCodes`、`344a283`）。CSS＋ポップアップ幅390→440px（`997eb59`）、デッドCSS`.timetableCount`除去
- ガイド: `public/welcome.html` をCLASS先行→LETUS自動選択フローに改訂（`21d99c7`）
- 問題と修正:
  - **TZ移植性**（Task 8レビュー）: 日時テストが`+09:00`ISO×`getDay()`で非JSTランナー（米国等）に曜日ずれ→`vitest.setup.ts`で`process.env.TZ='Asia/Tokyo'`固定（`4f2ad0a`）。default/America/New_York両方で緑を実証
  - **Task 5リグレッション**: top-levelに追加した`chrome.storage.onChanged.addListener`で、`checkIsLoggedIn.test.ts`のchromeスタブに`onChanged`が無くimport時例外→スタブ追加で復旧（`2f2128d`）
- litus逆流: **不要**判定。litus `src/assignments/buckets.ts` が拡張の`deadlineTier`より高機能で先行。`selectCoursesByTimetable`/`resolveDisplayDay`は拡張固有
- changelog/版数（`6959f02`）: `public/changelog.html`をv1.2.0＋7機能＋リタス導線 https://lms.waiteu.dev/app に。manifestは既に1.2.0（`public/manifest.json`、class.admin権限あり）
- 品質: tsc -b緑・vite build成功・vitest **190/190**緑（実src、worktree除外）。opus最終whole-branchレビュー=**READY TO MERGE**（Critical/Importantなし、4不変条件をシーム実証）
- 残（ストア申請前・別件）: `store-listing.md`本文がv1.0.5のまま（追跡タスク化）／`src/core/syllabusParse.ts`の既存 irregular-whitespace lintエラー（`fix/syllabus-irregular-whitespace`の領分）
- 挙動メモ: 「すべてOFF」は全コースに`userToggled`を付けるため、以後の時間割取込で自動再選択されない（仕様「手動トグル尊重」に整合・ship-as-is）

---

## 2026-07-08 — インストール時ウェルカムガイドを実装

設計 `docs/superpowers/specs/2026-07-08-welcome-guide-design.md` / 実装計画 `docs/superpowers/plans/2026-07-08-welcome-guide.md` をtask-by-taskのTDDで実装（ブランチ `feature/welcome-guide`、worktree隔離）。

- 目的: 新規インストール時に「ツールバーへの固定方法」と「使い始め方」をタブで案内。固定していないユーザーはポップアップを開かず既存 `OnboardingBanner` が届かないため、専用ページで周知する。既存ユーザーには次回アップデート時に一度だけ表示し、以降のアップデートでは従来どおり changelog を開く
- Task 1 `handleInstalled`（`198f0f4`）: `src/background/index.ts` の `onInstalled` を export された `handleInstalled(details)` に抽出。`install` → `welcomeGuideShown` フラグ保存＋`welcome.html`／`update` かつフラグ未保存 → フラグ保存＋`welcome.html`／`update` かつフラグ保存済み → `changelog.html`。アラーム作成は理由によらず無条件。`WELCOME_GUIDE_SHOWN_KEY = 'welcomeGuideShown'` を `storageKeys.ts` に追加。`index.test.ts` に4分岐テスト追加
- Task 2 `welcome.html`＋`welcome.js`（`77aaa84`）: `public/` 直下の静的ページ（ビルドで `dist/` へコピー）。①ツールバー固定手順（`welcome.js` が `navigator.userAgent.includes('Edg/')` で Chrome/Edge を出し分け、`data-browser` 属性のブロックを非表示）②使い始め3ステップ ③通知の仕組み ④リタス事前登録導線 `https://lms.waiteu.dev/app` ⑤changelog へのリンク。MV3 CSPのためJSは別ファイルに分離
- 決定: スクリーンショット画像は同梱せず🧩/📌の簡易イラスト（CSS）で表現、日本語のみ、ポップアップ `OnboardingBanner` は変更なし
- 検証: `pnpm vitest run src/background/index.test.ts` 24/24 PASS、`pnpm build` 成功、`dist/welcome.{html,js}` 生成確認、UAトグルの構造・挙動をnodeで決定的検証（ALL_PASS）
- 各タスクはサブエージェント実装＋独立レビュー（spec ✅／quality承認、Minorのみ）

---

## 2026-07-07 — v1.2.0 No.4 コース内容の更新通知（定義A）を実装

設計 `docs/superpowers/specs/2026-07-07-v1.2.0-no4-course-update-notification-design.md` / 実装計画 `docs/superpowers/plans/2026-07-07-course-update-notification.md` をtask-by-taskのTDDで実装。

- リファクタ（`aa4f049`）: 既存 `index.ts` の `extractLinksFromHtml`・`stripTags`・`decodeHtmlEntities`・`normalizeText` を `src/core/letusLinks.ts`＋`src/core/htmlText.ts` へ抽出し import に切替（**挙動不変**、既存 `index.test.ts` 緑のまま）。litus `src/parsers/letusLinks.ts`＋`text.ts` の対応先＝設計書の「拡張の既存リンク抽出との突き合わせ」
- 純関数 `src/core/courseUpdates.ts`（`d14133e`）: `computeCourseSignature`（`/mod/*/view.php` 絞り・url重複排除・昇順ソート）・`diffCourseSignature`（url集合差分）・`computeCourseUpdate`（初回=ベースラインのみ added空／新signature空かつ前回非空=skipSave／それ以外=added）。litus `src/updates/courseUpdates.ts` の双子
- ストレージ `src/background/courseUpdatesStore.ts`（`9c9b61f`）: `courseSignature:{courseId}`・`courseUpdates:{courseId}`（未読）。追記は url 重複回避、項目/コース単位の既読化
- フック（`c6cfaff`）: `scanAssignmentCandidatesInBackground` の各コース `fetch(course.url)` 済みHTMLから `computeCourseUpdate`。追加のあったコースごとに `createNotification`（「○○ に新しい教材/課題 N件」・クリックでダッシュボード）。**追加fetchなし**
- UI `src/components/CourseUpdatesSection.tsx`（`fca04c5`）: 未読のあるコースを項目履歴リスト（タイトル＋検知日時）で表示。クリックでLETUSを開き既読化、全既読でクリア、未読合計バッジ。`refreshKey` で再読込（`react-hooks/set-state-in-effect` 回避）
- 決定: **追加のみ通知**（削除はスナップショット更新のみ）、初回はベースライン保存のみ・通知なし、シグネチャは全 `/mod/*/view.php`（教材含む）
- **manifest・バックエンド変更なし**
- 検証: `pnpm exec tsc -b` clean、`pnpm build` 成功、`pnpm exec vitest run src` **232/232 PASS**（+9）、変更ファイルのeslintクリーン
- **実LETUS手動確認（ユーザー環境）**: 初回スキャンでベースライン（通知なし）→ コースに新教材/課題が増える → 次回スキャンで「コース更新」通知＋ダッシュボードに項目 → クリックでLETUSを開き既読化
- **逆流状態（拡張→litus 未反映）**: `courseUpdates` は litus と双子（突き合わせて寄せる）。`letusLinks`/`htmlText` は拡張発（litusへ移植された起源）。共有化後の差分があれば litus へ

---

## 2026-07-07 — v1.2.0 No.3 シラバス埋め込み表示を実装（fetch＋パース＋モーダル）

設計 `docs/superpowers/specs/2026-07-07-v1.2.0-no3-syllabus-embed-design.md` / 実装計画 `docs/superpowers/plans/2026-07-07-syllabus-embed.md` をtask-by-taskのTDDで実装。

- 実データ調査: CLASSシラバス（`SyllabusHtml.{年度}.{7桁}.html`）は**ログイン不要・直リンク可**（curlでHTTP 200確認）。div主体のレイアウトで `.rowStyle` 行ごとに `.colHeader`（日英ラベル）＋`.colStyle`（値）。4科目でラベル体系・順序が完全一致。取得済み4科目を `src/core/syllabusFixtures/*.html` に同梱
- `src/core/syllabus.ts`（`fdac108`系）: `buildSyllabusUrlByYear(code, year)` 追加、`buildSyllabusUrl` は薄いラッパに（年度キャッシュキーとURLの齟齬回避）
- パーサ `src/core/syllabusParse.ts`（`9420b24`）: `.rowStyle` を汎用走査しラベル→値のセクション配列＋`titleJa/titleEn/code` を抽出。ラベルは日英併記から日本語部分を取り出す（英字埋め込みラベルも正しく処理）。`<br>`は改行、nbsp/zwspを正規化。テストは `?raw` インポート（拡張tsconfigは@types/node無しでfs不可）
- store `src/core/syllabusStore.ts`（`62fde39`）: `fetch`→`parseSyllabus`→`chrome.storage.local` の `syllabus:{year}:{code}` に無期限キャッシュ。非200は例外
- UI `SyllabusModal.tsx`＋`syllabusContext.ts`（`b5c3eac`）＋配線（`bf75af4`）: ダッシュボードのモーダル（loading/error/loaded）。導線=時間割コマ📖・課題チップ、`SyllabusContext` の openSyllabus を **ダッシュボードのみ供給**（ポップアップはnull→従来の新規タブ）。科目切替でモーダル再マウント（key）してeffect内同期setStateを排除（`react-hooks/set-state-in-effect`）
- **manifest変更なし**（`class.admin` host_permissionはNo.2で追加済み）。バックエンド変更なし
- 検証: `pnpm exec tsc -b` clean、`pnpm build` 成功、`pnpm exec vitest run src` **221/221 PASS**（+12）、変更ファイルのeslintクリーン
- **実fetch手動確認（ユーザー環境）**: ダッシュボードで時間割コマの📖 or 課題チップの「シラバス」→ モーダルが開き整形表示 → 再取得ボタンで更新。失敗時は再試行＋CLASS外部リンク
- **逆流状態（拡張→litus 未反映）**: syllabusParse は**拡張発**（litusはURL生成のみ）。逆流タスクで litus へ移植候補

---

## 2026-07-07 — v1.2.0 No.2 CLASS時間割連携を実装（収集＋グリッド＋科目連携）

実装計画 `docs/superpowers/plans/2026-07-07-class-timetable-integration.md` をtask-by-taskのTDDで実装（base `710adbe`）。

- 純関数 `src/core/timetableLink.ts`（`b499323`）: `extractCourseCodes`/`extractCourseCode`（コード抽出）・`resolveSemester`（学期判定）・`applyOverrides`（教室オーバーライド）・`linkAssignmentsToSlots`（課題↔コマ突合・件数）。Task1/2は同一ファイルでnoUnusedLocals下Task1単独がtsc不可のため統合コミット
- ストレージ `src/core/timetableStore.ts`（`1d55996`）: `chrome.storage.local` I/O。キー `timetable:{year}:{semester}`・`timetableOverrides:{...}`・`timetableView`
- 収集 `src/content/classTimetable.ts`（`3f61817`）: **passive-only dumb grabber**。`table.classTable` の生HTML＋学期＋年度＋時限テキストのみを直書き保存（パースしない／`node-html-parser`も`timetableStore`もimportしない＝classic content scriptを壊さない）。`MutationObserver`で学期切替に追従、トースト通知。`manifest.json` に `https://class.admin.tus.ac.jp/*` の host_permission＋content_script追加、`vite.config.ts` に `classTimetable` エントリ
- 表示 `src/components/TimetableSection.tsx`（`30b1ceb`）: ダッシュボードに時間割グリッド。未取得時は取込導線、取得後はグリッド。前後期トグル（取得済みのみ活性）・教室の鉛筆編集（オーバーライドは再取得で消えない）・課題件数バッジ・シラバス絵文字リンク
- 課題カードのチップ（`33ff079`）: **計画からの変更** — 計画は各`AssignmentMemo`隣に同一チップJSXを8箇所重複挿入する内容だったが、`AssignmentCard` 内へ描画を集約し `AssignmentSlotContext`（React Context）で突合マップを供給する形に寄せて重複を排除。シラバスリンクは `stopPropagation` でカードのクリック遷移と分離
- **収集は passive-only**: 学期セレクタのdriving（値変更＋検索押下）はしない。ユーザーがCLASSの該当ページを開いたときだけ取り込む
- 検証: `pnpm exec tsc -b` clean、`pnpm build` 成功（`dist/classTimetable.js` 生成・import文0）、`pnpm exec vitest run src` **209/209 PASS**（+16）
- **実CLASS DOM手動確認手順（ユーザー環境）**: `dist/` を拡張として再読込 → CLASSにログイン → 履修→学生時間割表(`Kmd008`)を開く → トースト「時間割を取り込みました」→ DevToolsで `chrome.storage.local.get(null)` に `timetable:{年度}:{学期}` が入る → ダッシュボードにグリッド表示・突合できた課題カードに教室/時限/シラバスのチップ
- **逆流状態（拡張→litus 未反映）**: `timetableLink` の突合・オーバーライド・学期判定は拡張発（litusのTimetableScreenは更新ドットのみ・収集は「すべて」で学期解決なし）。ただし**コード抽出はlitus `src/parsers/letusCourses.ts` の `extractCourseCodesFromName`（`/\d{7}/g`）に対し、拡張版は境界ガード `(?<!\d)\d{7}(?!\d)`＋dedupを追加した上位互換**（litusの全テストケースを同結果で通過し8桁連番を弾く）。逆流タスクで litus 側へ境界ガード＋dedupを反映する（handoverにも記載）

---

## 2026-07-07 — v1.2.0 No.2/No.3 純粋ロジックをlitusから移植（timetable/syllabus）

案A（純粋ロジック先行移植）を実施。DOM/UI/`host_permissions`に触れず、実CLASS DOM不要でvitest検証できる土台を拡張へ入れた。

- 追加: 依存 `node-html-parser@^7.0.1`（litusと同一・逆流忠実度優先の妥当なデフォルト。まだどのエントリからもimportしないため`background.js`/`content.js`のバンドルは肥大せず）
- 移植: `src/core/timetable.ts`（CLASS `Kmd008` 時間割パース＋時限時刻表パース、litus `src/parsers/timetable.ts` と同一）＋`timetable.test.ts`/`timetable.fixtures.ts`、`src/core/syllabus.ts`（学年暦＋シラバスURL生成、litus `src/links/syllabus.ts` と同一）＋`syllabus.test.ts`
- テストは拡張の作法（`vitest`から明示import）に合わせ調整。それ以外はlitusと同一
- 検証: `pnpm exec tsc -b` clean、`pnpm exec vitest run src` 193/193 PASS（+13）、`pnpm build` 成功
- **逆流状態**: litus→拡張の初回移植は両者同一。以後拡張側で実DOM検証して差分が出たらhandover記録の上でlitusへ寄せる
- courseUpdates（No.4）は`letusLinks`依存で拡張の既存リンク抽出との突き合わせが要るため案Aに含めず、No.4のbrainstorm→planで扱う
- 残り（収集経路・グリッドUI・シラバス整形表示・`host_permissions`）はNo.2のbrainstorm→planへ（次段）

---

## 2026-07-07 — v1.2.0進捗棚卸し: No.1 entitlement無料開放は実装済みと確認、TASKS同期

v1.2.0を順に着手するため現状を精査した結果、**No.1「entitlement変更（無料開放）」はプラン（`plans/2026-07-04-free-first-entitlement.md`）のTask 1・2が全て実装・コミット済み**だった（`dfea278 feat(ext): open memo/priority/manual to free`・`f4efd46 feat(ext): make theme free...`）。TASKS.mdは`[ ]`のままで実態とズレていたため`[x]`へ同期。

- 確認: `AssignmentMemo.tsx`/`ManualAssignmentCard.tsx`から`isSubscriber`ゲート撤去済み、`PremiumGate.tsx`削除済み、`ProBanner`の`FEATURES`はカスタム通知ルール＋Discordの2件のみ、テーマは常時表示`displaySettings`ブロックへ移動済み、戦略書§2表のテーマ行も無料化済み
- 残る`isSubscriber`参照（App.tsx 3箇所）はプランが「残す」と明記したサブスク限定ブロック判定＋ベータトグル表示で、想定どおり
- 検証: `pnpm exec tsc -b` clean、`pnpm exec vitest run src` 180/180 PASS
- **次段（No.2 CLASS連携以降）は未着手**。litus側に純粋ロジック（`src/parsers/timetable.ts`・`src/links/syllabus.ts`・`src/updates/courseUpdates.ts`、いずれもnode-html-parser依存でRN非依存・テスト付き）が揃っており移植元は確定。ただしスコープ設計の規約どおり各機能は個別にbrainstorming→planが必要で、CLASS収集の実装・検証には実CLASS DOM（`class.admin.tus.ac.jp`ログイン）と`host_permissions`追加が要る

---

## 2026-07-06 — v1.2.0スコープ変更（決済後回し・CLASS連携/シラバス/更新通知を追加）

v1.2.0の中身を差し替え。決定記録スペック `docs/superpowers/specs/2026-07-06-v1.2.0-scope-change-design.md`。ドキュメントのみ、コード変更なし。

- v1.2.0 = **entitlement無料開放＋CLASS連携（時間割収集・グリッド表示・科目連携）＋シラバス埋め込み表示＋コース更新通知（定義A: `/mod/*/view.php` 増減）** の4本立て。`host_permissions` に `class.admin.tus.ac.jp` 追加で再審査になるため無料開放と同じ機会に一括Phase C申請
- **4機能はすべて無料開放**（課金ゲートなし）。**サブスク有料化の検討自体をリタス初版公開（9月）まで凍結**し、この期間は無料でのユーザー獲得に振る。既存の月額¥120サブスクは現状維持
- **パス型決済（半期¥720・年¥1,200）はv1.2.0から除外**しバックログ（凍結対象）へ。7/4 free-firstスペックの決済記述を本決定で凍結
- 保存はローカルのみ・**バックエンド変更なし**（ラズパイのデプロイ不要）
- **コード流通の規約**: 純粋ロジック（パーサ・差分・シラバスURL生成）は共有パッケージ化せず、**拡張で実DOM検証して磨き→litusへ逆流**。litusに既存実装があるため単純上書きせず突き合わせて寄せる。対応表（拡張↔litusパス）をスペックに明記。逆流状況はWORKLOG/handoverに記録する運用
- roadmap.md（フェーズ1.5縮小・フェーズ2をv1.2.0本体化・決済をバックログ節へ）、TASKS.md（v1.2.0を4本立て＋逆流タスク＋changelog書き換えに再構成）を整合
- 各機能のDOM/UI/通知の詳細設計は実装フェーズで個別にbrainstorming→planする

---

## 2026-07-06 — 開業届を提出・受付完了（モバイルストア事業者登録の第一歩）

v2.0.0モバイルアプリを個人事業主（組織）アカウントでストア公開する計画の実行を開始。freee開業→e-Taxで開業届を電子提出し受付完了。

- 提出書類: 個人事業の開業・廃業等届出書＋所得税の青色申告承認申請書（両方 e-Tax 受付完了）
- 申告方法は当初白色予定→**青色申告（65万円控除）に変更**（承認申請の2ヶ月期限・純損失3年繰越の有利さ）。屋号 waiteu／職業 ソフトウェア開発業／開業日 令和8年7月5日／提出先 江東西税務署
- 提出まで対話で伴走（各画面の選択・納税地=自宅住所・事業所欄スルー・e-Tax職業/メール選択を案内）。控え（電子申請控えPDF＋受信通知）はD-U-N-S/ストア審査の事業実在性証跡として保存
- 計画・入力値・特商法ドラフトは `docs/mobile-store-registration.md` / `docs/kaigyou-todoke-input.md` / `docs/tokushoho-draft.html`
- 次: バーチャルオフィス（DMMミニマム660円）＋事業用電話（povo）契約 → D-U-N-S申請 → Google/Apple登録。健保（外国運輸金融健保）への扶養確認は実売上が出た時点まで保留

---

## 2026-07-06 — リタスを独立リポジトリ `C:\dev\litus` へ分離、v1.0.0系列に改版

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
- フェーズ3 = **モバイルアプリ「リタス（Litus）」との連携**: 旧フェーズ3を改称し、2026-07-04のアプリ単体完結アーキテクチャ・9月公開目標・事前登録LP（lms.waiteu.dev/app）を反映
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
