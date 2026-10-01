# Chrome Web Store / Edge Add-ons 申請チェックリスト — v1.4.4

アップロード用パッケージ: **`letus-task-watcher-1.4.4.zip`**（`dist/` を zip 化・forward-slashパス・24エントリ・約209KB・gitignore対象＝リポ直下に作成済み）
manifest version: **1.4.4**（**公開中の 1.4.3 からの通常アップデート**）／ manifest v3 ／ 決済・外部サーバー通信なし（ローカル完結）
**提出日（提案・本人裁定済み＝「全部推奨で」2026-10-01）: 2026-10-10（土）。決め事は10/8（木）までに揃える。**

## このリリースの中身（v1.4.3 → v1.4.4 の差分）

**利用者に見える機能変更なし・新しい権限の追加なし・新規ホストなし・外部送信ゼロ不変。サイレントアップデート（changelogを開かない）。**

1. **`runAutoScan` が失敗時も「更新成功」を記録していた不具合を修正**（`2b867ca`）
   - 課題・締切のどちらかの取得が失敗しても `lastSuccessfulRefreshAt` が更新され、画面の「最終更新」が新しいまま古いデータが隠れていた。両方成功した時だけ更新する。回帰テストあり
2. **未登録年度（2027以降）の学期判定が9月いっぱい前期になる穴を修正**（`d0ba9c7`）
   - 後期の開始日が未確定の年度は、登録済みで最新の年度（現状2026=9/11）の月日を推定値として使う。2027年度から効く。限界（実際が推定より遅い年は開始前に督促が出る・空の後期表を取り込みうる既知の欠陥は未解消）はコード注釈に明記
3. **同梱 `welcome.html` のリタス紹介を「配信中」へ**（`4183b1d`）。新規インストール時のみ表示。既存利用者の画面は変わらない
4. **「対象コースの選択」の説明に1文を追記**（`2908e03`）。コースの一覧は、LETUSのマイページを開いたときに読み取ること／後期の科目が見当たらないときの手順。検出ロジックは不変
5. **サイレントアップデート**: `src/background/index.ts` の `SILENT_UPDATE_VERSIONS` に `1.4.4` を追加（`1.4.3` も維持）。`public/changelog.html` は **v1.4.2 の内容のまま**据え置き（changelogを出す場合はリタス情報の掲載が要る＝CLAUDE.md）

## 0. 申請前チェック（機械的検証・2026-10-01）

- [x] `pnpm vitest run src` → **50 files / 748 passed / 0 FAIL**（サイレント判定を1.4.3・1.4.4の2版で検証するよう拡張）
- [x] `pnpm exec tsc -b` → エラー0
- [x] `pnpm run lint` → エラー0（既存 exhaustive-deps warning 4件のみ・不変）
- [x] `pnpm run build` → 成功、`dist/manifest.json` の `version` が 1.4.4、`dist/changelog.html` はサイレント方針により意図的に v1.4.2 表記のまま
- [x] `dist/content.js` / `dist/classTimetable.js` に `import` 文なし（0件）
- [x] `dist/manifest.json` の `host_permissions` は `letus.ed.tus.ac.jp` / `class.admin.tus.ac.jp` の2つのみ・`permissions` は `storage` / `notifications` / `alarms`（**新規ホスト・新規権限なし**）
- [x] **作った版が入っていることを成果物で確認**: `dist/assets/*.js` に追記した1文が1ファイルに存在／`dist/welcome.html` に「iOS・Androidどちらでも配信中です」／旧マークの署名（`#863bff`・稲妻パス）は `dist/` に0件
- [x] zip 内パスに backslash なし・24エントリ・zip内の `manifest.json` の version が 1.4.4

## 1. ストア掲載文の更新（提出時）

**サイレントアップデート方針のため、「新機能」欄は一般的な文言に留める：**

**「新機能」欄（コピペ用・JP）**
```
軽微な改善を行いました。
```

**"What's new" field（コピペ用・EN）**
```
Minor improvements.
```

**Long description 本文（日本語のみ変更）**: `store-assets/description.txt` の見出し1行だけを更新する。
- 変更前: `■ このバージョンの新機能（v1.4.2）`
- 変更後: `■ v1.4.2 で追加した新機能`
- 理由: 表示版が1.4.3以降のとき「このバージョンの」は文字通りには合わない。英語版（`description-en.txt`）は「New in v1.4.2」で既に版固定の表現＝**変更なし**
- 説明欄だけの更新でも両ストアの再審査が要るため、本パッケージの提出に同梱する

**Edge Partner Center「Notes for certification」（コピペ用・EN）**
```
This update contains internal bug fixes and one added sentence of guidance text in the course-selection settings. No new features, no new permissions or hosts. The extension can be fully evaluated without a Tokyo University of Science account: install it, and the popup/dashboard UI (course list, deadline list, settings) is visible immediately. Full functionality (fetching real assignment/timetable data) requires a login session at letus.ed.tus.ac.jp and class.admin.tus.ac.jp, which we cannot provide a test account for (university-issued credentials only) — this is unchanged from prior approved versions.
```

- データセーフティ/権限の申告変更: **なし**（収集項目・送信先・権限とも v1.4.3 から不変）
- ストア掲載画像（アイコン・プロモタイル・スクリーンショット）は今回**差し替え不要**（v1.4.3で新意匠に更新済み）

## 2. 申請方針

- **保守モード方針により Chrome/Edge 同日申請**（版差を審査期間差だけに縮める）
- 審査期間の実績: Chromeは速い（当日〜数日）。Edgeはばらつきあり（v1.4.2は当日、v1.2.1は2週間以上の実績）
- 提出は本人の操作（Chromeはブラウザの制限でこちらから操作できない）。Edge Partner Center は本人許可のもとで操作可能だった実績あり
- **この版が届くまで利用者に届いていないもの**: `2b867ca`（9/18〜）・`4183b1d`（9/25〜）・`d0ba9c7`（9/30〜）。2027年度の学期境界の修正は**配信版に載るまで完了ではない**（受け皿は2027-08-25の定期タスク `ltw-koki-observation-2027-backstop`）

## 3. 提出結果

（未提出。提出後にここへ記録する）
