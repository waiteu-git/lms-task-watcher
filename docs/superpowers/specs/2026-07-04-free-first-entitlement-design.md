# 無料開放 entitlement 変更 設計

## 背景

上位方針 `2026-07-04-free-first-strategy-design.md`（無料開放ファースト）に従い、差別化軸を「データの管理場所（同期＝有料）」から「通知の質・快適装備（自動運転＝有料）」へ移す。収益の最大化変数はインストール数であり、入口（無料版の充実）を最大化して競合（Penmark 等の手動登録アプリ）を蹴散らすのが狙い。

現状、メモ・優先度が拡張機能ダッシュボードでサブスクライバー限定ゲートに掛かっている。これを外し、無料版を実用充分にする。

## 確定した無料/有料の線引き

| 有料（据え置き） | 無料（開放） |
|---|---|
| カスタム通知ルール | 課題へのメモ・優先度 |
| 限定 Discord コミュニティ | 手動課題の追加 |
| | 拡張↔サーバー同期（無料アカウント） |
| | テーマ（**有料→無料**、free-first 表を上書き） |
| | LETUS 登録済みインジケーター |

- ユーザー判断でテーマも無料化する（free-first 戦略書の「テーマ＝有料」を上書き。戦略書側も更新する）。
- 現状の有料機能はカスタム通知ルールと Discord の 2 つに集約される。将来の看板有料機能（見張り番プッシュ等）は v2.0.0 モバイル。

## 現状のゲーティング棚卸し（実装前調査の結果）

- **メモ・優先度**: `src/components/AssignmentMemo.tsx` の `isSubscriber` プロップで実ゲート。非サブスクは「メモ・優先度はサブスクライバー限定機能です」のロック表示、popup モードでは `popup && !isSubscriber` で非表示。これが唯一の実ゲート。
- **手動課題**: content script のウィジェット（`src/content/manualTaskWidget.ts`）にゲートは無く、既に機能的に無料。ダッシュボードの「利用可能な機能」リストで“プレミアム”として掲示されているだけ。
- **同期**: `src/core/premium.ts` の `syncToServer` は `getAuthToken()`（ログイン）のみで判定しサブスク非依存。API 側 `api/routes/user.js` の `/data`・`/settings` も `requireAuth` のみ。**無料アカウントで既に同期可能**。メモゲートを外せば無料ユーザーのデータが実際に同期される。
- **テーマ**: `src/App.tsx` のサブスク限定ブロック（`isSubscriber ? (...)`）内のテーマセレクタ。ローカル保存（`saveTheme`）でアカウント不要。
- **`PremiumGate.tsx`**: 定義のみで未使用（どこからも import されていないデッドコード）。
- **カスタム通知ルール**: 背景ワーカーは `isSubscriptionActive` でゲート、UI はサブスク限定ブロック内。**有料据え置き**。
- **Discord**: mypage 側。**有料据え置き**。

## 変更内容

### 拡張機能（`src/`）

1. **`src/components/AssignmentMemo.tsx`**: `isSubscriber` によるゲートを撤去し、メモ・優先度を常時編集可にする。ロック表示（`.memoLocked`・🔒・「サブスクライバー限定機能です」）と `popup && !isSubscriber → null` を削除。`isSubscriber` プロップを型・引数から削除。
2. **`src/components/ManualAssignmentCard.tsx`**: `isSubscriber` によるメモ表示分岐（`assignment.memo && !isSubscriber && ...`）を撤去し、常に同じ表示にする。`isSubscriber` プロップを削除。
3. **`src/App.tsx`**:
   - `AssignmentMemo` および `ManualAssignmentCard` への `isSubscriber` 受け渡し（全呼び出し箇所）を削除。
   - テーマセレクタをサブスク限定ブロックの外へ移動し、**常時表示の「表示設定」ブロック**（全ユーザーが見える設定領域）に置く。
   - サブスク限定ブロック内の「利用可能な機能」リストを新線引きに更新（有料＝カスタム通知ルール・限定 Discord のみ）。テーマ移動後、限定ブロックにはアカウント情報・カスタム通知ルール UI・ログアウトが残る。
4. **`src/components/ProBanner.tsx`**: `FEATURES` を更新。有料＝`カスタム通知ルール（科目別の締切通知タイミング）`・`限定 Discord コミュニティ招待` のみ。メモ・優先度／同期／手動課題／テーマを削除。「快適装備＋開発支援」文面（既存 `.proSupportNote`）は維持。
5. **`src/components/PremiumGate.tsx`（および対応テストがあれば）を削除**（未使用デッドコード）。`isSubscriptionActive` 等の import 元は他が使うため残す。

### ドキュメント

6. **`docs/superpowers/specs/2026-07-04-free-first-strategy-design.md`** のテーマ行（§2 機能全般の表、テーマ＝サブスク）を「無料」に更新し、整合を取る。

### 変えないもの

- 同期インフラ（`syncToServer`・`/data`・`/settings`）— 既に無料アカウント対応済み。**API・バックエンド変更なし＝ラズパイデプロイ不要**。
- 手動課題ウィジェット — 既にゲートなし。
- カスタム通知ルール（背景 `isSubscriptionActive` ゲート・UI）— 有料据え置き。
- Discord（mypage）— 有料据え置き。
- 認証・サブスク判定（`isSubscriptionActive` 等）— 通知ルール・Discord がまだ使うため残す。

## テスト方針

- **`src/components/AssignmentMemo.test.tsx`（存在すれば）**: 非サブスクのロック表示を検証していたケースを削除／「サブスクなしでメモ・優先度が編集可能（ロック表示が出ない）」の検証に置き換える。
- `isSubscriber` プロップを渡していた既存テスト（`AssignmentMemo`・`ManualAssignmentCard` 呼び出し）を新シグネチャに更新。
- `PremiumGate` のテストがあれば削除。
- `pnpm exec tsc -b`・`pnpm build`・`pnpm exec vitest run src` が全緑。
- バックエンド変更が無いため `api` テストは対象外（変わらず 61/61 のまま）。

## 完了の定義

- 非サブスク（ログイン有無問わず）でメモ・優先度が編集でき、ロック表示が出ない。
- テーマが全ユーザーで切替可能（常時表示の表示設定ブロック）。
- 有料の掲示（ProBanner・機能リスト）がカスタム通知ルール・Discord のみになっている。
- 未使用 `PremiumGate` が削除されている。
- カスタム通知ルール・Discord のゲートは維持されている（無料化しない）。
- `tsc`・`build`・`vitest run src` 全緑。バックエンド変更なし。
