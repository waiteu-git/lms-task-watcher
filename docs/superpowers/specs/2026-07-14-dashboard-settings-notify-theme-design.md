# 設計: ダッシュボード設定の再配置＋通知ミュート実効化＋テーマ自動

- 日付: 2026-07-14
- ブランチ: `feature/dashboard-settings-notify-theme`（develop分岐）

## 背景・問題

1. **通知ミュート/カスタムしきい値が実質デッド**。`resolveThresholds` が `subscriptionActive` でゲートされ、バックエンド凍結後は `isSubscriptionActive()` が常に false → 常に既定しきい値を返し、ユーザーが「通知設定」で設定したミュート・コース別しきい値を無視する。ポップアップ側の締切通知は 1h/3h/24h 固定でルールを参照すらしていない。＝設定パネルが飾りになっている。
2. **コース更新通知（`notifyCourseUpdate`）がミュートを一切見ずに無条件発火**。抑制手段がない。
3. **ダッシュボード下部の設定が見づらい**。長い「通知設定」「対象コースの選択」が `open` 固定で埋もれる。

## スコープ（3パート）

### Part A: 通知ミュートを実効化＋コース更新にも適用

- `resolveThresholds(rules, courseId)` から `subscriptionActive` 引数・ゲートを撤去。muted→null、override→その値、なし→`defaultThresholds`。
- 新規純粋層 `src/core/deadlineNotify.ts`：`computeDeadlineNotifications(targets, rules, notifiedKeys, now)`。各 target（`{id, courseId, title, courseName, deadline, url}`）について diff>0 かつ `resolveThresholds` が非null なら `pickThresholdToNotify` で発火分を決定し、`{id, title, message, url, notifyKey, thresholdHours}` の配列を返す。純粋・副作用なし。
- background `checkDeadlineWarningNotifications` と App(ポップアップ) `checkDeadlineWarningNotifications` の**両方**をこの共有関数に載せ替える。App 側の targets に `courseId` を持たせる（手動課題は courseId なし＝override 非適用＝`defaultThresholds`）。既定（override無し）の挙動は 1/3/24h のまま不変。
- 新規純粋層 `shouldNotifyCourseUpdate(rules, courseId, globalEnabled)`：`globalEnabled===false` または当該コースが muted なら false。`notifyCourseUpdate` 発火前に判定し、false なら **Chrome通知はスキップ／`addUnreadUpdates`（NEWバッジ・履歴）は維持**。
- コース更新通知の全体トグル `courseUpdateNotifyEnabled`（既定 true）を `premium.ts` に get/save 追加。background の課題スキャン内でロードして `shouldNotifyCourseUpdate` に渡す。

### Part B: テーマ「自動（OS追従）」＋初期値=自動

- テーマ値を `'auto' | 'default'（ライト） | 'dark'` に拡張。`getTheme` の既定を `'default'→'auto'`（明示選択者は保存値を維持・未選択者はOS追従）。
- 新規純粋層 `src/core/theme.ts`：`resolveEffectiveTheme(stored, systemPrefersDark): 'default' | 'dark'`。`'dark'→dark`、`'default'→default`、`'auto'→systemPrefersDark ? 'dark' : 'default'`、不明→`'default'`。
- 適用は既存どおり `document.documentElement.setAttribute('data-theme', effective)`（CSS変更不要：`:root`=ライト、`[data-theme="dark"]`=ダーク）。
- mount 時に effective を解決して適用。`stored==='auto'` の間は `matchMedia('(prefers-color-scheme: dark)')` の change を購読して即時再適用。auto 以外に切替えたら購読解除。popup/dashboard 両方で作動。
- テーマセレクタを **自動 / ライト / ダーク** の3ボタンに（'default' 表示名「標準」→「ライト」）。クリック時は effective を解決して data-theme を張り、保存値は raw（auto/default/dark）。

### Part C: 下部設定の再配置＋長いものを標準で格納

- 設定群の直前に「設定」見出しを追加し、上の課題セクションと視覚的に分離。
- 標準で格納（`open` を外す）：`通知設定`・`対象コースの選択`。既に格納の `非表示にした課題`・`データ管理` は維持。
- 短い `テーマ` は開いたまま。
- 設定ゾーン内の並び：`対象コースの選択(格納) → 通知設定(格納) → テーマ(表示) → 非表示にした課題(格納) → データ管理(格納)`。
- 折りたたみの体裁を可能な範囲で統一。設定は従来どおり課題コンテンツの下。

## テスト（純粋層TDD）

- `resolveEffectiveTheme`：auto×OS明/暗、明示 light/dark、不明フォールバック。
- `resolveThresholds`（ゲート撤去後）：muted→null、override→値、なし→default、rules=null→default。既存の「サブスク非active」テストは撤去。
- `computeDeadlineNotifications`：muted コースは発火なし、閾値到達で発火、notifiedKey 重複は抑制、diff<=0 は無視、手動課題（courseId無）は default。
- `shouldNotifyCourseUpdate`：globalEnabled=false、muted、通常(true)。

## 非目標（YAGNI）

- コース更新の「変更（追加以外）」検知。
- 通知クリックのコース直リンク化。
- 設定の全面ビジュアル刷新。
- サーバー同期（凍結中・ローカル保存のみ）。

## 影響

- 権限・収集・外部送信は無変更。既定ユーザーの締切通知タイミングは不変。ミュート/カスタム値/コース更新トグルが「飾り」から実機能へ。
