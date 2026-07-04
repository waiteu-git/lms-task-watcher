# カスタム通知ルール 設計

## 背景

Phase B②（付加価値機能）として、締切通知のタイミングをサブスクライバーが個別カスタマイズできる機能を追加する。

現状の通知（`src/background/index.ts` の `checkDeadlineWarningNotifications`）は、自動スキャン（アラーム間隔）ごとに全未提出課題を走査し、**締切前 1h / 3h / 24h の固定しきい値**で通知する。しきい値は `ONE_HOUR_MS` 等のハードコード定数。重複通知は `NOTIFIED_DEADLINE_KEYS`（`{id}:1h` 等のキー）で防止。スキャン課題と手動課題の両方が対象で、無視/提出済み/期限切れは除外。

この固定しきい値を、サブスクライバーが自分でカスタマイズできるようにするのが本機能の核。

## スコープ

- **全体デフォルトのしきい値セット** ＋ **コース別上書き**（そのコース用の別しきい値セット、または**ミュート**）
- サブスクライバー向け有料機能。無料/失効ユーザーは従来の固定 1h/3h/24h
- UIは拡張機能のダッシュボード内（テーマ切替と同じ設定領域）。`PremiumGate`でロック＋アップセル
- 通知ルールはクロスデバイス同期（push＋pull、last-write-wins）

### スコープ外（YAGNI / 別フェーズ）

- **通知しない時間帯（クワイエットアワー）**: 締切警告は時間に敏感で、重要通知を握り潰すリスクがあるため入れない
- **手動課題リスト自体のクロスデバイス共有**: モバイルアプリ実装フェーズ（v2.0.0）で対応。本機能では手動課題は各デバイスローカルのまま
- **しきい値の自由数値入力**: まずはプリセットからの選択のみ
- **テーマのクロスデバイス同期**: テーマは各デバイスで独立に変更できるべきなので、本機能の pull 対象にしない（同期するのは通知ルールのみ）
- **優先度別のタイミング設定**: 今回はコース別まで

## データモデル

通知ルールを1つのJSONオブジェクトで表現する。

```ts
type NotificationRules = {
  version: 1
  defaultThresholds: number[]        // 締切前「時間」の配列。既定 [1, 3, 24]
  courseOverrides: {
    [courseId: string]: {
      muted: boolean                 // true ならそのコースは通知しない
      thresholds: number[]           // muted=false の時に使う。空配列も可（= 通知しない）
    }
  }
}
```

- しきい値は「締切前◯時間」の数値配列。背景ワーカーがミリ秒換算する
- `courseOverrides[courseId]` が存在するコースは、`muted` ならスキップ、そうでなければ `thresholds` を全体デフォルトの代わりに使う。存在しないコースは `defaultThresholds`
- ルール未設定（無料ユーザー等）は、オブジェクト自体が無い → 背景は固定 `[1, 3, 24]` で動く（＝現行と同一挙動）

## 通知発火ロジック

各未提出課題（スキャン課題・手動課題とも）について、締切までの残差 `diff` に対し、適用しきい値を昇順で見て「`diff <= しきい値` かつ 未通知」の最小しきい値を1つ通知する。現行の 1h/3h/24h の else-if 連鎖を任意しきい値に一般化したもの。重複防止キーは現行の `{id}:{N}h` 形式を踏襲（N は任意時間）。

コースをミュート＝そのコースの課題を通知対象から除外、として自然に表現できる。

**手動課題の扱い:** 手動課題も `courseId`・`courseName` を持つ（`ManualAssignment` 型、コース選択必須）。したがってスキャン課題と完全に同じ扱いでコース別上書き/ミュートが効く。特別扱いはしない。`checkDeadlineWarningNotifications` 内の通知ターゲット型に `courseId` を含める（現状は `courseName` のみ）。

## アーキテクチャ

### 純粋関数モジュール `src/background/notificationRules.ts`（新設）

テスト容易性のため、締切パーサ（`deadlineParser.ts`）の前例に倣いロジックを純粋関数へ切り出す。

```ts
export const DEFAULT_THRESHOLDS = [1, 3, 24]  // 時間

// コースに適用するしきい値を解決。muted なら null（= 通知しない）
export function resolveThresholds(
  rules: NotificationRules | null,
  courseId: string,
  subscriptionActive: boolean,
): number[] | null

// 残差(ms)に対し発火すべき最小の未通知しきい値を返す（無ければ null）
export function pickThresholdToNotify(
  diffMs: number,
  thresholds: number[],
  targetId: string,
  notifiedKeys: Set<string>,
): { thresholdHours: number; notifyKey: string } | null
```

**`resolveThresholds` の分岐:**
- `subscriptionActive === false` → 常に `DEFAULT_THRESHOLDS`（失効/無料は固定。プレミアム機能は契約中のみ有効）
- active かつ `rules` あり → `courseOverrides[courseId]` があれば `muted` なら `null`、else その `thresholds`。無ければ `rules.defaultThresholds`
- active だが `rules` 無し → `DEFAULT_THRESHOLDS`

### `checkDeadlineWarningNotifications` の改修

