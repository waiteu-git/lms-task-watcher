# LETUS Task Watcher

東京理科大学のLMS（LETUS）の課題期限を自動収集・通知するブラウザ拡張機能です。

- **公式サイト**: https://lms.waiteu.dev/
- **Chrome Web Store**: https://chromewebstore.google.com/detail/letus-task-watcher/eofgkmpiadoeckkliialkddacidcinml
- **Microsoft Edge Add-ons**: https://microsoftedge.microsoft.com/addons/detail/femdjgdgelnbdpgnfehacobmpbfmbdoa

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

## ライセンス

本リポジトリは、ユーザーが拡張機能の動作（収集するデータや送信先）を自ら確認できるようにするため、ソースコードを公開しています（source-available）。**オープンソースソフトウェアではありません。**

閲覧・監査、および動作確認目的での自身の環境でのビルド・実行のみ許可しています。コードの複製・他ソフトウェアへの転用・再配布（ストアへの公開を含む）・商用利用は禁止です。詳細は [LICENSE](LICENSE) を参照してください。

Copyright © 2026 waiteu. All rights reserved.／本ライセンス適用日: **2026-07-04 (JST)**

### 個別許諾

本ライセンスの複製・改変・再配布の禁止条項にかかわらず、GitHub ユーザー haya9924 氏が開発するアプリ「cabetus」（github.com/haya9924/cabetus）に限り、複製・改変・再配布を許諾する。本許諾は上記の個人・アプリに対する個別の例外であり、本ライセンスの他の条項を変更するものではない。（許諾日: 2026-07-08）
