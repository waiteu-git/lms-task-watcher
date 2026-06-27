# LMS Task Watcher

LETUSをはじめとするLMS（学習管理システム）の課題を監視するChrome拡張機能です。締切が近い課題を通知し、ダッシュボードで一覧管理できます。

## 機能

- 課題の自動スキャンと締切検出
- 締切1時間前・3時間前の通知
- ポップアップとダッシュボードでの課題一覧表示
- 課題の非表示・復元
- 対象コースの選択管理

## 対応LMS

- LETUS
- Moodle
- manaba
- WebClass

## 開発

```bash
pnpm install
pnpm build
```

ビルド後、`dist` フォルダをChrome拡張機能として読み込んでください（`chrome://extensions` → デベロッパーモード → パッケージ化されていない拡張機能を読み込む）。

### 開発用コマンド

```bash
pnpm dev      # 開発サーバー起動
pnpm build    # 本番ビルド
pnpm lint     # ESLintによるコード検査
```
