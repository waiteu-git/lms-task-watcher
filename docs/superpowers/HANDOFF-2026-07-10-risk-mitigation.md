# 引き継ぎ: LTW リスク抑制パッケージ（v1.2.1）

- 日付: 2026-07-10（JST）
- ブランチ: `feature/risk-mitigation`（tip = `31803bf`、作業ツリーはクリーン）
- 分岐元: `feature/v1.2.0-timetable-onboarding`（`9749651`）
- マージ先: **`develop`**（`main` ではない。v1.2.0 も develop にマージ済み）
- 状態: **実装・レビュー完了。実機検証とマージは未実施。**

## 何をしたか

ソースが GitHub 公開されているため、悪用（大学システムへの過負荷、スクレイピング乱用、自動化ツールへの転用）とレピュテーションのリスクがある。litus で実施した3本柱を検討したが、**LTW には actuator（書き込み動作）が存在せず外部送信もゼロ**なので「悪用可能ソースの非公開化」は行わず（LICENSE 冒頭の透明性の約束と矛盾するため）、2本柱に絞った。

設計: `docs/superpowers/specs/2026-07-10-ltw-terms-consent-license-hardening-design.md`
計画: `docs/superpowers/plans/2026-07-10-ltw-terms-consent-license-hardening.md`

### 1. 利用規約＋同意ゲート（新設）

**同意するまで一切収集しない。** 収集の起点は4つで、すべて塞いだ（最終レビューで独立に網羅性を確認済み）。

| 起点 | 場所 | ガード |
|---|---|---|
| alarm 駆動スキャン | `src/background/index.ts` `runAutoScan()` | 冒頭で `if (!(await isConsented())) return` |
| 収集系メッセージ3種 | 同 `onMessage`（`UPSERT_COURSES` / `START_ASSIGNMENT_SCAN` / `START_DEADLINE_SCAN`） | 未同意なら `{ok:false, reason:'consent_required'}`。`OPEN_DASHBOARD` は通す |
| LETUS のコース検出＋DOM注入 | `src/content/courseDetector.ts` | 未同意なら `run()` も `initManualTaskWidget()` も呼ばない |
| CLASS の時間割取り込み | `src/content/classTimetable.ts` | 未同意なら `MutationObserver` を**登録しない** |

- 同意状態: `chrome.storage.local` の `termsConsent = { version, acceptedAt }`。`TERMS_VERSION` と一致するときのみ同意済み
- 判定は `src/legal/termsConsent.ts` の `isConsented()` に一元化。**fail-closed**（storage 例外・未設定・型不正・プロトタイプ汚染・配列すべて `false`）
- 画面: `src/components/TermsConsentScreen.tsx`。popup とダッシュボード双方を `isDashboard` 分岐より前でゲート。スキップ・閉じる導線なし
- 督促: `chrome.action.setBadgeText` で `!` バッジ。**Chrome 通知は使わない**
- 既存の収集済みデータは再同意時も削除しない

### 2. LICENSE 強化

和英に4条追記: 不正利用の禁止 / 自己責任・免責の強化 / 違反時の自動終了 / 準拠法・管轄（日本法・東京地方裁判所）。
**cabetus（`github.com/haya9924/cabetus`）への個別許諾は無傷**（和英ともバイト単位で不変を検証済み）。

### 3. 同梱された独立変更（コミット `5176d98`）

このブランチ着手前から作業ツリーに未コミットで存在していた「サブスク・認証UIとバックエンド連携の撤去」を、独立コミットに切り出した。`manifest.json` の `host_permissions` から `api.waiteu.dev` を削除。結果、拡張の通信先は LETUS と CLASS のみ＝**外部送信ゼロ**になり、規約の「外部への送信は行いません」の根拠になっている。

## 残作業

### A. 実機検証（未実施。最優先）

