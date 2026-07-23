# Chrome Web Store 申請チェックリスト — v1.2.1

アップロード用パッケージ: **`letus-task-watcher-1.2.1.zip`**（`dist/` を zip 化して作成。ファイル数・サイズは提出直前に実測すること）
manifest version: **1.2.1**（**bump なし** — v1.2.0 のバグ修正版として提出済みだった 1.2.1 の番号をそのまま使う） ／ manifest v3 ／ 決済・外部サーバー通信なし（ローカル完結）

> **2026-07-13 更新（再提出準備）**: 取り下げ後の develop 土台に、実機検証で見つかった修正を追加で同梱した（`bbfacd6..8e8067b`・全て develop マージ＆push 済み・255/255テスト緑）。
> - **`already_running` の偽エラー修正**: ポップアップ/ダッシュボード併用時に background が返す `already_running` を無害な状態として扱い、`console.error`（chrome://extensions のエラー欄汚染）と「更新中にエラーが発生しました」の偽通知を止めた。**ユーザーが実機で「no error」を確認済み**。
> - **オンボーディング改善**: ポップアップの初回チュートリアル先頭に「時間割（CLASS 学生時間割表）を取り込む」ステップを追加（4段化）。
> - **テスト整備**: 規約v2昇格で腐っていた consent テスト fixture を修正（`vitest` 全緑を回復）。
> - **提出パッケージ**: 最新 develop から `letus-task-watcher-1.2.1.zip` を再作成（**forward-slash パスで再固め**＝Windows Compress-Archive の backslash 問題を回避。旧 `lms-task-watcher-v1.2.1.zip` は 7/11 の古いビルドなので `.bak` に退避済み・アップロード禁止）。
> - **規約/プライバシー URL は公開済み**: `/terms`（版2）・`/privacy` とも 200 を確認済み。

このリリースは**独立した2つの変更**を同梱する。

1. **サブスク・認証UIとバックエンド連携の撤去**（`5176d98`） — `api.waiteu.dev` 凍結に伴い、拡張から関連コード一式を削除。`host_permissions` から `https://api.waiteu.dev/*` を削除。**通信先は LETUS と CLASS のみになり、外部送信はゼロ**。
2. **リスク抑制パッケージ**（`6d2da78` 〜 `69f69da`） — 利用規約の新設と同意ゲート、LICENSE強化。**既存ユーザーにとって破壊的変更**（下記§0参照）。

v1.2.1 の機能修正（`ea131ed`、リスク抑制着手前から存在）も同梱する。

---

## 0. 申請前チェック

- [x] `pnpm vitest run src` → 659 passed（実行結果は末尾「検証ログ」参照）
- [x] `npx tsc -p tsconfig.app.json --noEmit` → exit 0・出力なし
- [x] `pnpm build` → 成功
- [x] `npx eslint src` → 新規エラーなし（既存の `src/core/syllabusParse.ts` irregular-whitespace 2件のみ・別ブランチ領分）
- [x] `dist/classTimetable.js` / `dist/content.js` に `import` 文なし（classic script が壊れていないことの確認）
- [x] `dist/manifest.json` の `host_permissions` は `letus.ed.tus.ac.jp` と `class.admin.tus.ac.jp` の2つのみ（**api.waiteu.dev は削除済み・新規ホストの追加なし**）
- [x] `pnpm gen:terms` 再実行後も差分なし（規約の生成物が正典と一致）
- [x] **`landing/terms.html` を `https://lms.waiteu.dev/terms` として公開**（2026-07-11 完了。develop マージ＋push で Cloudflare Pages が反映。`curl` で 200・`<title>利用規約 — LETUS Task Watcher</title>` を確認）
- [x] **プライバシーポリシーを公開URLでホスト**（2026-07-13確認: `https://lms.waiteu.dev/privacy` が拡張のポリシー本文で200・「端末内完結／外部送信なし」を明記。canonical も `/privacy`）
- [ ] スクリーンショットを1枚以上用意（1280×800、v1.2.0の素材 `store-assets/store-shot1〜3.png`・`images/screenshots-1280x800-editable/` を流用可。同意画面・オンボーディング変更があるため撮り直し推奨だが必須ではない）

### 挙動変更の明示（審査説明に必ず記載する）

