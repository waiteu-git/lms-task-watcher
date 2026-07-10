# LTW リスク抑制パッケージ（利用規約＋同意ゲート／LICENSE強化） 設計

- 日付: 2026-07-10（JST）
- 対象リリース: **v1.2.1**（バージョン bump なし。既存の v1.2.1 改善と同梱して公開）
- ブランチ: `feature/risk-mitigation`（`feature/v1.2.0-timetable-onboarding` から分岐）
- 関連: litus 側の同名パッケージ（`C:\dev\litus` の `docs/superpowers/specs/2026-07-10-risk-mitigation-license-terms-source-hardening-design.md`）

## 背景

litus（モバイルアプリ）で、公開ソースの悪用・大勢利用による集約負荷・レピュテーションリスクへの対策として「①悪用可能ソース非公開化 ②利用規約＋同意ゲート ③LICENSE強化」の3本柱を実施した。同じ懸念が LTW（LETUS Task Watcher, Chrome/Edge 拡張）にも当てはまるかを検討した結果、**リスク構造が異なるため 3 本柱をそのまま持ち込まない**。

### LTW のリスク構造（調査結果）

- **actuator（書き込み動作）が存在しない。** LETUS / CLASS へのアクセスは、ブラウザの既存セッション Cookie を用いた GET（`credentials: 'include'`）と、`extractSesskey` による Moodle AJAX の読み取りのみ。litus の「出席送信」に相当するものがない。
- **外部送信がゼロ。** 唯一の外部 POST は自前バックエンド宛ての `syncCoursesToServerIfSubscriber` だが、`API_BASE_URL` は `import.meta.env.VITE_API_BASE_URL ?? ''`（`src/App.tsx:106`）で凍結中（空）。サブスク／ログイン UI も `App.tsx` から外れている。`privacy-policy.md` の「サーバを運用せず、データを送信しない」と一致する。
- **一方、規約と同意ゲートが存在しない。** `privacy-policy.md` はあるが利用規約はなく、`src/core/onboarding.ts` は `onboardingCompleted` フラグのみ。`OnboardingBanner` は popup 内の非強制バナー、`welcome.html` はインストール時に開くだけで、いずれも「閉じれば終わり」。
- **LTW は Chrome Web Store / Edge Add-ons で不特定多数へ配布済み**であり、未公開の litus より曝露が大きい。

### 方針

したがって本パッケージは **2 本柱**とする。

| litus の柱 | LTW での扱い | 理由 |
|---|---|---|
| ① 悪用可能ソース非公開化 | **実施しない** | 隠すべき actuator が存在しない。かつ LICENSE 冒頭が「収集データと送信先をユーザー自身が検証できるようにするため公開している」と明言しており、収集ループを隠すことはこの約束と正面から矛盾する |
| ② 利用規約＋同意ゲート | **実施（新設）** | 最大のギャップ。未同意なら収集を実行しない |
| ③ LICENSE 強化 | **実施（追記）** | 自己責任・免責強化・不正利用禁止・違反時の自動終了・準拠法／管轄が未記載 |

対策の目的は秘匿ではなく、**「同意していない人のデータを扱わない」ことの実効化**と、**責任範囲の明文化**である。

## 柱1: 利用規約＋同意ゲート

### データモデル

単一の真実は `chrome.storage.local` の `termsConsent`。

```ts
type TermsConsent = { version: number; acceptedAt: string }  // acceptedAt は ISO8601
```

`TERMS_VERSION` と `version` が一致するときのみ「同意済み」。不一致・未設定はすべて未同意扱いとする。これにより、規約改定は `TERMS_VERSION` を +1 するだけで再同意が走る。

**既存の収集済みデータ（`assignments` 等）は削除しない。** 端末内にあり、ユーザー自身のものであるため。

### 新規モジュール

純ロジックは Vitest で TDD（`pnpm vitest run src`）。

- `src/legal/termsVersion.ts` — `export const TERMS_VERSION = 1`
- `src/legal/termsConsent.ts`
  - `hasValidConsent(stored: unknown, version: number): boolean` — 純関数
  - `getConsent(): Promise<TermsConsent | null>` / `saveConsent(version: number): Promise<void>` — `chrome.storage.local` I/O
