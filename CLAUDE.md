## 回答スタイル

- 挨拶・前置き・段階報告・絵文字禁止。結論ファースト
- 指摘すべきことは率直に指摘

## ブランチ管理

- ブランチを切る前に `main` ブランチで `git pull origin main` を実行して最新化する
- プッシュはユーザーが明示的に指示した時のみ実行する
- 作業中にマージ済みのローカルブランチを見つけた場合、削除を提案する

## プロジェクト概要

LETUS（東京理科大学LMS、Moodle基盤）の課題期限を自動収集・通知するChrome拡張機能。
目標はChrome Web Storeへの公開。

### 技術スタック

- Popup/Dashboard: React 19 + TypeScript + Vite（`src/`以下）
- Background Service Worker: `public/background.js`（バニラJS、Viteでバンドルされず`dist/`にコピーされる）
- ストレージ: `chrome.storage.local`
- ビルド: `pnpm build` → `dist/` を拡張機能としてロード

### アーキテクチャ上の重要な制約

- `background.js` はTypeScriptではなくバニラJSで書かれており、Viteでトランスパイルされない
- Content scriptは現時点で存在しない（コース登録フローが未実装）
- アイコンはSVGのみ存在し、manifest.jsonが参照するPNG（`icons/icon-*.png`）が欠落している

## コード説明のルール

### 指摘対応時
指摘内容の説明と妥当性の評価を行い、変更前の問題点・変更内容・変更後のコードの意図と内容を説明する。

### コード変更時
変更前と変更後で何が変わるのか、それぞれのコードの意図と内容を説明する。

### 新規コード作成時
コードがない状態とある状態で何が変わるのか（何の問題を解決するか）、コードの意図と内容を説明する。

## background.jsの修正ルール

`public/background.js` を変更する場合：
- バニラJSのまま維持する（TypeScript化はTASKS.mdに別タスクとして記載済み）
- 変更後は `dist/background.js` にも同じ内容をコピーする（ビルドせずに動作確認したい場合）
- 既知のバグを修正する際は TASKS.md の対応タスクを完了済みにマークする
