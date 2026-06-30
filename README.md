# LETUS Task Watcher

東京理科大学のLMS（LETUS）の課題期限を自動収集・通知するChrome拡張機能です。

## 機能

- 課題の自動スキャンと締切検出
- 締切前の通知（Chrome通知）
- ポップアップとダッシュボードでの課題一覧表示
- 課題の非表示・復元
- 対象コースの選択管理

## 対応環境

- LETUS（`letus.ed.tus.ac.jp`）

## 開発

```bash
pnpm install
pnpm build
```

ビルド後、`dist` フォルダをChrome拡張機能として読み込んでください（`chrome://extensions` → デベロッパーモード → パッケージ化されていない拡張機能を読み込む）。

### 開発用コマンド

```bash
pnpm dev        # 開発サーバー起動
pnpm build      # 本番ビルド（dist/）
pnpm build:dev  # 開発ビルド（dist-dev/、拡張機能名に[開発版]付与）
pnpm lint       # ESLintによるコード検査
```
