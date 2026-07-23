## 回答スタイル

- 挨拶・前置き・段階報告・絵文字禁止。結論ファースト
- 指摘すべきことは率直に指摘

## ブランチ管理

- ブランチを切る前に `main` ブランチで `git pull origin main` を実行して最新化する
- 機能を壊していないことを確認したうえで、正常なコミットは適宜pushする
- 作業中にマージ済みのローカルブランチを見つけた場合、削除を提案する

## プロジェクト概要

LETUS（東京理科大学LMS、Moodle基盤）の課題期限を自動収集・通知するChrome拡張機能。
目標はChrome Web Storeへの公開。

### 技術スタック

- Popup/Dashboard: React 19 + TypeScript + Vite（`src/`以下）
- Background Service Worker: `src/background/index.ts`（TypeScript）。Viteのrollup入力としてバンドルされ `dist/background.js`（ESモジュール）として出力される。manifestは `"service_worker": "background.js", "type": "module"` で参照
- Content script: `src/content/courseDetector.ts` → `content.js`（LETUS）、`src/content/classTimetable.ts` → `classTimetable.js`（CLASS）。いずれもViteでバンドルされmanifestの `content_scripts` に登録済み
- ストレージ: `chrome.storage.local`
- ビルド: `pnpm build` → `dist/` を拡張機能としてロード

### アーキテクチャ上の重要な制約

- background・content・popup はすべてTypeScriptで、`pnpm build`（`tsc -b && vite build`）でバンドルされる。手書きの `dist/` ファイルを直接編集しない
- アイコンPNG（`icons/icon-16/32/48/128.png`）は `public/icons/` に存在し、manifestから参照されている

## changelogのルール

- 以降のchangelog（`public/changelog.html`）には、モバイルアプリ「リタス（Litus）」関連の情報（開発状況・事前登録導線 https://lms.waiteu.dev/app ）を掲載する

## コード説明のルール

### 指摘対応時
指摘内容の説明と妥当性の評価を行い、変更前の問題点・変更内容・変更後のコードの意図と内容を説明する。

### コード変更時
変更前と変更後で何が変わるのか、それぞれのコードの意図と内容を説明する。

### 新規コード作成時
コードがない状態とある状態で何が変わるのか（何の問題を解決するか）、コードの意図と内容を説明する。

## background（Service Worker）の修正ルール

Service Worker本体は `src/background/index.ts`（TypeScript）。純ロジックは `src/core/`・`src/background/` 配下のモジュールに切り出し、Vitestで単体テストする（`pnpm vitest run src`）。
- `dist/background.js` は `pnpm build` の生成物。直接編集せず、必ずソースを変更してビルドし直す
- 既知のバグを修正する際は TASKS.md の対応タスクを完了済みにマークする
