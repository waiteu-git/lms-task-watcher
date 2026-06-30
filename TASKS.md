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

## フェーズ2.5: データ同期基盤

- [ ] **バックエンド: `POST /api/assignments` エンドポイントを追加**
  - JWT認証（既存auth基盤を流用）
  - ユーザーIDに紐づいてSQLiteに保存

- [ ] **バックエンド: `GET /api/assignments` エンドポイントを追加**
  - モバイルアプリ向け読み取りAPI

- [ ] **background/index.ts: スキャン完了後にバックエンドへPUSH**
  - ログイン済みの場合のみ実行
  - 未ログイン時は従来のローカル保存のみ

- [ ] **lifecycleStatus 'new' / 'changed' の付与ロジックを実装**
  - `firstSeenAt` が直近のスキャンと一致 → `'new'`
  - `deadline` または `title` が前回と差異あり → `'changed'`
  - AssignmentCard.tsx にバッジ表示を追加

---

## フェーズ4: 時間割連携

- [ ] **CLASSシステムの調査**
  - ドメイン確認
  - 授業IDとLETUSコースIDの対応関係を確認

- [ ] **manifest.json に CLASSドメインの `host_permissions` を追加**

- [ ] **content script: CLASSの時間割ページから授業ID・コース名を取得**

- [ ] **バックエンド: `POST/GET /api/timetable` エンドポイントを追加**

- [ ] **時間割グリッドUI（Chrome拡張 Dashboard に追加）**
  - コマをクリックで対応するLETUSコースに遷移

---

## フェーズ2.5: データ同期基盤

- [ ] **バックエンド: `POST /api/assignments` エンドポイントを追加**
  - JWT認証（既存auth基盤を流用）
  - ユーザーIDに紐づいてSQLiteに保存

- [ ] **バックエンド: `GET /api/assignments` エンドポイントを追加**
  - モバイルアプリ向け読み取りAPI

- [ ] **background/index.ts: スキャン完了後にバックエンドへPUSH**
  - ログイン済みの場合のみ実行
  - 未ログイン時は従来のローカル保存のみ

- [ ] **lifecycleStatus 'new' / 'changed' の付与ロジックを実装**
  - `firstSeenAt` が直近のスキャンと一致 → `'new'`
  - `deadline` または `title` が前回と差異あり → `'changed'`
  - AssignmentCard.tsx にバッジ表示を追加

---

## フェーズ4: 時間割連携

- [ ] **CLASSシステムの調査**
  - ドメイン確認
  - 授業IDとLETUSコースIDの対応関係を確認

- [ ] **manifest.json に CLASSドメインの `host_permissions` を追加**

- [ ] **content script: CLASSの時間割ページから授業ID・コース名を取得**

- [ ] **バックエンド: `POST/GET /api/timetable` エンドポイントを追加**

- [ ] **時間割グリッドUI（Chrome拡張 Dashboard に追加）**
  - コマをクリックで対応するLETUSコースに遷移