- `src/legal/termsBody.ts` — `TERMS_BODY`（**生成物**。「規約本文の単一正典」節を参照）
- `src/components/TermsConsentScreen.tsx` — popup 全面。全文表示、末尾までスクロール後に「同意して始める」を活性化。**スキップ不可**（閉じる導線を置かない）
- `src/background/storageKeys.ts` に `TERMS_CONSENT_KEY = 'termsConsent'` を追加

### 収集の停止フック（3点）

LTW のスキャンは alarm 駆動であり、popup を一度も開かなくても LETUS / CLASS へのアクセスが走る。popup のゲートだけでは同意が形骸化するため、以下の 3 点すべてを塞ぐ。

1. **`src/background/index.ts` の `runAutoScan()`** — 冒頭で未同意なら即 `return`。alarm 駆動のスキャンを止める。
2. **同ファイルの `chrome.runtime.onMessage` ハンドラ** — 収集系メッセージ **`UPSERT_COURSES` / `START_ASSIGNMENT_SCAN` / `START_DEADLINE_SCAN`** を未同意なら拒否する。ここが決定的な防波堤である。`START_*` は popup の `src/App.tsx:466` の自動 refresh から送られるが、この `useEffect` は React の hooks であり **画面を早期 return でゲートしても実行される**。したがって画面側のゲートだけでは popup を開いた時点で収集が走ってしまう。`UPSERT_COURSES` については、古い content script が残存してガードをすり抜けた場合の防波堤も兼ねる。`OPEN_DASHBOARD` は収集を伴わないので拒否しない。
3. **content script 2 本**
   - `src/content/courseDetector.ts` の `run()` — 未同意なら no-op。`initManualTaskWidget()` による LETUS ページへの DOM 注入も行わない
   - `src/content/classTimetable.ts` — 未同意なら `capture()` を呼ばず、`MutationObserver` も**登録しない**

あわせて `src/App.tsx` の自動 refresh（`hasAutoRefreshCheckedRef` を用いる `useEffect`）も、同意判定が済むまで実行しないようガードする。これは無駄な `START_*` 送信を防ぐためであり、実効的な停止はフック 2 が担う。

`src/App.tsx` は未同意なら `TermsConsentScreen` を全面表示する。`App.tsx` は popup とダッシュボードを `isDashboard` で切り替えているが、**ゲートはこの分岐より前**に置き、popup / ダッシュボードの双方を塞ぐ。画面順序は **規約同意 → オンボーディング → 通常画面**（`onboardingCompleted` は現状のまま残す）。litus の「規約→オンボ→ログイン」と同じ並び。

### 未同意の可視化（バッジ）

`chrome.action.setBadgeText` で未同意時に `!` を表示し、同意で消去する。更新契機は 2 つ:

- `handleInstalled`（install / update 双方）
- `chrome.storage.onChanged` で `termsConsent` を監視

**Chrome 通知は使わない。** 規約に同意していない相手へ通知を送るのは収集停止の趣旨とちぐはぐであり、`notifications` 権限の使い方としても筋が悪い。

### 規約の条項

litus 版から出席・認証情報・決済まわりを引き算し、LTW の事実に合わせる。

1. **位置づけ** — 東京理科大学の公式拡張ではない。非公式・個人提供。大学および関連組織は本拡張の提供・運営に関与しない
2. **本人利用** — ブラウザの既存ログインセッションを用いる。ID・パスワードは取得も保存もしない。他人のアカウントでの利用・なりすましを禁止
3. **取得する情報と通信先** — LETUS の課題情報、CLASS の時間割・シラバスのみ。**成績等は取得しない**。すべて端末内保存で、**外部への送信は行わない**
4. **禁止事項** — 大学システムへの過度な負荷、スキャン間隔の改変等による乱用、他人のアカウントでの利用、本拡張のコード・技術を用いた同等の行為、大学の規程・法令に反する利用
5. **自己責任・免責** — 現状有姿、無保証。利用または利用不能に起因する損害について提供者は責任を負わない
6. **改定・準拠法** — 改定時は `TERMS_VERSION` を更新し再同意を求める。日本法に準拠

条項 3 の「成績等は取得しない」は、`host_permissions` が `https://class.admin.tus.ac.jp/*` 全体に及ぶことに対する明示的な自己拘束として置く。

