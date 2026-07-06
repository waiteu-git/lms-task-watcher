# TASKS — Chrome Web Store 公開に向けたタスク

凡例: `[ ]` 未着手 / `[~]` 進行中 / `[x]` 完了

---

## P0: バグ修正（動作の正確性）

- [x] **background.js: lifecycleStatus の二重代入を修正**
  - `before_start` 判定が後続の `if` ブロックで上書きされる
  - 2つの代入ブロックを1つに統合し、優先順位を明確にする
  - `before_start > submitted > passed > active` の順で評価する

- [x] **background.js: onProgress で `state: 'completed'` を早期送信しない**
  - `mapWithConcurrency` の onProgress 内の `saveDeadlineScanStatus` に不完全なオブジェクト（`{ state: 'completed' }`のみ）を渡している
  - onProgress では `state: 'running'` の進捗情報のみ保存するよう修正する

- [x] **background.js: `notifyDeadlineSummary` をスキャン完了後の1回のみ呼ぶ**
  - 現在は onProgress（候補件数分）呼ばれており通知がスパムになる
  - `scanDeadlinesInBackground` の完了後（`mapWithConcurrency` 後）に1回だけ呼ぶ

---

## P1: Chrome Web Store 審査要件

- [x] **アイコンPNGの用意**
  - `public/favicon.svg` から sharp で 16/32/48/128px PNG を生成
  - `public/icons/` および `dist/icons/` に配置済み

- [x] **プライバシーポリシーの作成**
  - `privacy-policy.md` として作成済み
  - ストアに掲載するURLが必要（GitHub Pages または GitHub README の raw URL）

- [x] **ストア掲載情報の整備**
  - [x] 説明文（short / long）→ `store-listing.md` に記載済み
  - [x] プロモーション画像（440×280）→ `store-promo.png` 生成済み
  - [x] スクリーンショット（1280×800）→ `images/screenshots-1280x800-editable/` にスライド1〜5.PNG として準備済み

- [x] **`host_permissions` の最小化確認**
  - `https://letus.ed.tus.ac.jp/*` のみで最小限。`store-listing.md` に理由を記載済み

- [x] **manifest.jsonの `description` フィールドを改善**
  - 変更後: `"Never miss a LETUS assignment deadline. Automatically scans your courses and shows upcoming due dates with browser notifications."`（128文字）

---

## P2: コース登録フローの実装

- [x] **Content Scriptの作成**
  - `public/content.js` として作成（background.jsと同様にバニラJS）
  - `https://letus.ed.tus.ac.jp/*` 全ページで動作、`/course/view.php?id=XXXX` 形式のリンクを収集
  - `enabled: false` で登録（ユーザーがダッシュボードで手動でONにする）

- [x] **manifest.jsonに content_scripts を追加**
  - `matches: https://letus.ed.tus.ac.jp/*`、`run_at: document_idle`

- [x] **background.jsで `UPSERT_COURSES` メッセージを処理**
  - `upsertCourses` 関数と `saveCourses` 関数を追加
  - 既存コースのname/url/updatedAtのみ更新し `enabled` 状態は保持

---

## P3: background.jsのTypeScript化

- [x] **`src/background/index.ts` を作成**
  - `src/core/types.ts`・`src/core/scanStatus.ts` の型を再利用
  - P0バグ修正済みのロジックを型安全に再実装
  - `resolveLifecycleStatus()` として優先順位判定を独立した関数に分離

- [x] **`src/content/courseDetector.ts` を作成**
  - `Course` 型を利用した型安全な実装

- [x] **`vite.config.ts` のマルチエントリー設定**
  - `background` と `content` をエントリに追加
  - background は `"type": "module"` のサービスワーカーとして ES 形式で出力

- [x] **manifest.jsonに `"type": "module"` を追加**（background service worker）

- [x] **`public/background.js` と `public/content.js` を削除**
  - `pnpm build` で `dist/` に生成されるため不要

---

## P4: 通知・UX改善

- [x] **通知タイミングの拡張（24h前を追加）**
  - `notifiedDeadlineKeys` に `{id}:24h` を追加
  - background と App.tsx の両方で 1h → 3h → 24h の順に `else if` で排他判定

- [x] **Popupを開かなくても更新される仕組み**
  - `chrome.alarms` で2時間ごとに `runAutoScan()` を実行
  - `onInstalled` / `onStartup` でアラームを登録
  - manifest.jsonの `permissions` に `"alarms"` を追加

---

## P5: コード品質

- [x] **TypeScript型エラーがゼロであることの確認**
  - `pnpm tsc --noEmit` でエラーなし

- [x] **ESLintエラーがゼロであることの確認**
  - `pnpm lint` でエラーなし（PremiumGate.tsx の set-state-in-effect を修正）

