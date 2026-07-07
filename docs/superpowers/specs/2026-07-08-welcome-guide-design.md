# インストール時ウェルカムガイド 設計書

日付: 2026-07-08
対象ブランチ: develop(v1.2.0系)

## 目的

新規インストール直後のユーザーに「拡張機能のツールバー固定方法」と「LETUS Task Watcher の使い始め方」を周知する。固定していないユーザーはポップアップを開かないため、既存の OnboardingBanner(ポップアップ内)では届かない層に、タブで開く専用ページとして案内する。

既存ユーザーもこの案内を見ていないため、次回アップデート時に一度だけ全員に表示する。それ以降のアップデートでは表示せず、新規インストール時のみ表示する。

## 要件

1. 新規インストール時(`onInstalled` の `reason === 'install'`)に welcome.html をタブで開く
2. アップデート時(`reason === 'update'`)は、ガイド未表示のユーザーにのみ welcome.html を開き、表示済みのユーザーには従来どおり changelog.html を開く
3. 表示済みかどうかは `chrome.storage.local` のフラグで判定する
4. Chrome / Edge で固定手順の文言を出し分ける

## 変更内容

### 1. 新規: `public/welcome.html` + `public/welcome.js`

- changelog.html と同じ自己完結の静的ページスタイル(`public/` 配下、ビルド時にそのまま `dist/` へコピー)
- MV3 拡張ページの CSP はインラインスクリプト不可のため、スクリプトは `welcome.js` に分離(changelog.js と同じ方式)

ページ構成(上から):

1. **ツールバーに固定しよう** — `welcome.js` が `navigator.userAgent.includes('Edg/')` で Edge を判定し、Chrome / Edge の手順を出し分ける。🧩パズルピース→📌ピンの流れを CSS/SVG の簡易イラストで表現(スクリーンショット画像は同梱しない)
2. **使い始めの3ステップ** — ①LETUS を開く(コースページを開くと自動登録)②ダッシュボードで追跡するコースを選択 ③「今すぐ更新」で課題を取得。OnboardingBanner と同じ流れのページ版
3. **通知の仕組み** — 期限が近づくと自動で通知される旨の一言説明
4. **リタス(Litus)事前登録導線** — https://lms.waiteu.dev/app へのリンク(CLAUDE.md の changelog ルールに準拠)
5. **更新内容はこちら** — changelog.html へのリンク(アップデートで開かれた既存ユーザー向け導線)

### 2. 変更: `src/background/storageKeys.ts`

`WELCOME_GUIDE_SHOWN_KEY = 'welcomeGuideShown'` を追加。

### 3. 変更: `src/background/index.ts` の `onInstalled` リスナー

現行:

- `update` → changelog.html を開く
- `install` → 何も開かない

変更後:

- `install` → welcome.html を開き、`welcomeGuideShown: true` を保存
- `update` かつフラグ未保存 → welcome.html を開き、フラグを保存(changelog はページ内リンクから)
- `update` かつフラグ保存済み → changelog.html を開く(従来どおり)

アラーム作成(`chrome.alarms.create`)は従来どおり無条件で実行する。

## テスト

`src/background/index.test.ts` に既存の chrome モックパターンを流用して追加:

1. `install` → welcome.html が開かれ、フラグが保存される
2. `update` + フラグ未保存 → welcome.html が開かれ、フラグが保存される(changelog は開かれない)
3. `update` + フラグ保存済み → changelog.html が開かれる(welcome は開かれない)

## やらないこと

- ポップアップ側 OnboardingBanner の変更
- スクリーンショット画像の同梱
- 多言語対応(changelog.html 同様、日本語のみ)
- welcome.html の再表示 UI(設定画面からの再閲覧導線などは必要になったら別タスク)