**既存ユーザーはアップデート後、利用規約に同意するまで一切の収集・通知が止まる。** これは意図的な仕様変更であり、隠さずそのまま審査説明・ストア掲載情報に明記すること。

- 同意するまで: バックグラウンドの自動スキャン（`runAutoScan`）、コース登録・課題スキャン・締切スキャンのメッセージ処理、LETUS/CLASS 両方のコンテンツスクリプト（コース検出・DOM注入・時間割取り込み）が**すべて動作しない**
- 拡張アイコンに `!` バッジが表示される（`chrome.action.setBadgeText`。**Chrome通知は使わない**）
- ポップアップを開くと同意画面が表示され、同意するまで閉じる導線がない（同意 = ゲート通過の唯一の手段）
- 同意すると、通常どおりの収集・通知・表示に戻る
- 規約バージョンが将来改定された場合も同じ機構で再同意を求める

---

## 1. パッケージ

1. `pnpm build` で `dist/` を生成し、zip 化する
2. Chrome ウェブストア デベロッパー ダッシュボード → 既存アイテムの「パッケージ」タブから新バージョンをアップロード
3. manifest の `version` は **1.2.1 のまま**（前回申請時点から未提出であれば据え置きでよい。既に 1.2.1 で提出済みなら、Chrome Web Store の仕様上 version の再アップロードには番号を上げる必要がある点に注意 — ダッシュボードでの提出履歴を確認すること）

## 1.5 規約URLの公開（完了済み・2026-07-11）

**`https://lms.waiteu.dev/terms` は規約本文で 200 を返す状態になっている。この節の作業は完了しており、申請の前提条件は満たされている。**

経緯: `feature/risk-mitigation` を `develop` にマージして push（2026-07-11、マージコミット含む）。`docs/app-landing-publish-runbook.md` の構成どおり Cloudflare Pages が `landing/*` を自動デプロイし、`landing/terms.html` → `/terms` が反映された。反映後に `curl` で確認したところ、HTTP 200・`<title>利用規約 — LETUS Task Watcher</title>` を返し、本文には規約の版番号（`TERMS_VERSION: 1`）と準拠法の記述を含む。ローカルの `landing/terms.html` との差分は Cloudflare が挿入するチャレンジスクリプト1行のみで、規約本文は完全に一致する。

念のため申請直前にもう一度 `https://lms.waiteu.dev/terms` をブラウザで開き、規約本文が表示されることを目視すること（Cloudflare Pages の再デプロイ等で万一内容が変わっていないかの最終確認）。

---

## 2. ストアの掲載情報（Store listing タブ）

| 項目 | 値 |
|------|----|
| 拡張機能名 | LETUS Task Watcher |
| 概要（Summary, 132字以内） | LETUSの課題締切を自動収集し、ブラウザ通知でお知らせ。ダッシュボードで全課題を一覧管理できます。 |
| カテゴリ | Productivity（仕事効率化） |
| 言語 | 日本語 |
| アイコン | 128×128（パッケージ同梱 `icons/icon-128.png`）|

- **詳細説明**は `store-listing.md` の「Long description」がベース（v1.2.0時点の内容）。**v1.2.1の変更点（利用規約への同意制導入・バグ修正3件）を反映した更新が別途必要**（本ドキュメントのスコープ外。`store-listing.md` の更新は別タスクとして扱うこと）。

### v1.2.1 で追加する変更点サマリ（ストア掲載情報・審査説明に転記する）

- **利用規約を新設**。初回利用時（アップデート後を含む）に同意画面が表示され、同意するまで課題収集・通知は行われない
- **バグ修正3件**（`ea131ed`）:
  - 英字を含む科目ID（例 `9975A06`）がコース自動選択の対象にならない問題を修正
  - 課題提出後、LETUSページ上のバッジが「未提出」のまま更新されない問題を修正
  - 課題ページ右下の表示を「登録済み」から実際の提出状態へ変更
- **サブスク・認証機能を撤去**。ログイン・課金・バックエンド連携は一切なくなり、**外部送信はゼロ**になった
- **スキャンのリクエスト間隔を制御**。LETUSへのリクエストを最低180ms間隔（約4 req/s）に均し、サーバーへの瞬間的な負荷を人間の閲覧に近づけた（総リクエスト数は不変で、大学サーバーに優しい挙動になっただけ。ユーザー体感は「今すぐ更新」の完了が数十秒程度）

