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

- [x] **CLASS時間割 収集＋グリッド表示**（実装計画: `docs/superpowers/plans/2026-07-07-class-timetable-integration.md`）
  - [x] パーサ移植: リタス `src/parsers/timetable.ts` → 拡張 `src/core/timetable.ts`（`node-html-parser`踏襲でlitusと同一・テスト/フィクスチャ同梱・13件通過）
  - [x] `manifest.json` の `host_permissions` に `https://class.admin.tus.ac.jp/*` を追加
  - [x] Content Scriptで時間割ページ `Kmd008` を取得（passive dumb grabber `src/content/classTimetable.ts`）→ `chrome.storage.local` に生HTML保存 → ダッシュボードで `parseTimetable` してグリッド表示（`TimetableSection`）
  - [x] 収集範囲は `table.classTable` と時限時刻のみに厳格限定（成績等は除外）
  - 実CLASS DOMでの疎通はユーザー環境で手動確認（WORKLOG記載の手順）

- [x] **科目連携（課題↔時間割の自動ひも付け）**
  - CLASS 7桁科目コード ↔ LETUSコース名埋込コードで突合（統合コースは複数コード対応）: `src/core/timetableLink.ts` の `linkAssignmentsToSlots`・課題カードに教室/時限/シラバスのチップ表示

- [x] **シラバス埋め込み表示**（設計: `docs/superpowers/specs/2026-07-07-v1.2.0-no3-syllabus-embed-design.md`、実装計画: `docs/superpowers/plans/2026-07-07-syllabus-embed.md`）
  - [x] URL生成移植: リタス `src/links/syllabus.ts` → 拡張 `src/core/syllabus.ts`（学年暦＋URL生成・テスト同梱・通過）。年度直接指定の `buildSyllabusUrlByYear` を追加
  - [x] CLASS静的HTMLシラバス（`SyllabusHtml.{年度}.{7桁コード}.html`、直リンク可）を fetch → パース（`src/core/syllabusParse.ts`、`.rowStyle`のラベル→値を汎用抽出）→ ダッシュボードのモーダル（`SyllabusModal.tsx`）で整形表示。無期限キャッシュ＋手動リフレッシュ。導線=時間割コマ📖＋課題チップ、ポップアップは新規タブフォールバック

- [x] **コース内容の更新通知（定義A）**（設計: `docs/superpowers/specs/2026-07-07-v1.2.0-no4-course-update-notification-design.md`、実装計画: `docs/superpowers/plans/2026-07-07-course-update-notification.md`）
  - [x] `/mod/*/view.php` リンク集合をコースごとにスナップショット（`courseSignature:{courseId}`）→ 既存スキャンのfetch済みHTMLから差分検知 → **追加のみ** Chrome通知＋ダッシュボードの項目履歴（`CourseUpdatesSection`）
  - [x] シグネチャ/差分（`src/core/courseUpdates.ts`: `computeCourseSignature`/`diffCourseSignature`/`computeCourseUpdate`）はリタス `src/updates/courseUpdates.ts` の双子。初回ベースライン・skipSaveガード（ログイン切れ時のベースライン破壊防止）
  - [x] `letusLinks`（リンク抽出）を拡張の `src/background/index.ts` から共有モジュール `src/core/letusLinks.ts`＋`src/core/htmlText.ts` へ抽出（挙動不変・既存テスト緑）＝設計書の言う「突き合わせ」を完了

