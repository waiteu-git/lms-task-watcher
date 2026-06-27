# Chrome Web Store 掲載情報

## Short description（manifest.json / ストア概要欄 — 132文字以内）

```
Never miss a LETUS assignment deadline. Automatically scans your courses and shows upcoming due dates with browser notifications.
```
128文字 ✓

## Long description（ストア詳細説明 — 16,000文字以内）

```
LETUS Task Watcher helps students at Tokyo University of Science stay on top of assignment deadlines on LETUS, the university's learning management system.

— WHAT IT DOES —

• Scans all your registered LETUS courses and collects assignment links automatically
• Reads each assignment page to extract the deadline date and submission status
• Displays upcoming deadlines grouped by urgency: within 24 hours, tomorrow, this week, and later
• Sends browser notifications 3 hours and 1 hour before each deadline (once per assignment)
• Automatically re-scans when data is more than 2 hours old

— HOW TO USE —

1. Log in to LETUS in your browser as usual
2. Click the extension icon to open the popup
3. Open the Dashboard and select the courses you want to track
4. Click "今すぐ更新" (Update now) to start scanning
5. Deadlines will appear sorted by urgency

— PRIVACY —

• Your login credentials are never read or stored
• All data stays in your browser (chrome.storage.local) and is never sent to any server
• You can delete all stored data at any time from the Dashboard → Data Management

— PERMISSIONS —

• storage: Save assignment data in your browser
• notifications: Show deadline reminders
• https://letus.ed.tus.ac.jp/*: Fetch your course and assignment pages using your existing login session

This extension is an independent student project and is not affiliated with Tokyo University of Science or the LETUS platform.
```

## スクリーンショット撮影ガイド

Chrome Web Storeの要件: 最低1枚、推奨サイズ 1280×800 または 640×400（PNG/JPEG）

撮影すべき画面:

1. **ポップアップ（課題あり状態）** — 24時間以内の課題が1〜2件ある状態で撮影
2. **ダッシュボード全体** — 複数セクションに課題が並んでいる状態
3. **ダッシュボード（コース選択）** — コース選択欄が開いた状態

撮影手順:
1. `dist/` フォルダを Chrome の「パッケージ化されていない拡張機能を読み込む」でロード
2. LETUSにログインした状態で「今すぐ更新」を実行し課題を取得
3. ポップアップは右クリック → 「検証」で DevTools を開き、デバイスモードで固定サイズ撮影
4. ダッシュボードはブラウザ全画面（1280×800）でスクリーンショット

## プロモーション画像

サイズ: 440×280px（任意）
→ `store-promo.png` として生成済み（下記スクリプトで作成）

## Googleアカウント・ストア登録時の入力値

| 項目 | 値 |
|------|----|
| 拡張機能名 | LETUS Task Watcher |
| カテゴリ | Productivity |
| 言語 | Japanese（主）/ English（説明文） |
| プライバシーポリシーURL | GitHubリポジトリの `privacy-policy.md` の raw URL または GitHub Pages URL |
| host_permissions の理由 | LETUSのコースページと課題ページをユーザーのログインセッションを使ってfetchし、課題情報を抽出するため |