- [x] **`src/core/assignmentScanner.ts` の整理**
  - background/index.ts に全ロジックが実装済みでどこからも import されていないため削除

---

## P6: v1.1.xリリース前QA

- [x] resetAllDataで手動課題も削除されるよう修正
- [x] 手動追加フォームの送信後にコース選択をリセット
- [x] ウィジェット表示をコースページ・課題提出ページに限定
- [x] コースページに課題ごとのインラインバッジ（締切+提出状況）を追加
- [x] 手動課題に提出済みトグルを追加
- [x] ダッシュボードのタイムラインに手動課題を統合（独立セクション廃止）
- [x] 締切通知（1h/3h/24h前）に手動課題を統合（popup側・background側）
- [x] 手動課題削除にUndoトーストを追加
- [x] content scriptのimport残存によるSyntaxErrorを修正（コース検出・手動課題ウィジェットが実機で完全に機能停止していた重大バグ）

---

## 完了済み

- [x] Popup UI（24時間以内・次の課題・ミニサマリ）
- [x] Dashboard UI（全セクション・コース選択・非表示管理）
- [x] 課題候補スキャン（scanLevel: strict/standard/broad）
- [x] 締切スキャン（HTML本文の正規表現パース）
- [x] 提出状況・ライフサイクル状態の判定（バグあり → P0参照）
- [x] 1h/3h前の締切通知（重複防止あり）
- [x] データ陳腐化通知（2h経過で自動更新）
- [x] 通知クリックで課題URLを開く
- [x] 非表示機能（Undo付き）
- [x] データ管理機能（削除・リセット）

---

## v1.2.0（2026-07-06 スコープ変更: 無料開放＋CLASS連携/シラバス/更新通知）

スコープ変更設計: `docs/superpowers/specs/2026-07-06-v1.2.0-scope-change-design.md`。無料開放（旧フェーズ1.5）とCLASS連携（フェーズ2）を **v1.2.0として一括リリース**する。`host_permissions` 追加で再審査になるため同じ機会にまとめる。Phase C（Web Store申請）は下記完了後。各機能の詳細設計は実装フェーズで個別に brainstorming → plan する。

- [x] **entitlement変更の実装**（完了: コミット `dfea278`・`f4efd46`）
  - 詳細設計: `docs/superpowers/specs/2026-07-04-free-first-entitlement-design.md`
  - 実装計画: `docs/superpowers/plans/2026-07-04-free-first-entitlement.md`
  - メモ・優先度・テーマのサブスクゲートを撤去（無料開放）、`PremiumGate.tsx`（未使用）を削除、`ProBanner`の機能リストをカスタム通知ルール・Discordのみに更新 — 全て適用済み・テーマは常時表示の `displaySettings` ブロックへ移動済み
  - バックエンド変更なし（同期は既に無料アカウント対応済み）

- [ ] **CLASS時間割 収集＋グリッド表示**（詳細設計は実装フェーズ）
  - `manifest.json` の `host_permissions` に `https://class.admin.tus.ac.jp/*` を追加
  - Content Scriptで時間割ページ `Kmd008` を取得 → パース → `chrome.storage.local` に保存 → ダッシュボードにグリッド表示
  - 収集範囲は履修科目・時間割のみに厳格限定（成績等は除外）
  - パーサはリタス `src/parsers/timetable.ts` を移植（→ 拡張 `src/core/timetable.ts` 想定）

- [ ] **科目連携（課題↔時間割の自動ひも付け）**
  - CLASS 7桁科目コード ↔ LETUSコース名埋込コードで突合（統合コースは複数コード対応）

- [ ] **シラバス埋め込み表示**
  - CLASS静的HTMLシラバス（`SyllabusHtml.{年度}.{7桁コード}.html`）を fetch → パース → 拡張内に整形表示
  - URL生成はリタス `src/links/syllabus.ts` を移植（→ 拡張 `src/core/syllabus.ts` 想定）

- [ ] **コース内容の更新通知（定義A）**
  - `/mod/*/view.php` リンク集合をコースごとにスナップショット → 再スキャン時に差分検知 → バッジ・通知
  - シグネチャ/差分はリタス `src/updates/courseUpdates.ts` を移植（→ 拡張 `src/background/courseUpdates.ts` 想定）

- [ ] **純粋ロジックのlitus逆流**（各機能実装後）
  - 拡張で磨いたパーサ・差分・シラバスURL生成を litus の対応ファイルへ反映し `litus` の `pnpm test` 通過を確認
  - 単純上書きせず両者を突き合わせて良い方に寄せる。WORKLOG（拡張）とhandover（litus）に逆流済み/未を記録
  - 対応表はスコープ変更設計を参照