**決済・アカウント条項は含めない。** `api/`（Stripe サブスク・認証・Discord 連携）はリポジトリに残るが拡張からの通信は凍結されており、書けば存在しない機能に同意させることになり、`privacy-policy.md` の「サーバを運用しない」とも矛盾して見える。復活時に `TERMS_VERSION` を +1 して再同意を求める。

### 規約本文の単一正典

正典は `docs/legal/terms-ja.md`。ここから 2 つの派生物を**生成**する。手で 3 箇所を同期すると必ずズレる（litus では一致を口約束にしていた）。

- `scripts/gen-terms.mjs` — `docs/legal/terms-ja.md` を読み、以下を出力（`scripts/gen-promo.mjs` の前例に倣う）
  - `src/legal/termsBody.ts`（`TERMS_BODY` 文字列）
  - `landing/terms.html`
- 検証は**再生成して差分が出ないこと**を Vitest で確認する。生成物のコミット忘れ・手編集を検出できる。

`landing/terms.html` は `lms.waiteu.dev/terms` として公開し、`privacy-policy.md` とストア掲載情報から相互リンクする。

## 柱2: LICENSE 強化

既存の source-available 条項（閲覧・検証の許可、複製・再配布・商用利用の禁止）は維持し、和英双方に以下を追記する。

- **不正利用の禁止** — 本コードを、大学システムへの過度な負荷、スクレイピングの乱用、自動化ツールへの転用に用いること
- **自己責任・免責の強化** — 既存の "AS IS" に、間接損害・逸失利益を含む一切の責任を負わない旨を補強
- **違反時の自動終了** — 条項違反により本ライセンスに基づく許可は自動的に終了する
- **準拠法・管轄** — 日本法に準拠。第一審の専属的合意管轄は東京地方裁判所

**cabetus（`github.com/haya9924/cabetus`）への個別許諾は現状のまま維持する。** litus では「LETUS 関連コード限定」に絞ったが、LTW は全体が LETUS 関連であり絞る意味がなく、既に与えた許諾を後から狭めるのは筋が悪い。

`README.md` のライセンス節も追随させる。

## リリース（v1.2.1 同梱）

v1.2.1 には既に `ea131ed`（英字入り科目 ID のコース自動選択、LETUS 上バッジの提出状態更新、課題ページ右下表示を提出状態へ）が入っており、`public/manifest.json` も 1.2.1 済み。**バージョン bump は行わない。**

- `public/changelog.html` — **規約の節を最上部**に置き、既存の「🔧 今回の修正」をその下へ移す。「利用規約を新設しました。**同意いただくまで課題の収集と通知を停止します**」と規約 URL を明記。リタス（Litus）関連の掲載は従来どおり継続する（プロジェクトの changelog ルール）
- `public/welcome.html` — 新規インストール向け。同意画面は popup 側にあるため、「拡張アイコンから規約に同意すると収集が始まります」の一節を追加。MV3 CSP のため inline script は使わず `welcome.js` に置く既存方針を守る
- `store-submission-v1.2.1.md` — 挙動変更（未同意時は収集しない）を含むため、ストア再審査用の説明を用意

**未同意なら収集停止は既存ユーザーにとって破壊的変更である。** Chrome 拡張のバージョンは単調増加であればよくパッチ版に載せること自体は審査上も支障ないが、changelog で修正リストに埋もれさせないよう最上部に出す。

## テスト方針

1. **`hasValidConsent` の純ロジック** — 未設定 / 版不一致 / 版一致 / 壊れた値
2. **収集 3 フックが未同意で発火しないこと** — `runAutoScan` が即 return、収集系メッセージ 3 種（`UPSERT_COURSES` / `START_ASSIGNMENT_SCAN` / `START_DEADLINE_SCAN`）が拒否され `OPEN_DASHBOARD` は通ること、content script 2 本が no-op（`MutationObserver` を登録しない）
3. **`gen-terms` 生成物の一致** — 再生成して `src/legal/termsBody.ts` と `landing/terms.html` に差分が出ないこと

既存の `pnpm vitest run src` に載せる。typecheck（`tsc -b`）も通す。

## スコープ外

- ソースの非公開化・private 隔離（上記のとおり実施しない）
- `api/` の復活および決済・アカウント条項
- スキャン間隔・リトライ上限の抑制（検討したが今回は入れない。必要なら別スペックで）
- 過去の Git 履歴の書き換え

## 備考

本文書は自衛のための設計であり、法的助言ではない。
