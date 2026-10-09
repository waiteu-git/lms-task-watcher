# Chrome Web Store / Edge Add-ons 申請チェックリスト — v1.4.4

アップロード用パッケージ: **`letus-task-watcher-1.4.4.zip`**（`dist/` を zip 化・forward-slashパス・24エントリ・209,579バイト・gitignore対象＝リポ直下に作成済み・**2026-10-08に土曜表示の修正を入れて作り直した**）
manifest version: **1.4.4**（**公開中の 1.4.3 からの通常アップデート**）／ manifest v3 ／ 決済・外部サーバー通信なし（ローカル完結）
**提出日（本人裁定済み＝「全部推奨で」2026-10-01）: 2026-10-10（土）。10/8に問い合わせで土曜表示の不具合の報告があり、修正を同梱した（本人「修正して出そう」）＝準備が済んでいるので、本人が提出できる日に前倒ししてよい。**

## このリリースの中身（v1.4.3 → v1.4.4 の差分）

**利用者に見える変更は「土曜に授業がある人の時間割表示の修正」と「コース選択の説明1文」だけ。新しい権限の追加なし・新規ホストなし・外部送信ゼロ不変。サイレントアップデート（changelogを開かない）。**

1. **土曜に授業がある学生の時間割が表示されない不具合を修正**（`6931660`・問い合わせで報告・2026-10-08）
   - 原因: CLASSの時間割は月〜土の6列で、取り込みと保存は土曜も正しかったが、**表示側が土曜を落としていた**。ダッシュボードの時間割グリッドが月〜金の5列固定で土曜の授業が描画されず、ポップアップは土日を「翌月曜」として扱うため、土曜に授業がある人でも土曜の朝に「月曜」の授業を出していた
   - 修正: グリッドは**土曜に授業が1件でもあるときだけ**6列目に土曜を足す（授業が無い人の5列の見た目は変えない）・土曜当日は「今日」を強調。ポップアップは、土曜に授業がある時間割なら土曜は「今日（土）」として当日の授業を出す（授業が無い人の土曜と日曜は従来どおり翌月曜・平日は当日）
   - 検証: 実コンポーネントをjsdomで描画する回帰テスト（修正前のコードで土曜の3件が落ちることを確認してから実装）＋負の対照（土曜に授業が無い時間割は5列のまま・土曜に翌月曜・日曜は翌月曜・平日は当日）。実ブラウザでも1280px・760pxで6列、土曜の授業なしで5列（不変）を目視確認
2. **`runAutoScan` が失敗時も「更新成功」を記録していた不具合を修正**（`2b867ca`）
   - 課題・締切のどちらかの取得が失敗しても `lastSuccessfulRefreshAt` が更新され、画面の「最終更新」が新しいまま古いデータが隠れていた。両方成功した時だけ更新する。回帰テストあり
3. **未登録年度（2027以降）の学期判定が9月いっぱい前期になる穴を修正**（`d0ba9c7`）
   - 後期の開始日が未確定の年度は、登録済みで最新の年度（現状2026=9/11）の月日を推定値として使う。2027年度から効く。限界（実際が推定より遅い年は開始前に督促が出る・空の後期表を取り込みうる既知の欠陥は未解消）はコード注釈に明記
4. **同梱 `welcome.html` のリタス紹介を「配信中」へ**（`4183b1d`）。新規インストール時のみ表示。既存利用者の画面は変わらない
5. **「対象コースの選択」の説明に1文を追記**（`2908e03`）。コースの一覧は、LETUSのマイページを開いたときに読み取ること／後期の科目が見当たらないときの手順。検出ロジックは不変
6. **サイレントアップデート**: `src/background/index.ts` の `SILENT_UPDATE_VERSIONS` に `1.4.4` を追加（`1.4.3` も維持）。`public/changelog.html` は **v1.4.2 の内容のまま**据え置き（changelogを出す場合はリタス情報の掲載が要る＝CLAUDE.md）

## 0. 申請前チェック（機械的検証・2026-10-01）

