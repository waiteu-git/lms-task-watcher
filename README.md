# LMS Task Watcher

LETUSをはじめとするLMS（学習管理システム）の課題を監視するChrome拡張機能です。締切が近い課題を通知し、ダッシュボードで一覧管理できます。

- **公式サイト**: https://lms.waiteu.dev/
- **Chrome Web Store**: https://chromewebstore.google.com/detail/letus-task-watcher/eofgkmpiadoeckkliialkddacidcinml
- **Microsoft Edge Add-ons**: https://microsoftedge.microsoft.com/addons/detail/femdjgdgelnbdpgnfehacobmpbfmbdoa

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

## ライセンス

本リポジトリは、ユーザーが拡張機能の動作（収集するデータや送信先）を自ら確認できるようにするため、ソースコードを公開しています（source-available）。**オープンソースソフトウェアではありません。**

閲覧・監査、および動作確認目的での自身の環境でのビルド・実行のみ許可しています。コードの複製・他ソフトウェアへの転用・再配布（ストアへの公開を含む）・商用利用は禁止です。詳細は [LICENSE](LICENSE) を参照してください。