- [x] **時間割UI改善＋コース自動選択＋ウェルカムガイド改訂**（2026-07-08、設計: `docs/superpowers/specs/2026-07-08-v1.2.0-release-timetable-onboarding-design.md`、実装計画: `docs/superpowers/plans/2026-07-08-v1.2.0-timetable-onboarding.md`、feature/v1.2.0-timetable-onboarding）
  - [x] 締切の緊急度カラーバッジ（当日=赤/今日を除く7日以内=橙、カレンダー日基準）＝`deadlineTier`（`src/utils/date.ts`）＋`linkAssignmentsToSlots`の`courseCodeUrgency`集計（scan＋手動課題、提出済/期限切れ/開始前除外、today>week>none）。件数チップ廃止（`courseCodeCounts`削除）
  - [x] ポップアップに「今日の時間割」を常設（`TodayTimetable.tsx`、週末→翌月曜=`resolveDisplayDay`）。ポップアップ幅390→440px
  - [x] コース内容に更新があるコマ／課題に**NEWバッジ**（未読更新コースの科目コード=`newBadgeCodes`をTimetableSection・TodayTimetableへ）
  - [x] 時間割にある科目のコース自動選択（`selectCoursesByTimetable`＋`Course.userToggled`、background `applyAutoSelect`をUPSERT_COURSESと`storage.onChanged('timetable:')`に配線。片方コード一致でON・手動トグル尊重・自動DISABLEなし・手動締切課題も緊急度判定に含む）
  - [x] ウェルカムガイドをCLASS先行→LETUS自動選択フローに改訂（`public/welcome.html`）
  - [x] テストTZをAsia/Tokyoに固定（`vitest.setup.ts`、日時テストの非JSTランナー移植性）
  - [x] 品質: tsc -b緑・vite build成功・vitest 190/190緑（実src）。opus最終whole-branchレビュー=READY TO MERGE（Critical/Importantなし）

- [x] **v1.2.1 バグ修正**（2026-07-10）
  - [x] 科目ID（コース番号）に英字を含むコース（`9975A06`/`9960S01`/`9960E09` 等）が時間割からのコース自動選択に載らない不具合。旧 `\d{7}` 固定を共有モジュール `src/core/courseCode.ts`（`\d{4}[0-9A-Z]{3}`）へ集約し `timetable.ts`（セルのパース）・`timetableLink.ts`（LETUSコース名）を差し替え。litus `src/parsers/courseCode.ts` の双子。セル全文は要素間が連結される（`9973337`+`2.0単位`）ため、科目IDのdiv完全一致を主・境界なし走査をフォールバックにする
  - [x] 課題提出後にLETUSページ上のバッジが「未提出」のまま更新されない不具合。真因＝content scriptが起動時のストレージ・スナップショットで一度だけ描画し `storage.onChanged` を購読していなかった（popup/dashboardは購読済み）。状態決定を純粋層 `src/core/badgeState.ts` に切り出し、`manualTaskWidget.ts` を差分再描画＋`storage.onChanged`／bfcache `pageshow` 購読に変更。課題ページ右下の表示も「登録済み」→ 実提出状態へ
  - [x] content script が popup と実行時モジュールを共有すると Rollup が共有チャンクへ切り出し `content.js` に `import` 文が残る（classic scriptなので全機能が死ぬ）。vite.config.ts にビルド時ガードを追加

- [x] **`already_running` を無害な状態として扱う**（2026-07-13・実機検証で発見）
  - ポップアップ／ダッシュボードは開くたびに自動更新をトリガーするため、ポップアップ→ダッシュボードのように併用すると2つ目の `START_ASSIGNMENT_SCAN` に background が `already_running` を返す。旧 `updateNow` は `not_logged_in`／`network_error` のみ早期returnし、それ以外を `throw` していたため、無害なこのレースが catch に落ちて **①`console.error` で chrome://extensions のエラー欄を汚す ②「更新中にエラーが発生しました」の偽通知を出す** 二次被害を招いていた（機能破壊はなし）
  - 応答分類を純粋層 `src/utils/scanResponse.ts`（`classifyScanStartResponse` → proceed/abort/error）に切り出し、`already_running` を `not_logged_in`／`network_error` と同格の abort（案内メッセージのみ・throwなし）に。想定外 reason だけ error（従来どおり throw＋通知）にフォールバック。`App.tsx` の inline 分岐を差し替え