---

## 3. 単一用途（Single purpose）

v1.2.0から変更なし。

```
東京理科大学のLMS「LETUS」の課題締切を自動で収集・通知し、履修システムCLASSの時間割と
ひも付けて一覧表示する、学生向けの課題管理ツールです。
```

English:
```
A single-purpose tool that collects and notifies assignment deadlines from Tokyo
University of Science's LMS (LETUS) and links them to the student's timetable from
the CLASS system, for personal assignment management.
```

---

## 4. 権限の理由（Permission justifications）

**権限は v1.2.0 から増えていない。むしろ減っている。** `manifest.json` の `host_permissions` から `https://api.waiteu.dev/*` を削除したため（サブスク・認証バックエンドの撤去に伴う）、現在の権限は次の5つのみ。

| 項目 | Justification |
|------|---------------|
| `storage` | Stores collected assignment data, timetable, and user settings locally via chrome.storage.local. No data leaves the device. |
| `notifications` | Shows deadline reminders, scan-completion messages, and course-content update alerts. Not used for terms-consent nagging (a toolbar badge is used instead). |
| `alarms` | Schedules the once-a-day automatic background scan for new/updated deadlines. The scan does not run until the user accepts the Terms of Use. |
| Host `https://letus.ed.tus.ac.jp/*` | Reads the user's own course and assignment pages, using their existing login session, to extract deadlines and submission status. |
| Host `https://class.admin.tus.ac.jp/*` | Reads the user's own CLASS timetable and syllabus pages to display the weekly timetable and link courses to assignments. |
| Remote code | **No.** All code is bundled in the package; the extension loads no remote/external scripts. |

補足（審査説明に明記すること）:

- 新しい `action` の `setBadgeText`（未同意時の `!` バッジ表示）は既存の `action` 定義（`default_popup`/`default_icon`）の範囲内で使用しており、**新規の permission は不要**
- `docs/permission-justification.md` を確認した結果、この文書は元々 `api.waiteu.dev` に言及していなかったため、権限削減に伴う更新の必要はない（詳細は本作業の報告 `.superpowers/sdd/task-8-report.md` を参照）

---

## 5. プライバシー（Privacy タブ）

**プライバシーポリシーURL（必須）**: `privacy-policy.md` を公開URLで用意して貼る。候補:
- 個人サイト（推奨）: `https://lms.waiteu.dev/privacy.html`（Cloudflare Pages `waiteu-dev` に配置）
- または GitHub の raw / GitHub Pages URL

**規約URL（新設・必須の関連情報として掲載推奨）**: `https://lms.waiteu.dev/terms`（公開手順は§1.5参照。申請前に200確認必須）

**データ利用（Data usage）の申告**:
- 収集して外部送信するユーザーデータ: **なし**（すべて端末内 `chrome.storage.local` に保存し、外部サーバーへ送信しない）
- v1.2.0時点から**さらに強化**: サブスク・認証バックエンドの撤去により、通信先が構造的に LETUS と CLASS の2つのみになった（`api.waiteu.dev` への通信経路自体が存在しない）
- 認証（3つのチェックボックス）にすべて同意可能:
  - [x] ユーザーデータを承認された用途以外に使用・転送しない
  - [x] ユーザーデータを第三者に販売しない
  - [x] 信用力の判断・融資目的で使用・転送しない

> 補足: 拡張は課題・時間割などの情報を「読み取る」が、端末外へ「収集（送信）」はしないため、Web Store の定義上は data collection なしに該当。ポリシー本文もその旨を明記済み。

---

## 6. スクリーンショット（最低1枚 / 1280×800 推奨）

v1.2.0申請時の素材（`store-assets/store-shot1.png`〜`store-shot3.png`）を流用可能。UI変更（サブスク関連UIの撤去・同意画面の追加）があるため、以下を推奨:

1. **利用規約の同意画面**（新規機能なので1枚は入れておくとよい）
2. **ポップアップ**（今日の時間割＋24時間以内の課題が見える状態）
3. **ダッシュボード**（サマリー＋週間時間割グリッド＋課題カード）

