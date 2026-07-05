# ベータ用サブスクトグル 設計 (v1.2.0 Phase 1: クライアント)

- 日付: 2026-07-05
- ブランチ: develop (v1.2.0)
- ステータス: 設計承認済み

## 背景と目的

v1.1.0 のリリースめどがつき、v1.2.0（サブスク）のベータテストを開始する。
ベータテスターがプレミアム機能を試したり、無料体験を確認したりできるよう、
拡張のUI上でサブスク状態を ON/OFF できるトグルを提供する。

課題は2点:

1. サブスク ON/OFF ボタンは既に `src/App.tsx` の `__DEV_TOOLS__` ゲート内
   （開発用パネル）に存在するが、`__DEV_TOOLS__` は `mode==='development'`
   （`dist-dev` ビルド）でしか true にならず、通常配布ビルドには出ない。
2. トグルでローカルキャッシュを `active` にしても、ポップアップを開くたびに
   `App.tsx` が `/api/subscription/status` を叩いて実サブスク状態で上書きする
   （`saveSubscriptionCache` → `setIsSubscriber(data.status === 'active')`）。
   実課金していないテスターは ON にしても開き直すと OFF に戻る。

したがって本設計は「既存トグルを (1) ベータ配布ビルドで表示し、(2) サーバー状態
より優先される恒久オーバーライドにする」ことを目的とする。

## スコープ

### 今回やること (Phase 1: クライアント)

- ベータ配布ビルドフレーバー（`dist-beta`）の新設
- サーバー/キャッシュ由来のサブスク状態を上書きする恒久オーバーライドの仕組み
- ベータビルドで表示されるサブスク ON/OFF/解除トグルUI
- クライアント側で分岐するプレミアムUI/機能の解放プレビュー
  （プレミアム設定パネル、カスタム通知ルール編集UI、`SubscriberBadge` 等）

### 今回やらないこと (別タスク)

- サーバー側の無償エンタイトルメント付与（ベータアカウントへの comp フラグ）。
  これがないと Discord 実招待など**サーバーが実サブスク状態を検証する機能**は
  クライアントトグルだけでは解放されない。Phase 2 として後続タスク化する。
- staging API の用意（下記「確認済みの前提」参照）。

## アーキテクチャ

### 現状の関連コード

- サブスク状態は `chrome.storage.local` に保存
  （`subscriptionStatus` / `subscriptionCheckedAt` / `subscriptionGraceUntil`）。
- `src/core/auth.ts` の `getSubscriptionState()` / `isSubscriptionActive()` が
  キャッシュを読む。
- `src/App.tsx` が `isSubscriber` state を保持。以下の箇所で確定する:
  - マウント effect（トークンありならサーバー取得、なければキャッシュ or false）
  - `handleAfterLogin()`（ログイン直後にサーバー取得）
  - `handleLogout()`（false 固定）
  - 既存 dev パネルの ON/OFF ボタン
- UIは `isSubscriber` で分岐: プレミアム設定パネル + `SubscriberBadge` か、
  `ProBanner`（アップセル）か。
- ビルドフレーバーは `vite.config.ts` で mode により分岐:
  dev(`dist-dev`, `__DEV_TOOLS__=true`, 拡張名「[開発版]」) と prod(`dist`)。

### 1. ベータビルドフレーバー新設

`vite.config.ts` に3つ目のフレーバーを追加する。

- mode 判定を拡張し、`isBeta = mode === 'beta'` を導入。
- `outDir` を `dist-dev` / `dist-beta` / `dist` に振り分け。
- `define` に `__BETA__: isBeta` を追加（`__DEV_TOOLS__: isDev` は据え置き）。
- 既存 `dev-manifest` プラグインと同じ手法で、beta ビルド時に
  `dist-beta/manifest.json` の `name` を「LETUS Task Watcher [ベータ]」に書き換える。
- `src/vite-env.d.ts` に `declare const __BETA__: boolean` を追加。
- `package.json` に `build:beta`（`vite build --mode beta`）スクリプトを追加。

