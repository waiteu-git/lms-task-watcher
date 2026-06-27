# LETUS Task Watcher — フェーズ3 モバイルアプリ 設計書

作成日: 2026-06-28

---

## 概要

フェーズ2で構築するラズパイ4バックエンドを土台に、iOS/Android両対応のReact Nativeアプリ（Expo）を追加する。

**目的:** スマホから課題一覧の閲覧・優先度/メモの編集・プッシュ通知受信をできるようにする。

**方針:** UX優先。ベースはExpoマネージドワークフロー。ネイティブ機能が必要になった場合のみベアへ移行。

---

## セクション1: 全体アーキテクチャ

```
[Chrome拡張機能]
  └── 課題データをスキャン → ラズパイAPIに同期 (HTTPS / Cloudflare Tunnel)
        ↕
[ラズパイ4 — Node.js APIサーバー]（フェーズ2から継続）
  ├── ユーザー認証 / JWT（既存）
  ├── サブスク状態 / Stripe（既存）
  ├── 課題データ保存（新規: SQLiteにテーブル追加）
  ├── 優先度・メモ保存（新規）
  └── Expo Push Notification API呼び出し（新規）
        ↕
[Expo Push Notification Service]（無料・件数制限なし）
  ├── APNs → iPhone
  └── FCM → Android
        ↕
[React Nativeアプリ（Expo マネージド）]
  ├── 課題一覧表示
  ├── 優先度・メモ編集
  └── プッシュ通知受信
```

---

## セクション2: データ同期フロー

Chrome拡張がスキャンした課題データをバックエンド経由でモバイルに届ける。

| ステップ | 処理 |
|--------|------|
| 1 | Chrome拡張がスキャン完了時に `POST /api/assignments/sync` を呼ぶ（JWTヘッダー付き） |
| 2 | バックエンドがユーザーIDひも付きでSQLiteにupsert |
| 3 | モバイルアプリが `GET /api/assignments` でデータ取得・表示 |
| 4 | モバイルから `PATCH /api/assignments/:id` で優先度・メモを更新 |
| 5 | Chrome拡張は次回起動時にバックエンドから最新データを取得（逆同期） |

**オフライン:** モバイルはローカルキャッシュを保持し、オフライン時はキャッシュを表示する。

---

## セクション3: プッシュ通知フロー

1. アプリ初回起動時に `expo-notifications` でデバイストークンを取得
2. トークンを `POST /api/devices/token` でバックエンドに登録（ユーザーIDに紐付け）
3. Chrome拡張の background.js が締め切り検知時に `POST /api/notifications/push` を呼ぶ
4. バックエンドが Expo Push API（`https://exp.host/--/api/v2/push/send`）にリクエスト
5. Expo Push Service → APNs/FCM → デバイスに配信

**通知トリガー:** 締め切り24時間前・1時間前（拡張機能の既存通知ロジックと連動）

---

## セクション4: モバイルアプリ 画面構成

| 画面 | 内容 |
|------|------|
| ログイン画面 | メール + パスワード（フェーズ2と同じJWT認証） |
| 課題一覧画面 | 科目ごとにグルーピング、締め切り順ソート |
| 課題詳細画面 | 優先度設定（高/中/低）、メモ入力、締め切り表示 |
| 設定画面 | 通知オン/オフ、ログアウト |

**プレミアム制限:** 優先度・メモ編集はサブスク検証が必要（フェーズ2のStripe連携を再利用）。

---

## セクション5: 必要アカウント・費用

| 項目 | 費用 | 備考 |
|------|------|------|
| Apple Developer Program | $99/年（約15,000円） | iOS App Store配布に必要 |
| Google Play Developer | $25（一時費用） | Android Play Store配布に必要 |
| Expo EAS Build | 無料枠あり | ビルド月30回まで無料 |
| Expo Push Notifications | 無料 | 件数制限なし |

---

## セクション6: フェーズ2 APIへの追加エンドポイント

フェーズ3着手時にフェーズ2のAPIサーバーに追加する。

| メソッド | パス | 用途 |
|---------|------|------|
| POST | `/api/assignments/sync` | Chrome拡張からの課題一括同期 |
| GET | `/api/assignments` | モバイル用課題一覧取得 |
| PATCH | `/api/assignments/:id` | 優先度・メモ更新 |
| POST | `/api/devices/token` | Expoプッシュトークン登録 |
| POST | `/api/notifications/push` | プッシュ通知送信トリガー |

フェーズ2のJWT認証・Stripeサブスク判定をそのまま再利用する。

---

## セクション7: PWAフォールバック方針

UX上の問題（審査遅延・インストール障壁）が顕在化した場合のみPWAを検討する。

- iOS SafariのWebプッシュはiOS 16.4以降限定で体験が不安定
- 基本方針はExpoネイティブを維持し、PWAはバックアップ選択肢として記録に留める