- [x] **後期の時間割が自動取込されない不具合**（2026-08-01・統合管理ハブ経由のユーザー指摘で発覚）
  - 症状: 前期に時間割を取り込んだ利用者は、後期になっても前期の時間割・コース連携が表示され続け、促しも出ない
  - 真因1: `classTimetable.ts`の`detectSemester()`はCLASSページの学期セレクタの現在値をそのまま読むだけで、CLASSが前期のまま初期表示される限り後期は取り込まれない
  - 真因2: `resolveSemester()`は取得済みキャプチャがあれば`capturedAt`最新のものを無条件に返し、日付を見て古さを判定しない
  - 真因3: `timetableImportNotified`が単一のグローバルbooleanで、一度通知したら二度と立たない（前期の「取り込みました」通知後、後期の取込を通知できない）＝2026-07-15設計仕様の非目標「学期別の初回通知はYAGNI」を、後期開始という新しい非対称UXの発生を理由に撤回
  - 修正: `timetableLink.ts`に日付ベースの「あるべき学期」判定(`calendarSemester`・2026年度後期開始日9/11を確定値テーブルで保持)と、取得済みと突き合わせる`findMissingCurrentSemester`を追加。`resolveSemester`の表示挙動（stale許容）自体は変えない、純粋な追加シグナル。ダッシュボード(`TimetableSection`)とポップアップ(`TodayTimetable`)に`.warningCard`で「CLASSを開く→」ボタン付きの案内を追加（CLASSのフォームを裏で操作することはしない）。`timetableImportNotified`を`{year}:{semester}`文字列の配列へ移行（`notifiedDeadlineKeys`と同型）し、`handleInstalled`の移行バックフィルを冪等化（旧実装は更新のたびに再計算し、後期分の通知履歴を消しうる潜在バグだった）
  - 出典: `docs/superpowers/SPEC-2026-08-01-v1.4.x-semester-transition.md`（ローカル限定）⚠**2026-09-02時点で ~/dev 配下に実在しない**（find 0件）。「同年度prefの維持」が設計上の非目標として決まったのか実装の副作用の追認かを確かめる一次資料が欠落している
- [x] **年度をまたぐと表示学期の保存設定が誤適用される不具合**（2026-08-30発見・2026-09-02コミット。v1.4.1の後続）
  - 症状: 前年度に学期タブを明示選択した利用者は、年度が替わっても当時の学期が既定表示に採用され続ける（例: 2025年度後期を選んだまま2026年度前期を迎えると、2026年度「後期」＝未取得の空表示になる）
  - 真因: `resolveViewSemester()` が `pref?.semester ?? …` と学期だけを見ており、`getPreferredView()` が併せて保存している `year` を照合していなかった。保存側 `setPreferredView(year, semester)` は導入時（`ddc6fa4`）から `{year, semester}` 形で書いており、読む側だけが年を捨てていた
  - 修正: `if (pref?.year === year) return pref.semester` の年ガードを追加。年度が一致しない pref は捨て、既存の「取得済み最新 > 日付判定」へフォールバックする
  - 適用範囲: 呼び出し側3箇所（`App.tsx`・`TodayTimetable.tsx`・`TimetableSection.tsx`）はいずれも `11a2c1f` で共有関数 `resolveViewSemester` 経由に統一済みのため、**各コンポーネント側の修正は不要**（`TimetableSection.tsx` は `8750917` 時点では同じ式をインラインで持っていたが `11a2c1f` で解消済み）。`year` は全呼び出し側が `academicYear(now)` を渡すため、pref側の `year` と同じ「年度」で比較される
  - 非変更: 同年度内の明示選択は後期開始後も維持する（`表示選択 > 取得済み最新 > 日付判定` の優先順は不変）。**2026-09-02にこの「意図的」という位置づけが争点化したが、B＋Fで実害を塞いだため反転は不要と裁定（2026-09-03）。詳細は下のエントリ**
  - テスト: `src/core/timetableView.test.ts` に8件（別年度prefの無視×2＝年ガード未適用だと落ちる回帰、後期開始日2026-09-11の境界×2、取得済み最新優先、同年度prefの維持、年度跨ぎ2027-01の採用）