撮影メモ: ダークテーマの見栄えも良いので、標準・ダークどちらか映える方で。ポップアップは幅440pxのため、ダッシュボード（別タブ）中心が1280×800に収めやすい。

---

## 7. 実機確認（コントローラ・ユーザーが実施すること）

**このドキュメントを作成したエージェントは Chrome に拡張を読み込んでの実機確認ができない。** 以下の手順を人手で実施し、結果を `WORKLOG.md` に追記してから申請すること。

1. `pnpm build` で `dist/` を生成し、Chrome の「パッケージ化されていない拡張機能を読み込む」で読み込む（既存インストール分は一旦削除するか、テスト用プロファイルを使う）
2. `chrome.storage.local` をクリアした状態（新規インストール相当）で拡張アイコンを見る → **`!` バッジが出ていること**
3. LETUS のコースページを開く → コース検出・DOM注入が起きないこと（DevTools コンソールに「未同意のため停止」等のログが出ることを確認）
4. CLASS の時間割ページを開く → 取り込みトーストが出ないこと
5. ポップアップを開く → 同意画面が表示され、閉じる導線がないこと
6. DevTools の Network タブで、LETUS / CLASS への `fetch` が発生していないことを確認する
7. 同意画面で「同意して始める」を押す → バッジが消え、通常どおりコース検出・スキャンが動くことを確認する
8. `chrome.storage.local` の `termsConsent` を `{version: 0, acceptedAt: "..."}` に書き換える → バッジが復活し、ポップアップが同意画面に戻ることを確認する（規約改定時の再同意動作の検証）
9. 英字入り科目ID（例 `9975A06`）を持つコースで、時間割からの自動選択が機能することを確認する
10. 課題を提出したあと、LETUSページ上のバッジと課題ページ右下の表示が「提出済み」に更新されることを確認する

すべて合格したら `WORKLOG.md` の「実機検証」欄にチェックを入れる。

---

## 8. 提出

1. §1.5 の手順で規約URLを公開し、200を確認する
2. Store listing / Privacy / パッケージ を保存
3. §7 の実機確認を完了する
4. 「審査に送信」。初回は数営業日かかることがあります

---

## 検証ログ（本ドキュメント作成時点、2026-07-10）

```
$ pnpm vitest run src
 Test Files  81 passed (81)
      Tests  659 passed (659)

$ npx tsc -p tsconfig.app.json --noEmit
(出力なし・exit 0)

$ pnpm build
✓ built in 261ms
  dist/classTimetable.js  2.22 kB
  dist/content.js        14.35 kB
  dist/background.js     17.77 kB
  dist/assets/...

$ npx eslint src
src/core/syllabusParse.ts: no-irregular-whitespace 2件（既存・別件）
src/components/TimetableSection.tsx, TodayTimetable.tsx: exhaustive-deps warning 計4件（既存・別件）
新規エラーなし

$ grep -nE "^[[:space:]]*import[[:space:]{'\"]" dist/classTimetable.js dist/content.js
（ヒット0件）

$ pnpm gen:terms
generated: src/legal/termsBody.ts, landing/terms.html
$ git status --porcelain
（差分なし＝生成物は正典と一致）
```

これは**ソースコードとビルドの機械的検証のみ**であり、実機（Chromeに読み込んでの動作）確認は含まれない（§7参照）。

### 追記（2026-07-11、リクエストペーシング反映後）

リクエストペーシング（§2の変更点サマリ参照）を develop にマージした後の再検証:

```
$ pnpm vitest run src --exclude "**/.claude/worktrees/**"
 Test Files  30 passed (30)
      Tests  244 passed (244)
（注: `pnpm vitest run src` の素の実行は .claude/worktrees/* 配下の他ブランチのテストも拾うため、
  当該worktreeのみを対象にするには上記の --exclude が必要。本ブランチ本来のテストは30ファイル/244件）

$ npx tsc -b        # exit 0
$ pnpm build        # 成功。dist/background.js 18.04 kB（ペーサー分 +0.27 kB）
```

実機確認（2026-07-11、ユーザー実施）: 128リクエストのスキャンが33秒で完走。MV3 service worker は途中で停止せず、Networkのリクエストが等間隔に並ぶことを確認。