これで本番 `dist` は `__BETA__`・`__DEV_TOOLS__` ともに false となり、
トグルUIが**絶対に**混入しない。

### 2. 恒久オーバーライドの仕組み

新規モジュール `src/core/betaOverride.ts`:

- ストレージキー `betaSubscriptionOverride`: `'on' | 'off' | null`
- `getBetaSubscriptionOverride(): Promise<'on' | 'off' | null>`
- `setBetaSubscriptionOverride(v: 'on' | 'off'): Promise<void>`
- `clearBetaSubscriptionOverride(): Promise<void>`（キー削除）
- 純関数 `resolveSubscriber(serverActive: boolean, override: 'on' | 'off' | null): boolean`
  - `override === 'on'` → `true`
  - `override === 'off'` → `false`
  - `override === null` → `serverActive`（現行挙動そのまま）

`App.tsx` の `isSubscriber` 確定箇所（マウント effect・`handleAfterLogin`）で、
サーバー/キャッシュ由来の `active` を計算した後に
`setIsSubscriber(resolveSubscriber(active, override))` とする。
オーバーライドがある間はサーバー応答で勝手に戻らない。

`null`（未設定）のときは完全に現行挙動。テスターが一度も触らなければ
実サブスク状態がそのまま反映される。

### 3. UIトグル

既存の `App.tsx` 開発用パネル（`__DEV_TOOLS__` ゲート）を流用する。

- ゲート条件を `__DEV_TOOLS__` → `__DEV_TOOLS__ || __BETA__` に変更。
- パネル見出しをベータ時に合わせて調整（例: 開発時「🛠 開発用: サブスク状態」、
  ベータ時「ベータ設定: サブスク状態」）。
- ボタンを3状態に整理:
  - 「サブスクON（強制）」→ `setBetaSubscriptionOverride('on')` + `setIsSubscriber(true)`
  - 「サブスクOFF（強制）」→ `setBetaSubscriptionOverride('off')` + `setIsSubscriber(false)`
  - 「オーバーライド解除（実状態に戻す）」→ `clearBetaSubscriptionOverride()` +
    実サブスク状態を再取得して `setIsSubscriber` 反映
- 現在の override 状態と実サブスク状態を表示する。

### 4. デフォルト

新規インストール時 override は `null` = 実状態。
テスターはまず無料体験を見る。ON/OFF は明示操作でのみ切り替わる。

## エラーハンドリング

- ストレージ read/write は既存モジュール同様 async。read 失敗時は `null` 相当
  （＝現行挙動）にフォールバック。
- サーバー取得が失敗しても override があれば override が優先されるため、
  ベータ体験は壊れない。

## テスト

- `src/core/betaOverride.test.ts`:
  - `getBetaSubscriptionOverride` 未設定時 `null`
  - `setBetaSubscriptionOverride` → `get` 往復（'on' / 'off'）
  - `clearBetaSubscriptionOverride` 後 `null`
  - `resolveSubscriber` の3分岐（on/off/null）を純関数としてユニットテスト
- 既存テスト（`premium.test.ts` / `auth.test.ts`）に影響がないことを確認。

## 確認済みの前提

- ベータビルドの `API_BASE_URL` は本番APIのまま。override がクライアントで勝つため
  実害はない。staging API は今回用意しない。

## 受け入れ基準

- `pnpm build:beta` で `dist-beta/` が生成され、拡張名が「[ベータ]」になる。
- `dist-beta` の拡張でサブスク ON/OFF/解除トグルが表示される。
- ON に設定するとポップアップを開き直してもプレミアムUIが維持される
  （サーバーの実 inactive 状態で戻らない）。
- OFF に設定すると実サブスクライバーでも無料UIが表示される。
- 解除すると実サブスク状態に戻る。
- 通常の `pnpm build`（`dist`）にはトグルが一切含まれない。
- 既存ユニットテストが全て green。