- [x] **同年度prefが後期開始後も維持される件＝裁定済み（B＋F採用、A却下）**（2026-09-02上申 → 2026-09-03ユーザー裁定・同日実装）
  - 症状: v1.4.1の督促カードの指示に従って後期を取り込むと、状態が取り込む前より悪くなる。`findMissingCurrentSemester`（`timetableLink.ts:63-67`）は「現学期が captured に有るか」しか見ず**表示中の学期を見ていない**ため、取込でカードが消える。一方 `resolveViewSemester` は pref を返し続けるので**表示は前期のまま**＝指示に従った行動そのものが唯一の警告を消す
  - pref の母集団は広い: アクティブ側の学期タブが disabled でないため（`TimetableSection.tsx:153-163` の押下ガードは `disabled={!captured.includes(s)}` のみ）、**表示が何も変わらないクリック1回で pref が永続保存される**（同 105-108）。「意図的に固定した人」に限らない
  - 最も現実的な生成経路では督促カードすら出ない: 8月にCLASSで後期を先に開いて自動取込→表示が後期へ飛ぶ→正当に「前期」タブで戻す。この場合 kouki は既に captured で、9/11以降カードは一度も出ない
  - 波及: `App.tsx:159-175` の `assignmentSlotMap` も同じ resolver 経由＝後期科目の課題カードから曜限・教室・シラバスが消える。background は前期∪後期の和集合（`background/index.ts:326-336`）なので後期課題の通知は鳴る＝「通知は後期・画面は前期」。取込時のOS通知は「後期の時間割を登録しました。ダッシュボードで確認できます」と言い、遷移先が前期を表示する
  - 脱出手段なし: `resetAllData`（`App.tsx:1034-1047`）の remove 一覧に `timetableView` は含まれず、初期化しても解除されない。ポップアップには学期ラベルも切替UIも無い（`setPreferredView` の呼び出しは全リポで `TimetableSection.tsx:107` の1箇所）。拡張本体にキルスイッチ／リモートフラグも無い＝外した弾の撤回はストア審査
  - 選択肢: A=resolver修正で既定を直す（+9/-3行・UI無変更）／B=表示規則据え置き＋「後期は取込済みだが表示は前期」カードと1タップ切替を両画面に追加／D=9/11観測後に決める／F=学期トグル3択化（前期・後期・**自動**。クォーターUIに同じ実装が既存＝新規設計ゼロ）／H=コードを触らずLPで告知（ストア審査を迂回できる唯一の伝達路）
  - ⚠**A＋Bの同梱は不可**: resolver修正と `TimetableSection.tsx:43` の依存拡大（`[year]`→`[year, courses]`）を同時に入れると courses が毎秒再生成されるため毎秒 `setSemester` が走り、学期タブが押しても即戻って使用不能になる
  - ⚠**案A単独の既知欠陥2件**: ①`KOUKI_START_DATES` は2026の1件のみで未登録年度のフォールバックは**9月を前期扱い**（`timetableLink.ts:41`）＝案Aだと**2027-09に同じ症状を自分で作る**（現行コードは capturedAt 最新で正しく後期にする）。年次更新は一回性タスクとして未登録＝§8-⑥の「無言で落ちる予定」。②`capture()` は `table.classTable` の有無しか見ず（`classTimetable.ts:74-77`）、`listCapturedSemesters` はキーの存在しか見ない（`timetableStore.ts:23-29`）＝**履修未確定の空の後期表**を最優先で選び、完全な前期表を空の後期に置き換えうる
  - 締切の実態: **9/11必達ではない**。保存データの破壊でなく描画時判定なので、遅れて着地しても放置された利用者を含め全員が遡って是正される。一方 `store-submission-v1.4.1.md:40` に「Edge審査は数日〜2週間の実績」と自己記録があり9/11に両ストアが揃う見込みは低い ⇒「9月中旬までに確実に、壊さずに出す」が正しい締切
  - 製品横断: Litus は同じ問題を先に踏み**逆の設計**を実機検証つきで採用済み（`litus/src/collect/semester.ts` は境界を遠隔配信の学年暦から取り「**ここで固定値を作らない**」と明記）。境界もズレる（LTW=9/11固定、Litus=学年暦があれば8/6と9/11の中点＝**8/24**）＝同じ学生が両方使うと8月下旬〜9月上旬に製品間で表示学期が食い違う
  - ⚠別件で発見（本件より悪い）: `detectSemester`（`classTimetable.ts:34-46`）は学期セレクタに当たらない場合 `document.body.textContent` に「後期」が含まれれば kouki を返す（「前期」より先に判定）。**セレクタの name/id が変わるだけで前期の表が `timetable:2026:kouki` に保存され**、督促カードが「後期取込済み」と誤判定して永久に消える。Litus は同画面で見出しの正規表現方式に切替済み
  - 全文（ローカル限定・gitignore済み）: `docs/superpowers/ESCALATION-2026-09-02-timetable-view-semester.md`
  - 裁定（2026-09-03・統合ハブ経由でユーザー「go」）: **B＋F＋H**を採用。A（resolver修正）は不採用——上の「案A単独の既知欠陥2件」のうち①未登録年度は9月を前期扱いへ回帰し2027-09に同じ症状を自作する、②空の後期表を最優先しうる欠陥がよりによって9/11の履修未確定期に最悪化する、の2点が理由。同年度prefの優先順位そのものを反転する案も不採用＝B＋Fで「指示に従うと警告が消えて表示は放置される」実害を塞いだため、優先順位を変える理由が無くなった（line 198の「非変更（意図的）」は据え置き）
  - 実装:
    - B: `timetableLink.ts`に`findStaleDisplayedSemester(now, captured, displayed)`を追加（`findMissingCurrentSemester`の逆＝取得済みなのに表示が古い場合に切替先を返す純関数）。`TimetableSection`・`TodayTimetable`の両方に「◯期の時間割は取込済みです」＋1タップ切替ボタンの`.warningCard`を追加
    - F: 学期トグルを前期/後期/**自動**の3択に拡張（クォーターUIの`Quarter | null`パターンを踏襲）。`setPreferredView`が`semester: Semester | null`を受け付けるよう変更し、nullで`VIEW_KEY`をremove（`setCurrentQuarter`のnull解除と同型）。「自動」選択時は`resolveSemester(now, captured)`で即時再評価する
    - H: LP（lms.waiteu.dev）告知はコピー未確定のためユーザーと文言協議中。コミットするがpushはしない
  - テスト: `timetableLink.test.ts`に`findStaleDisplayedSemester`5件、`timetableStore.test.ts`に`setPreferredView(year, null)`の解除確認1件を追加。既存736件＋新規6件、tsc/vite build/eslint（0 errors、既存4警告は変化なしと確認済み）すべて通過
  - ⚠️別件で発見された次の2件は本裁定のスコープ外として下記の別エントリに分離した（起票のみ・未着手）

- [ ] **`detectSemester`のセレクタ脆弱性**（2026-09-02発見。v1.4.2以降の候補として起票のみ・未着手）
  - 症状: `classTimetable.ts:34-46`の`detectSemester`は、学期セレクタに当たらない場合`document.body.textContent`に「後期」が含まれればkoukiと判定する（「前期」より先に判定するフォールバック）。CLASSのセレクタのname/idが変わるだけで、前期の時間割表が`timetable:{year}:kouki`として誤保存されうる
  - 波及: 誤保存後は督促カード（`findMissingCurrentSemester`）が「後期は取込済み」と判定し、二度と正しい取込を促さなくなる。本物の後期データは一度も取り込まれないまま埋もれる
  - 参考: Litusは同じ画面を見出しの正規表現方式に切替済み（`litus/src/collect/semester.ts`相当）

- [ ] **製品横断の学期境界不整合（LTW固定日 vs Litus学年暦）**（2026-09-02発見。評価・裁定は統合ハブの担当＝本リポでは起票のみ）
  - 症状: LTWは後期開始日を年度ごとの確定値テーブルで固定管理（`KOUKI_START_DATES`、2026年度=9/11）。Litusは遠隔配信の学年暦から境界を導出し、学年暦が無ければ8/6と9/11の中点＝8/24を使う。同じ学生が両方使うと8月下旬〜9月上旬に表示学期が食い違いうる
  - 対応: 本リポ単体では解決しない設計判断（どちらかに合わせる／両方を学年暦ベースに統一する、等）。評価・裁定は統合ハブが担当。本リポでは実装しない

- [ ] **v1.4.2が両ストアで公開されたら、lms.waiteu.devの一時告知を撤去する**（2026-09-04追加。commit `642995b`で追加した一時告知の受け皿。統合ハブ指摘：削除条件を書いた本人と気づく主体が同じでないと無言で残る＝[[verify-the-clearing-path-can-fire]]）
  - 対象: `landing/index.html`の①トップ告知バー（TEMP NOTICEコメント）②v1.4.1エントリの3件目のブレット（「取込済みなのに表示が前の学期のまま...」）。両方とも削除しコミット
  - 発火条件: Chrome Web Store / Edge Add-onsの両方でv1.4.2の審査が通り公開されたこと（`store-submission-v1.4.2.md`の申請後、実際に配信されたことを両ストアで確認）
  - 発火に気づく主体: 本タスクの担当セッション（新バージョンLTW開発ハブ）。ストア公開確認時にこの項目を思い出すこと（他タスクからの自動連動は無し＝手動チェックリスト）

- [ ] **2026-09-11（後期開始日）に実機観測する**＝日付の一回性タスク（§8-⑥: 条件に紐づけると無言で落ちるので日付で持つ）
  - 🔴**観測前に必ず「どのブラウザで見たか」＋そのブラウザにインストール済みの拡張機能バージョンを記録すること**（統合ハブ2026-09-04指摘）。Edgeは審査に2週間かかった実績があり（v1.2.1=7/14提出→7/29時点も掲載1.2.1のまま）、v1.4.2をChrome/Edge同日提出しても**9/11時点でChromeだけv1.4.2・Edgeはv1.4.1のまま**の状態があり得る。この場合B+F（学期表示が古いまま検知・修正）はEdge側に入っていない。バージョン記録が無いと「直っていない」のか「まだEdgeに届いていない」のかを後から切り分けられない
  - 掲載版数はcurlで無認証確認可能（本ファイル内既出の恒久知見）: Chromeは掲載HTMLに`>Version</div><div class="nBZElf">`、Edgeは`https://microsoftedge.microsoft.com/addons/getproductdetailsbycrxid/femdjgdgelnbdpgnfehacobmpbfmbdoa`のJSON`version`
  - CLASSが9/11時点で後期時間割表を返すか。履修登録未確定で**空/部分**にならないか（上の案A欠陥②の前提）
  - pref 保持状態（DevToolsで `chrome.storage.local` の `timetableView` を確認）でポップアップの「今日の時間割」が何を出すか
  - 後期科目の課題カードに曜限・教室・シラバスが出るか
  - ⚠ `store-submission-v1.4.1.md:30` の「実機確認」は**未チェックのまま v1.4.1 が公開されている**。督促カード・取込通知・後期ページでの `detectSemester` は一度も実機で踏まれていない
- [x] **純粋ロジックのlitus逆流**（2026-07-08 判定: **不要**）
  - litus `src/assignments/buckets.ts`（within24h/tomorrow/thisWeek/…）が拡張の新`deadlineTier`（当日/今週）より高機能で先行＝逆流でもたらす改善なし
  - `selectCoursesByTimetable`（enable管理連動）・`resolveDisplayDay`（popup今日）は拡張固有で単体完結アーキのlitusに非マップ
  - 既存の parser/差分/シラバスURL は本リリースで未変更（前回逆流済みのまま）
  - 注: litusの`within24h`/`thisWeek`はrolling-msだが設計doc準拠の意図的仕様（別件・scope外）

- [x] **changelog本文の書き換え**（v1.2.0、commit 6959f02）
  - `public/changelog.html` を「v1.2.0にアップデートしました」＋7機能＋リタス事前登録導線 https://lms.waiteu.dev/app に更新。ロードマップのフェーズ1.5クローズ/フェーズ2オープンも整合。manifestは既に1.2.0（`public/manifest.json`、class.admin権限あり）
  - ⚠️ 残: `store-listing.md` のLong-description本文がv1.0.5のまま→ストア申請前に要更新（追跡タスク化済み）

- [ ] **Phase C: Chrome Web Storeへv1.2.0を申請**
  - 上記完了後、付加価値機能込みで一括申請

### 後回し（バックログ・バージョン未割当）

- **v1.2.0の4機能はすべて無料開放**（課金ゲートなし）。**サブスク有料化の検討自体をリタス初版公開（2026年9月）まで凍結**する
- **パス型決済**（買い切り型、コンビニ・PayPay対応を想定）: 上記凍結対象。価格を含む具体案は非公開メモで管理する。リタス公開後まで検討しない。前提調査（決済事業者のPayPay・コンビニ決済対応）も凍結解除後に
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

**背景（重要）:** 同種のモバイルアプリを開発している他の学生がいることが分かった。モバイルプッシュ通知を早期に届けることを優先する。

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