- 冒頭で `getNotificationRules()`（storage）と `isSubscriptionActive()`（キャッシュ）を取得
- 通知ターゲット型に `courseId` を追加（スキャン課題・手動課題とも）
- 各課題ループで `resolveThresholds(rules, courseId, active)` → `null` ならスキップ（ミュート）、else `pickThresholdToNotify(diff, thresholds, id, notifiedSet)` で最大1件通知
- 通知キーは現行 `{id}:{N}h` を踏襲

## ストレージ＆同期

### ローカル（権威）

- `chrome.storage.local` の新キー `notificationRules` に JSON を保存
- 併せて `notificationRulesUpdatedAt`（ISO）を保存し、編集のたびに更新
- ダッシュボードUIが編集、背景ワーカーが読む

### サーバー

- `user_settings` に `notification_rules TEXT`（JSON文字列、nullable）と `notification_rules_updated_at TEXT`（ISO、nullable）カラムを追加
- `POST /api/user/settings` を拡張して `notificationRules` も受理。**`notificationRules` が本文に含まれる時だけ** `notification_rules` と `notification_rules_updated_at`（= `datetime('now')`）を更新する。`GET /api/user/settings` は `theme`・`notificationRules`・`notificationRulesUpdatedAt` を返す
- `syncToServer`（`src/core/premium.ts`）の settings POST body に `notificationRules` を追加

**専用タイムスタンプの理由:** `user_settings.updated_at` は単一カラムで theme 更新でも動く。テーマはデバイスローカルだが現状サーバーへ push されるため、`updated_at` を LWW に使うと「テーマ変更が rules のタイムスタンプを押し上げ、別デバイスの新しいローカル rules を古いサーバー rules で誤クロバーする」不整合が起きる。これを避けるため rules 専用の `notification_rules_updated_at` を rules 変更時のみ更新し、LWW はこれで判定する（テーマの push 挙動は不変）。

### 同期方向（push＋pull、last-write-wins）

同期対象は **notificationRules のみ**（テーマは各デバイスローカルのまま、pull しない）。

- **push**: ルール編集時に ローカル `notificationRulesUpdatedAt` を更新し `syncToServer` で POST（サーバーは受信時に `notification_rules_updated_at` を自前で更新）
- **pull発火**: ①ログイン成功時 ②ダッシュボード起動時（ログイン済みなら）
- **適用条件**: `GET /api/user/settings` の `notificationRulesUpdatedAt`（サーバー `notification_rules_updated_at`）が ローカル `notificationRulesUpdatedAt` より新しい（またはローカル未設定）なら、サーバーの `notificationRules` をローカルへ反映。そうでなければローカル保持
- これにより、別デバイスの編集がダッシュボード起動時に反映され、オフラインのローカル編集は（ローカルが新しいので）クロバーされない。単一ユーザー設定なので last-write-wins で十分

## UI（ダッシュボード）

- **場所:** ダッシュボードの設定エリア（テーマ切替と同じ領域）に「通知タイミング」セクションを追加。`PremiumGate` でラップし、非サブスクライバーにはロック＋アップセル（既存 `PremiumGate`/`ProBanner` パターン）
- **全体デフォルト:** しきい値チップ列。プリセット（1・3・6・12・24・48・72時間）から追加/削除するトグル式。空も許容（＝全体で通知しない）
- **コース別上書き:** 検出済みコース一覧。各行に「上書き」トグル
  - OFF（既定）: 全体デフォルトに従う
  - ON: そのコース用のしきい値チップ列 ＋「ミュート」トグル
- **変更時:** `notificationRules` ＋ `notificationRulesUpdatedAt` を更新し `syncToServer` で push
- **空状態:** コース未検出なら「LETUSのコースを開くと表示されます」

## テスト方針

- **純粋関数 `notificationRules.ts`（vitest）:**
  - `resolveThresholds`: 非active→デフォルト / active＋ルール無し→デフォルト / active＋上書き(thresholds)→その値 / active＋ミュート→null / active＋当該コース上書き無し→デフォルト
  - `pickThresholdToNotify`: diff内の最小未通知しきい値を返す / 全通知済み・該当なし→null / 空配列→null
- **ストレージ getter/setter**（`getNotificationRules`/`saveNotificationRules`）: 既存 chrome-stub パターンで軽くテスト
- **API（`api/tests`、jest）:** `POST`/`GET /api/user/settings` の `notification_rules` ラウンドトリップ、`notificationRulesUpdatedAt` の返却、および「`notificationRules` を含まない POST（theme のみ）では `notification_rules_updated_at` が動かない」ことを検証
- **拡張機能同期（`premium.test.js`）:** `syncToServer` の settings POST に `notificationRules` が含まれること、pull（サーバーが新しければ反映、古ければ保持）を検証
- **対象外（既存方針踏襲）:** `checkDeadlineWarningNotifications` 本体（chrome API依存）は薄く保ち、実通知発火は手動確認。ロジックは純粋関数側で網羅

## 完了の定義

- サブスクライバーがダッシュボードで全体しきい値を編集でき、コース別に別しきい値/ミュートを設定できる
- 背景ワーカーが設定に従って通知する（未設定・失効・無料は固定 1h/3h/24h）
- 手動課題もコース別上書き/ミュートの対象になる
- 通知ルールがクロスデバイスで同期される（push＋pull、last-write-wins）。テーマは各デバイス独立のまま
- 純粋関数・API・同期の各テストが通る