誰もブラウザに読み込んでいない。`pnpm build` して `chrome://extensions` から `dist` を読み込み、`chrome.storage.local` をクリアしたうえで:

1. 拡張アイコンに `!` バッジが出る
2. LETUS のコースページを開いても、コース検出も手動タスクウィジェットの DOM 注入も起きない（コンソールに `terms not accepted; content script is inactive`）
3. CLASS の学生時間割表を開いても「時間割を取り込みました」トーストが出ない
4. DevTools の Network で、LETUS / CLASS への fetch が発生しない
5. popup を開くと同意画面。閉じる導線が無い。規約全文が箱の中でスクロールし、「同意して始める」が常に見えている
6. `index.html#dashboard` を直接開いても同意画面が出る
7. 「同意して始める」→ バッジが消え、通常どおりコース検出とスキャンが動く
8. `chrome.storage.local` の `termsConsent` を `{version: 0, acceptedAt: "..."}` に書き換える → バッジが復活し、popup が同意画面に戻る（再同意の検証）

`store-submission-v1.2.1.md` にもチェックリストがある。

### B. develop へマージ → landing 公開 → ストア提出（この順序を厳守）

**`https://lms.waiteu.dev/terms` は現在トップページを返す。** `landing/*` は develop への push で Cloudflare Pages が自動デプロイされる（`docs/app-landing-publish-runbook.md`）。`landing/app.html` → `/app` の対応なので `landing/terms.html` → `/terms` になる。

`changelog.html` / `welcome.html` / `privacy-policy.md` / ストア掲載がこの URL を参照するため:

1. develop にマージして push（Cloudflare Pages が landing を反映）
2. `https://lms.waiteu.dev/terms` が**規約本文で 200 を返す**ことを確認
3. その後にストアへ提出

develop はこのブランチより 14 コミット先行、こちらは develop より 22 コミット先行。マージ時に衝突しうる。

### C. 未了（スコープ外と判断したもの）

- `store-listing.md` の Long description が v1.2.0 のまま
- `src/core/syllabusParse.ts` の `no-irregular-whitespace` lint エラー2件（`fix/syllabus-irregular-whitespace` ブランチの領分）
- `docs/privacy-policy.md`（日本語版）が CLASS の時間割・シラバス収集に言及していない。ストア提出で公開するのは完全版の root `privacy-policy.md` なので支障はない

## 踏み抜くと痛い落とし穴

**1. content script に共有モジュールを import させてはいけない。**
`content_scripts` は classic script として読み込まれる。`dist/content.js` / `dist/classTimetable.js` に ESM の `import` 文が1つでも出力されると実行時に構文エラーで即死する。

このタスクでも実際に踏んだ。`src/legal/termsConsent.ts` は background からも import されるため、Rollup が共有チャンクに切り出して `import` 文が出た。**対処として `isConsented` / `hasValidConsent` を両 content script 内にインライン展開してある。** 触るときは必ず:

```bash
pnpm build
grep -nE "^[[:space:]]*import[[:space:]{'\"]" dist/classTimetable.js dist/content.js   # ヒット0件が正常
```

**2. `TERMS_VERSION` は content script に数値で書かないこと。**
インライン展開の副作用で版番号が三重化しかけた。改定時に content script 側を更新し忘れると、`classTimetable.ts` は background を経由せず直接 `chrome.storage.local.set` するため、**正典的には未同意の利用者から黙って収集し続ける**。ビルドも型検査もテストも通ってしまう。

現在は `vite.config.ts` の `define` で `__TERMS_VERSION__` を `src/legal/termsVersion.ts` から注入している。`src/legal/termsVersion.test.ts` が、content script に数値リテラルが書き戻されることを4パターン（`const` / `let` / 別名 / 呼び出し箇所への直書き）すべて検出する。**このテストを消さないこと。**