- [x] `pnpm vitest run src` → **50 files / 748 passed / 0 FAIL**（サイレント判定を1.4.3・1.4.4の2版で検証するよう拡張）
- [x] `pnpm exec tsc -b` → エラー0
- [x] `pnpm run lint` → エラー0（既存 exhaustive-deps warning 4件のみ・不変）
- [x] `pnpm run build` → 成功、`dist/manifest.json` の `version` が 1.4.4、`dist/changelog.html` はサイレント方針により意図的に v1.4.2 表記のまま
- [x] `dist/content.js` / `dist/classTimetable.js` に `import` 文なし（0件）
- [x] `dist/manifest.json` の `host_permissions` は `letus.ed.tus.ac.jp` / `class.admin.tus.ac.jp` の2つのみ・`permissions` は `storage` / `notifications` / `alarms`（**新規ホスト・新規権限なし**）
- [x] **作った版が入っていることを成果物で確認**: `dist/assets/*.js` に追記した1文が1ファイルに存在／`dist/welcome.html` に「iOS・Androidどちらでも配信中です」／旧マークの署名（`#863bff`・稲妻パス）は `dist/` に0件
- [x] zip 内パスに backslash なし・24エントリ・zip内の `manifest.json` の version が 1.4.4

## 0-b. 10/6 の再検証（統合ハブの稼働開始の合図を受けて・**土曜表示の修正を入れる前の時点**）

- [x] HEAD（`729bb37`）で `vitest` 748件通過・`tsc` エラー0・`lint` エラー0（既存警告4件のみ）
- [x] **HEADから作り直した `dist/` は、パッケージ済み `letus-task-watcher-1.4.4.zip` の中身と完全一致**（`diff -r` で差分なし・24ファイル・約209KB）＝10/1以降にコードが動いていても、zip は現行HEADと同じ
- [x] v1.4.3 → HEAD のソース差分は `App.tsx`（説明1文）・`background/index.ts`（runAutoScan・サイレント対象）・`timetableLink.ts`（学期境界）・`welcome.html`・`manifest.json` のみ。**ネットワーク・ストレージ・権限に関わる追加コード0件**（`fetch`／`chrome.storage`／`sendMessage`／権限の追加行を数えて0）＝プライバシー・透明性ページの記述（「対象: v1.4.2」）は9/17裁定どおりそのままでよい
- [x] 個人情報の検査 `scan-private-terms.sh --check` は通過（語は出ない）
- [x] 公開側: 認証ページ5枚は301でトップへ（10/6も維持）・Edge掲載版は 1.4.3（提出前の想定どおり）
- [x] 説明欄（`description.txt`／`description-en.txt`）の主張を現行のコード・公開状態と突き合わせ: 変更が要るのは日本語の見出し1行だけ（上記）。リタスの「iOS・Androidで配信中」は9/24〜25の製品版に一致

## 0-c. 10/8 の再検証（土曜表示の修正を同梱した後・提出用に作り直したzip）

- [x] `pnpm vitest run src` → **51 files / 767 passed / 0 FAIL**（748件に土曜の回帰テスト19件を追加＝純関数12件・実コンポーネント7件。実コンポーネントのテストは、修正前のコードで3件〔グリッドの土曜列・土曜列がある時間割での平日の強調・土曜のポップアップ〕が落ちることを確認してから実装した）
- [x] `pnpm exec tsc -b` エラー0・`pnpm run lint` エラー0（既存警告4件のみ・不変）
- [x] **作った版が入っていることを成果物で確認**: 共有チャンク（`dist/assets/diagnosticsState-*.js`）に `visibleDays`／`hasSaturdayClasses`／`resolveDisplayDay(now, slots)` が入っている（土曜のキー `sat`・土曜は授業があるときだけ6列目）。追記した説明1文も `dist/assets/index-*.js` に存在
- [x] `letus-task-watcher-1.4.4.zip` を作り直し、**zipの中身は `dist/` と完全一致**（`diff -r` 差分なし・24ファイル・209,579バイト・zip内 `manifest.json` の version が 1.4.4・backslash パスなし）
- [x] `dist/content.js`／`dist/classTimetable.js` に `import` 文なし・`host_permissions` は `letus.ed.tus.ac.jp`／`class.admin.tus.ac.jp` の2つのみ・`permissions` は `storage`／`notifications`／`alarms`
- [x] v1.4.3 → HEAD のソース差分に、**ネットワーク・ストレージ・権限に関わる追加コード0件**（`fetch`／`chrome.storage`／`sendMessage`／権限の追加行を数えて0）＝プライバシー・透明性ページの記述（「対象: v1.4.2」）はそのままでよい
- [x] 個人情報の検査 `scan-private-terms.sh --check` 通過・push ガードの模擬実行は出力なし
- [x] 公開テキスト（LP・説明欄・welcome）に「月〜金のみ」「平日のみ」と読める記述は無い（土曜対応と矛盾しない）
- ⚠**未検証**: 土曜に授業がある学生の**実際のCLASS時間割**での確認（報告者の時間割は未入手・テストは実CLASS構造の見本と合成データ）。報告の文面にある症状と、この修正が直す2つの症状（グリッドに土曜が出ない／土曜のポップアップが月曜になる）が一致するかは、報告者に確認できていない

