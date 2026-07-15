# Chrome Web Store 申請チェックリスト — v1.2.2

アップロード用パッケージ: **`letus-task-watcher-1.2.2.zip`**（`dist/` を forward-slash パスで zip 化・Python `zipfile` 生成＝Windows Compress-Archive の backslash 問題を回避）
manifest version: **1.2.2**（**公開中の 1.2.1 からの通常アップデート**。v1.2.1 は 2026-07-14 に Chrome Web Store で公開済みのため、新バージョン番号でアップロードする）／ manifest v3 ／ 決済・外部サーバー通信なし（ローカル完結）

## このリリースの中身（v1.2.1 → v1.2.2 の差分）

公開中の v1.2.1 に対し、**機能追加・改善2本**を同梱する。**新しい権限の追加はなし**（`notifications` は既存・テーマ/ミュートは端末内設定のみ）。外部送信ゼロ・単一用途・データ収集なしはすべて v1.2.1 から不変。

1. **時間割取り込みのフィードバック強化**（`feature/timetable-import-feedback`）
   - CLASS の学生時間割表を取り込んだ際のトーストに年度・学期を明記（「2026年度前期の時間割を取り込みました」）
   - ポップアップの時間割ヘッダに「最終取込 日時」を表示（`capturedAt` を利用）
   - **初回取り込み時のみ** OS 通知を1回表示（クリックでダッシュボード）。以後の再取込では鳴らさない。更新前に既に取り込み済みの既存ユーザーには初回通知を出さない移行あり
2. **通知ミュートの実効化＋テーマ自動＋設定の再配置**（`feature/dashboard-settings-notify-theme`）
   - **通知ミュートを実際に機能させた**。従来 `resolveThresholds` がサブスク状態でゲートされ、バックエンド凍結後は常に既定しきい値を返していた（＝ミュート/コース別しきい値が無効だった）。ゲートを撤去し、コース別ミュート/しきい値を締切通知・コース更新通知の双方に適用（ミュート時も NEW バッジ/履歴は維持）
   - **テーマ「自動（OS 追従）」を追加し初期値に**。ライト/ダークの明示選択も可能
   - **ダッシュボード下部の設定を再配置**（「設定」見出し・長い項目を標準格納）

## 0. 申請前チェック（機械的検証・2026-07-15）

- [x] `pnpm vitest run src` → **276 passed**（develop に両機能マージ後）
- [x] `./node_modules/.bin/tsc -b` → exit 0・出力なし
- [x] `pnpm build` → 成功
- [x] `npx eslint src` → 新規エラーなし（既存の `src/core/syllabusParse.ts` irregular-whitespace 2件・`TimetableSection.tsx`/`TodayTimetable.tsx` の exhaustive-deps warning 計4件のみ・いずれも別件の既存分）
- [x] `dist/classTimetable.js` / `dist/content.js` に `import` 文なし（classic script が壊れていないことの確認）
- [x] `dist/manifest.json` の `version` が **1.2.2**、`host_permissions` は `letus.ed.tus.ac.jp` と `class.admin.tus.ac.jp` の2つのみ（**新規ホスト追加なし**）
- [x] 独立サブエージェントによる時間割機能の敵対的レビュー → 実バグなし
- [x] **実機確認（ユーザー実施・2026-07-15）**: 時間割トースト/最終取込表示/初回通知・ミュート/テーマ自動/設定再配置を結合プレビューで確認 → OK

## 1. パッケージ

1. `pnpm build` で `dist/` を生成（version 1.2.2）
2. `letus-task-watcher-1.2.2.zip` を forward-slash で作成（旧 `letus-task-watcher-1.2.1.zip` はアップロードしないこと）
3. Chrome ウェブストア デベロッパー ダッシュボード → 既存アイテムの「パッケージ」タブから **1.2.2** をアップロード

## 2. ストア掲載の「変更点（What's new）」テキスト

日本語:
```
v1.2.2 の変更点
・時間割の取り込みがわかりやすく:取込トーストに年度・学期を表示、ポップアップに「最終取込 日時」を表示、初回取込を通知でお知らせ。
・通知のミュートが実際に効くようになりました:コースごとに締切通知・更新通知をミュート/しきい値変更できます(NEW表示は残ります)。
・テーマ「自動(端末のライト/ダークに追従)」を追加し初期設定に。ライト/ダークの固定も選べます。
・ダッシュボード下部の設定を「設定」としてまとめ、見やすく整理しました。
権限の追加はありません。データはこれまでどおりすべて端末内に保存し、外部へ送信しません。
```

English:
```
What's new in v1.2.2
- Clearer timetable import: the import toast now shows the year and term, the popup shows the last-imported time, and the first import is confirmed with a notification.
- Notification mute now actually works: mute or change deadline-warning thresholds per course (the NEW badge is kept). Course-content update alerts respect the mute too.
- New "Auto" theme that follows your device's light/dark setting (now the default). You can still pin Light or Dark.
- The dashboard's lower settings are grouped under a "Settings" heading and tidied up.
No new permissions. All data stays on your device and is never sent externally.
```

## 3. 単一用途 / 権限 / プライバシー

**v1.2.1 から不変。** 単一用途（LETUS 課題締切の収集・通知＋CLASS 時間割連携）・権限（`storage`/`notifications`/`alarms`＋ホスト2つ）・データ収集なし（端末内完結・外部送信ゼロ）はすべて `store-submission-v1.2.1.md` §3〜§5 の記載どおり。**今回の変更で権限・通信先・データ取り扱いは一切増えていない**（時間割の初回通知は既存 `notifications` の範囲・テーマ/ミュートは `chrome.storage.local` 内の設定のみ）。

- 規約URL `https://lms.waiteu.dev/terms`（版2）・プライバシー `https://lms.waiteu.dev/privacy` は公開済み（申請直前に 200 を再確認）

## 4. スクリーンショット

v1.2.1 の素材（`store-assets/store-shot1〜3.png`）を流用可。テーマ自動/設定再配置で見た目が一部変わるため、余裕があればダッシュボード（設定セクション・テーマ切替）を撮り直すとよい（必須ではない）。

## 5. 提出（ユーザー操作）

1. `letus-task-watcher-1.2.2.zip` を「パッケージ」タブでアップロード
2. 「変更点」欄に §2 のテキストを貼る（listing/privacy/terms URL は据え置き）
3. `/terms`・`/privacy` の 200 を再確認
4. 「審査に送信」

**アップロードと申請はユーザー操作（エージェント不可＝アカウントログイン禁止）。** Edge Add-ons も同様に 1.2.2 で更新（審査は別途）。
