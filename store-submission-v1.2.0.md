# Chrome Web Store 申請チェックリスト — v1.2.0

アップロード用パッケージ: **`letus-task-watcher-1.2.0.zip`**（プロジェクト直下 / 205KB / 24ファイル）
manifest version: **1.2.0** ／ manifest v3 ／ 決済・外部サーバー通信なし（ローカル完結）

---

## 0. 申請前チェック

- [x] `pnpm build` 成功・`pnpm vitest run src` 607 passed
- [x] `dist/manifest.json` の host_permissions は `letus.ed.tus.ac.jp` と `class.admin.tus.ac.jp` の2つのみ（api.waiteu.dev なし）
- [x] パッケージから旧サブスク/決済資産（stripe・badge・product）を除去済み
- [x] `privacy-policy.md` を v1.2.0（CLASS・alarms・ローカル完結）に更新済み
- [ ] **プライバシーポリシーを公開URLでホスト**（下記§5）— これが未対応だと申請できません
- [ ] スクリーンショットを1枚以上用意（1280×800 推奨、下記§6）

---

## 1. パッケージ

1. Chrome ウェブストア デベロッパー ダッシュボード → 「新しいアイテム」
2. `letus-task-watcher-1.2.0.zip` をアップロード

---

## 2. ストアの掲載情報（Store listing タブ）

| 項目 | 値 |
|------|----|
| 拡張機能名 | LETUS Task Watcher |
| 概要（Summary, 132字以内） | LETUSの課題締切を自動収集し、ブラウザ通知でお知らせ。ダッシュボードで全課題を一覧管理できます。 |
| カテゴリ | Productivity（仕事効率化） |
| 言語 | 日本語 |
| アイコン | 128×128（パッケージ同梱 `icons/icon-128.png`）|

- **詳細説明**は `store-listing.md` の「Long description」をそのまま貼り付け（サブスク文言は除去済み）。

---

## 3. 単一用途（Single purpose）

```
東京理科大学のLMS「LETUS」の課題締切を自動で収集・通知し、履修システムCLASSの時間割と
ひも付けて一覧表示する、学生向けの課題管理ツールです。
```

English:
```
A single-purpose tool that collects and notifies assignment deadlines from Tokyo
University of Science's LMS (LETUS) and links them to the student's timetable from
the CLASS system, for personal assignment management.
```

---

## 4. 権限の理由（Permission justifications）

各欄にそのまま貼れる英文（審査は英語推奨）。日本語版は `store-listing.md` にあり。

| 項目 | Justification |
|------|---------------|
| `storage` | Stores collected assignment data, timetable, and user settings locally via chrome.storage.local. No data leaves the device. |
| `notifications` | Shows deadline reminders, scan-completion messages, and course-content update alerts. |
| `alarms` | Schedules the once-a-day automatic background scan for new/updated deadlines. |
| Host `https://letus.ed.tus.ac.jp/*` | Reads the user's own course and assignment pages, using their existing login session, to extract deadlines and submission status. |
| Host `https://class.admin.tus.ac.jp/*` | Reads the user's own CLASS timetable and syllabus pages to display the weekly timetable and link courses to assignments. |
| Remote code | **No.** All code is bundled in the package; the extension loads no remote/external scripts. |

---

## 5. プライバシー（Privacy タブ）

**プライバシーポリシーURL（必須）**: `privacy-policy.md` を公開URLで用意して貼る。候補:
- 個人サイト（推奨・memoに従い運用中）: 例 `https://lms.waiteu.dev/privacy.html`（Cloudflare Pages `waiteu-dev` に配置）
- または GitHub の raw / GitHub Pages URL

**データ利用（Data usage）の申告**:
- 収集して外部送信するユーザーデータ: **なし**（すべて端末内 `chrome.storage.local` に保存し、外部サーバーへ送信しない）
- 認証（3つのチェックボックス）にすべて同意可能:
  - [x] ユーザーデータを承認された用途以外に使用・転送しない
  - [x] ユーザーデータを第三者に販売しない
  - [x] 信用力の判断・融資目的で使用・転送しない

> 補足: 拡張は課題・時間割などの情報を「読み取る」が、端末外へ「収集（送信）」はしないため、Web Store の定義上は data collection なしに該当。ポリシー本文もその旨を明記済み。

---

## 6. スクリーンショット（最低1枚 / 1280×800 推奨）

拡張は既にロード済み（`chrome-extension://.../index.html#dashboard`）。撮るとよい画面:

1. **ポップアップ**（今日の時間割＋24時間以内の課題が見える状態）
2. **ダッシュボード**（サマリー＋週間時間割グリッド＋課題カード）
3. **ダッシュボード / 対象コースの選択**（コース一覧が開いた状態）

撮影メモ: ダークテーマの見栄えも良いので、標準・ダークどちらか映える方で。ポップアップは幅440pxのため、ダッシュボード（別タブ）中心が1280×800に収めやすい。

> 希望があれば、ロード済み拡張のダッシュボードをこちらで開いて所定サイズのスクリーンショットを撮ります。

---

## 7. 提出

Store listing / Privacy / パッケージ を保存 → 「審査に送信」。初回は数営業日かかることがあります。