## 1. ストア掲載文の更新（提出時）

**サイレントアップデート（changelogを開かない）は維持。ただし今回は利用者に見える修正があるため、「新機能」欄は土曜の修正に触れる文言にする（✅本人裁定 2026-10-08＝案A・統合ハブ経由）：**

**「新機能」欄（コピペ用・JP）＝確定**
```
土曜日に授業がある場合、時間割とポップアップに土曜日の授業が表示されるようになりました。
```

**"What's new" field（コピペ用・EN）＝確定**
```
Fixed: Saturday classes now appear in the timetable and in the popup's daily view.
```

（不採用＝従来案: JP「軽微な改善を行いました。」／EN「Minor improvements.」）

**Long description 本文（日本語のみ変更）**: `store-assets/description.txt` の見出し1行だけを更新する。
- 変更前: `■ このバージョンの新機能（v1.4.2）`
- 変更後: `■ v1.4.2 で追加した新機能`
- 理由: 表示版が1.4.3以降のとき「このバージョンの」は文字通りには合わない。英語版（`description-en.txt`）は「New in v1.4.2」で既に版固定の表現＝**変更なし**
- 説明欄だけの更新でも両ストアの再審査が要るため、本パッケージの提出に同梱する

**Edge Partner Center「Notes for certification」（コピペ用・EN・1,010文字＝上限2,000未満）**
- 前提: 「拡張機能をテストするためにテスターに資格情報…が必要ですか？」は **「はい」のまま**（実データの取得には大学発行のログインが要り、テスト用アカウントを渡せないため。過去の承認済みの版と同じ）。「はい」を選ぶと下の欄が必須になる。
```
This update (v1.4.4) contains internal bug fixes, a fix so that Saturday classes appear in the timetable grid and in the popup's daily view, and one added sentence of guidance text in the course-selection settings. No new permissions or hosts, and no new network requests.

The extension can be installed, and its popup/dashboard UI (course list, deadline list, settings) is visible without a Tokyo University of Science account. Full functionality (fetching real assignment and timetable data) requires a login session at letus.ed.tus.ac.jp and class.admin.tus.ac.jp, for which we cannot provide a test account (university-issued credentials only). This is unchanged from prior approved versions.

The Saturday fix only changes how an already-imported timetable is displayed: the dashboard grid adds a Saturday column when the timetable contains a Saturday class, and on a Saturday the popup shows that day's classes. It cannot be exercised without a real CLASS timetable, so it is covered by automated tests.
```

- データセーフティ/権限の申告変更: **なし**（収集項目・送信先・権限とも v1.4.3 から不変）
- ストア掲載画像（アイコン・プロモタイル・スクリーンショット）は今回**差し替え不要**（v1.4.3で新意匠に更新済み）

## 2. 申請方針

- **保守モード方針により Chrome/Edge 同日申請**（版差を審査期間差だけに縮める）
- 審査期間の実績: Chromeは速い（当日〜数日）。Edgeはばらつきあり（v1.4.2は当日、v1.2.1は2週間以上の実績）
- 提出は本人の操作（Chromeはブラウザの制限でこちらから操作できない）。Edge Partner Center は本人許可のもとで操作可能だった実績あり
- **この版が届くまで利用者に届いていないもの**: **土曜表示の修正（`6931660`・10/8〜・報告者を含め土曜に授業がある学生が待っている）**・`2b867ca`（9/18〜）・`4183b1d`（9/25〜）・`d0ba9c7`（9/30〜）。2027年度の学期境界の修正は**配信版に載るまで完了ではない**（受け皿は2027-08-25の定期タスク `ltw-koki-observation-2027-backstop`）

## 2-b. 提出手順（本人・約15分）