- [ ] **changelog本文の書き換え**（v1.2.0リリース時）
  - `public/changelog.html` の「今回の変更点」をv1.2.0内容（無料開放・CLASS連携・シラバス・更新通知）に、見出しを「v1.2.0にアップデート」に更新。リタス告知は既存のロードマップカードで対応済み

- [ ] **Phase C: Chrome Web Storeへv1.2.0を申請**
  - 上記完了後、付加価値機能込みで一括申請

### 後回し（バックログ・バージョン未割当）

- **v1.2.0の4機能はすべて無料開放**（課金ゲートなし）。**サブスク有料化の検討自体をリタス初版公開（2026年9月）まで凍結**する
- **パス型決済**（半期¥720・年¥1,200、コンビニ・PayPay対応）: 上記凍結対象。リタス公開後まで検討しない。前提調査（StripeのPayPay・コンビニ決済対応）も凍結解除後に
- **統計・振り返り機能／スヌーズ**（任意、後ろ倒し可）

---

## モバイルアプリ「リタス」（旧v2.0.0 → 2026-07-06 独立リポジトリへ移管）

**アプリ本体の開発・タスク管理は `C:\dev\litus`（独立リポジトリ、v1.0.0系列）へ移管した。** 本リポジトリ `feature/v2.0.0` ブランチの `app/` は凍結。アプリ側タスクは `litus/TASKS.md`、引継ぎは `litus/docs/handover.md` を参照。

本リポジトリに残るリタス関連タスク:

- [ ] バックエンド: `POST /api/devices/token`（Expoプッシュトークン登録）・`PUT /api/v2/assignments/state`（見張り番の判定材料）
- [ ] LP・changelog: 以降のchangelogにリタス関連情報を掲載（CLAUDE.md参照）

以下は移管前の記録（参照用に残置）:

## （移管済み・参照用）v2.0.0: モバイルアプリ単体完結（2026-07-04 アーキテクチャ全面改定）

**旧「拡張=収集エンジン、アプリ=ビューア」構成、および旧v1.3.0（データ同期基盤の独立バージョン化）は廃止。** 新方針はアプリ単体完結（B案）: アプリ内WebViewでLETUS/CLASSにSSOログインし、アプリ側で直接収集する。拡張機能は「PC派の収集源＋PCダッシュボード」というサブ機能に再定位される。

詳細設計: `docs/superpowers/specs/2026-07-04-free-first-strategy-design.md`（上位方針）、`docs/superpowers/specs/2026-07-04-v2.0.0-mobile-app-initial-design.md`（初版実装設計、CLASS時間割ページの実地調査結果を含む）。

**背景（重要）:** 競合開発者（Android版「TUSapp」を計画中）の存在が判明。相手のAPK配布前にモバイルプッシュ通知を出すことが最優先事項。

**タイムライン:** 2026年9月（後期開始）までに初版公開 → 後期で実デバッグ・安定化 → 2027年4月に新入生へ本格展開。

### 初版スコープ（最小コア、「課題通知＋時間割閲覧＋見張り番プッシュ」に限定）

- [ ] React Native（Expo managed・TypeScript）プロジェクトのセットアップ（モノレポ`app/`ディレクトリ）
- [ ] LETUS収集: WebViewのSSOセッションCookie→fetch＋HTMLパース（`background.js`の収集ロジックをTS移植）
- [ ] CLASS収集: 非表示WebViewでメニュー遷移→時間割ページ（`Kmd008`）をDOMパース（付録Aのセレクタ・時限時刻表を使用）
- [ ] ローカルDB（expo-sqlite）・期限前ローカル通知＋朝まとめ（無料はローカル予約、サブスクはサーバープッシュ）
- [ ] 見張り番プッシュ（サブスクのみ、未提出のみ24h→6h→1hエスカレーション、提出検知で自動停止）
- [ ] バックエンド: `POST /api/devices/token`（Expoプッシュトークン登録）・`PUT /api/v2/assignments/state`（サブスクのみ、見張り番の判定材料）
- [ ] 画面: 課題一覧・時間割グリッド・設定（購入導線はWebのlms.waiteu.devへ誘導、Apple IAP回避）

### v2.0.x以降へ先送り（初版に含めない、確定済み）

- 手動課題追加・優先度/メモ編集・拡張↔アプリ同期・ホーム画面ウィジェット・スヌーズ・統計・カスタム通知ルールのモバイル移植

### 実装前の要検証事項

- LETUS/大学SSOのCookie寿命（WebView再ログイン体験）
- モバイルUAでCLASSがスマホ版へ誘導される場合の挙動（PC版UA固定 or スマホ版パーサーの判断）
- Expo Push実機疎通（APNs/FCM）
- LETUS収集ロジックのTS移植時、React Native環境での動作可否（DOMParser代替の要否）
