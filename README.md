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

## 貢献

バグ報告・改善提案・Pull Request を歓迎します。手順と取り決め（PR提出時の権利許諾を含む）は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。脆弱性の報告は公開Issueではなく、GitHubのプライベート脆弱性報告（Securityタブ）からお願いします。

**貢献目的の例外**: 本リポジトリは source-available で複製・再配布を原則禁止していますが、**貢献の準備・提出に必要な fork・改変・改変内容の公開（fork リポジトリと PR）は [LICENSE](LICENSE) の「■ 貢献」節で明示的に許可しています**。貢献者が規約違反になることはありません。なお、fork を配布手段として使うこと（ビルド済み成果物の配布を含む）は引き続き禁止です。

## ライセンス

本リポジトリは、ユーザーが拡張機能の動作（収集するデータや送信先）を自ら確認できるようにするため、ソースコードを公開しています（source-available）。**オープンソースソフトウェアではありません。**

閲覧・監査、および動作確認目的での自身の環境でのビルド・実行のみ許可しています。コードの複製・他ソフトウェアへの転用・再配布（ストアへの公開を含む）・商用利用は禁止です。詳細は [LICENSE](LICENSE) を参照してください。

Copyright © 2026 waiteu. All rights reserved.／本ライセンス適用日: **2026-07-04 (JST)**

本ソフトウェアはオープンソースではありません。ソースコードは、収集するデータの内容や送信先をユーザー自身が検証できるようにする透明性の確保を目的として公開しています。

閲覧・検証・自身の環境でのビルドと実行は許可されますが、複製・再配布・商用利用、および大学システムへの過度な負荷やスクレイピング乱用への転用は禁止です。詳細は [LICENSE](LICENSE) を参照してください。

本拡張の利用条件は [利用規約](docs/legal/terms-ja.md)（公開版: https://lms.waiteu.dev/terms ）に定めます。

### 個別許諾

本ライセンスの複製・改変・再配布の禁止条項にかかわらず、GitHub ユーザー haya9924 氏が開発するアプリ「cabetus」（github.com/haya9924/cabetus）に限り、複製・改変・再配布を許諾する。本許諾は上記の個人・アプリに対する個別の例外であり、本ライセンスの他の条項を変更するものではない。（許諾日: 2026-07-08）
