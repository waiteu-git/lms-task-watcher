# Chrome Web Store 申請チェックリスト — v1.4.0

アップロード用パッケージ: **`letus-task-watcher-1.4.0.zip`**（`dist/` を forward-slash パスで zip 化・Python `zipfile` 生成・19エントリ・約219KB）
manifest version: **1.4.0**（**公開中の 1.3.0 からの通常アップデート**。v1.3.0 は 2026-07-22 に Chrome Web Store で公開済み）／ manifest v3 ／ 決済・外部サーバー通信なし（ローカル完結）

## このリリースの中身（v1.3.0 → v1.4.0 の差分）

週間カレンダーリリース（ユーザーフィードバックフォーム3件を指針にスコープ確定）。**新しい権限の追加はなし・新規ホストなし・外部送信ゼロ不変**。LETUS へのリクエスト増もゼロ（カレンダーは popup/dashboard が既に持つ収集済みデータの表示のみ／ICS 生成は完全ローカルの Blob ダウンロード）。

1. **週間カレンダー**（dashboard 新セクション）
   - スキャン課題＋手動課題＋ユーザー設定締切を統合した週表示（月曜始まり・前後週ナビ・今日ハイライト）
   - チップ操作: 締切未設定のスキャン課題は右上「＋」（締切設定）/「×」（非表示・danger色）。手動課題・手動締切は右上「✎」で締切・提出状況のインライン編集（手動締切はクリア=自動検出復元も可）
   - 締切未設定リストは未提出のみ既定表示・提出済みはトグル格納
   - popup に「週間カレンダーで見る」導線（`?focus=calendar` でスクロール）
2. **.ics 書き出し**
   - 締切あり課題を VEVENT 化（RFC5545・75オクテット折返しはマルチバイト安全・VALARM なし＝本体通知と重複させない）
   - 完全ローカル生成（`downloads` 権限も不要・アンカー download 属性）。スナップショットであり自動同期しない旨を UI に明記
3. **「+」クイック追加バッジの対象拡張**（content script はセレクタ配列の拡張のみ・新規UI注入なし）
   - 7型 → 20型（lti / lesson / workshop / feedback / choice / questionnaire / h5pactivity / scorm / survey / glossary / wiki / book / data を追加）
4. **手動追加機能の発見性改善**（フィードバック②③が既存機能を知らずに要望していた対策）
   - welcome.html に⑤「知っておくと便利」節（手動追加・締切設定・カレンダー）
   - changelog.html を v1.4.0 版へ（「おさらい」節で手動追加を再紹介）
   - dashboard ヘッダーに手動追加の1文
5. **dashboard レイアウト刷新（拡張内のみ・LETUS 側無関係）**
   - 本文幅 1040→1400px・課題カードのマルチカラム化・サマリータイル→各セクションへのジャンプ・ブロック間隔拡大・ヘッダー説明文の改行修正
6. **セキュリティ（同梱・v1.3.0 公開後に develop へ入った分）**
   - コース名 stored XSS 経路の遮断（`b3ca098`）: courseDetector の検出面を isDashboardPath に限定＋letusLinks の same-host フィルタ。ストア配布が拡張本体へこの修正を届ける唯一の経路

## 0. 申請前チェック（機械的検証・2026-07-24）

- [x] `npx vitest run`（bare）→ **53 files / 706 passed / 0 FAIL**（v1.3.0 の 675 → +31）
- [x] `pnpm build`（tsc -b 込み）→ 成功（content script 自己完結 assert 通過）
- [x] `npx eslint src` → エラー0（既存 exhaustive-deps warning 4件のみ・不変）
- [x] `dist/content.js` / `dist/classTimetable.js` に `import` 文なし（grep 0件）
- [x] `dist/manifest.json` の `version` = **1.4.0**、`host_permissions` は `letus.ed.tus.ac.jp` / `class.admin.tus.ac.jp` の2つのみ（**新規ホスト・新規権限なし**）
- [x] zip 内パスに backslash なし（Python zipfile 生成・検証済み）
- [x] develop へ fold 済み（`75a46d6`・マージ後 706 緑を再検証・landing 無変更）
- [x] 実機確認済み（2026-07-24・開発版 dist をユーザーが実 LETUS データで操作確認: カレンダー表示/週ナビ/ICS/＋締切/クリア/非表示/✎編集/格納トグル/レイアウト）

## 1. ストア掲載文の更新（提出時）

- 「新機能」欄: 週間カレンダー・.ics 書き出し・手動追加の入口拡大（+バッジ20型）
- データセーフティ/権限の申告変更: **なし**（収集項目・送信先・権限とも v1.3.0 から不変）

## 2. 公開後タスク

- [ ] LP（lms.waiteu.dev）の v1.4.0 追随 → LP管理セッション `64ddfa22` へ引き継ぎ（ヒーローピル版数・changelog エントリ・手動追加の機能紹介明記）
- [ ] Edge: v1.2.1 通過後、間を置かず **v1.4.0 を直接申請**（1.3.0 を挟む必要なし）。同時に Partner Center の Privacy Policy URL を `https://lms.waiteu.dev/privacy` へ差し替え（現在404・ユーザー操作）
- [ ] フィードバックフォーム回答者への返信（任意・ユーザー操作）