**3. 規約本文は生成物。手編集しない。**
正典は `docs/legal/terms-ja.md`。`src/legal/termsBody.ts` と `landing/terms.html` は `pnpm gen:terms` で生成される。`src/legal/termsBody.test.ts` が正典との完全一致を検証するので、正典を編集して再生成を忘れると落ちる。

**規約を実体的に改定したら `src/legal/termsVersion.ts` の `TERMS_VERSION` を +1 する**（起動時に再同意が走る）。正典の「版（TERMS_VERSION）: **N**」の記載も同時に更新すること（テストが一致を検証する）。

**4. テストで Node 組み込みモジュールを import しない。**
`tsconfig.app.json` は `include: ["src"]` かつ `types: ["vite/client"]` なので、`src/` 配下のテストが `node:fs` を import すると `tsc -b` が落ちる。ファイル読み込みは Vite の `?raw` インポートを使う（`src/legal/termsBody.test.ts` が前例）。

**5. `manifest.json` の version は 1.2.1 のまま。bump しない。**
v1.2.1 は未リリースの作業中バージョンで、機能修正（`ea131ed`）とこのパッケージを同梱して出す。

**6. 未同意なら収集停止は既存ユーザーにとって破壊的変更。**
アップデート後、同意するまで課題の収集と通知が止まる。`changelog.html` の最上部で告知済み（修正リストに埋もれさせない）。

## 検証コマンド

```bash
pnpm vitest run src                        # 659件 全PASS
npx tsc -p tsconfig.app.json --noEmit      # exit 0・出力なし
pnpm build                                 # 成功
npx eslint src                             # 既存2 error（syllabusParse）以外が出ないこと
pnpm gen:terms && git status --porcelain   # 差分ゼロ（規約の生成物が最新）
grep -nE "^[[:space:]]*import[[:space:]{'\"]" dist/classTimetable.js dist/content.js   # ヒット0件
```

## レビュー結果

ブランチ全体の最終レビュー（`9749651..31803bf`、20コミット）は **READY TO MERGE**。Critical 0 / Important 0。

レビュアーが独立に検証した不変条件:
- `src` 全体の `chrome.*` リスナー・`fetch`・`MutationObserver` を洗い出し、収集起点は上表の4つのみと確定。すべてゲート済み
- 収集を伴わない他リスナー（`onStartup` / `onInstalled` / `storage.onChanged` / 通知クリック）は未同意で副作用なし
- シラバス取得の `fetch` はダッシュボード限定・同意後 UI・ユーザー起点のみ
- `premium.ts` / `syncCoursesToServerIfSubscriber` は `API_BASE_URL` が空で no-op
- 規約の「成績等の機微な情報は取得しません」は、`isClearlyNonAssignmentUrl` の `/grade/` 除外と、CLASS への到達先が時間割 `table.classTable` とシラバスのみであることで裏取り済み

残る Minor（マージをブロックしない）:
- `hasValidConsent` のアルゴリズム本体が正典＋content script 2本の3箇所に複製（版番号のドリフトは根絶済み。ロジック変更時のドリフトは残る）
- 更新前から開いたままの CLASS タブでは、旧 `classTimetable.js` がリロードまで動き `timetable:*` を直接 storage に書く（background のバックストップが効かない）。一過性・既存開放タブ限定・Chrome の content script 更新仕様上ほぼ不可避
- content script の `.catch()` が `.then()` 内の同期例外も「consent check failed」と誤ラベルしうる（fail-open にはならない）
- `TermsConsentScreen` の `try` が `onAccept()` 全体を包むため、`setConsentState('ok')` の例外も「保存に失敗しました」と誤表示しうる

## 経緯のメモ

Task 5 の実装時、`App.tsx` / `App.css` に載っていた無関係な未コミット WIP（サブスク撤去）を巻き込んでコミットしてしまい、`reset --mixed` で解体して2コミットに分割した（`5176d98` と `e1c480e`）。剥がす前後の内容はバイト単位で一致を検証済み。以降の作業ツリーはクリーン。