1. **Chrome ウェブストア（デベロッパー ダッシュボード）**: LETUS Task Watcher → パッケージ → 新しいパッケージをアップロード → `letus-task-watcher-1.4.4.zip`（リポ直下・`~/dev/lms-task-watcher-develop/`）。ストアの掲載情報 → 詳細説明（日本語）の見出し1行を差し替え（上記 §1）。提出。
2. **Edge アドオン（Partner Center）**: 同じzipを更新としてアップロード。「Notes for certification」に §1 の英文を貼る。詳細説明（日本語）の見出し1行を差し替え。提出。
3. 提出後は **§3 に提出日・状態を記録**する（保存画面でなく「審査中」の一覧表示で確かめる）。

## 2-c. 提出後の作業（提出日に依存しない相対条件）

- **「両ストアで公開された版が 1.4.4 になったら」**: ①`main` を develop と再同期する（theirs-tree 方式・コミットは私が作る・**pushは本人**）。10/6時点で `origin/main` は `origin/develop` より15コミット遅れている（9/25に`13b6f8f`へ同期した後のdevelopの積み増し）。②メモリ `ltw-state-and-backlog` の「v1.4.4待ち」を「配信済み」へ直し、**2027年度の学期境界の修正（`d0ba9c7`）が配信版に載ったことを実物で確認**してから「完了」とする（定期タスク `ltw-koki-observation-2027-backstop`＝2027-08-25 の確認項目）。
- 気づく主体: 提出前の確認は 10/8 9:30 の `ltw-v144-presubmit-check-1008`（完了済み・その後の土曜の修正で zip を作り直した）。**提出後の公開確認は定期タスク `ltw-v144-publication-watch`（毎日 9:30）が、上の検証スクリプトで両ストアの公開中パッケージを提出した中身と突き合わせる**。公開が確認できたら、記録・`main`再同期の候補・報告者への返信案・本人と統合ハブへの報告まで行う（push は本人）。

## 3. 提出結果

- **2026-10-08（16時台）: Chrome ウェブストア・Edge アドオンの両方を審査に提出済み**（本人の申告。各ダッシュボードの「審査中」表示は私は未確認）。提出したパッケージ＝`letus-task-watcher-1.4.4.zip`（10/8 15:58作成・209,579バイト・19ファイル）。各ファイルのSHA-256は `store-submission-v1.4.4.sha256`（zipはgitignoreで消えうるため）。
- 提出時に決めていた内容（本人の裁定）: 「新機能」欄＝土曜の修正に触れる文言（案A）／Edge「Notes for certification」＝§1の英文（1,010文字・「はい」を選択）／日本語説明欄の見出し1行の差し替え。**実際に各欄へ入れたかの詳細は未確認**（見出しの差し替えを忘れていても、掲載の見出しが「このバージョンの新機能（v1.4.2）」のまま残るだけで害は小さい）。
- 公開の確認（版番号でなく**中身で**確かめる）: `python3 scripts/verify-published-package.py --hashes store-submission-v1.4.4.sha256 --expect-version 1.4.4`。両ストアの更新エンドポイントから公開中のパッケージを取得し、提出した各ファイルとSHA-256で突き合わせる（ストアが足す `update_url` と `_metadata/` は比較から外す。**公開中の v1.4.3 で、18ファイルが完全一致・manifest.json は `update_url` を除いて一致、と実測済み**＝この方法は正しく働く）。終了コード 0＝両ストアで一致／1＝版は公開されたが中身が違う／2＝まだ公開されていない／3＝取得失敗。10/8時点＝両ストアとも 1.4.3（exit 2）。
- 公開の見張り: 定期タスク `ltw-v144-publication-watch`（毎日 9:30・公開を確認したら自分で止まる・10/22を過ぎても未公開なら本人へ上げる）。公開後の作業は §2-c。
- ✅**公開確認済み（2026-10-09 09:34・定期タスク `ltw-v144-publication-watch`）**: `verify-published-package.py` の終了コード 0。出力＝「[Edge] 版 1.4.4・19ファイルが提出した zip と完全一致」「[Chrome] 版 1.4.4・19ファイルが提出した zip と完全一致」「RESULT: 両ストアとも一致」。更新エンドポイントからの取得で、管理画面は見ていない（10/8夜にLTW開発ハブが同じ結果を実測済み＝提出から約6時間で公開）。土曜表示の修正（`6931660`）と2027年度の学期境界の修正（`d0ba9c7`）は、このzipを作ったコミットの祖先＝配信版に入っている。§2-c の残り＝`main` の再同期（候補ブランチ `sync-main-candidate`・push は本人）。
