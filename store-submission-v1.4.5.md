# Chrome Web Store / Edge Add-ons 申請チェックリスト — v1.4.5

作成: 2026-10-14（新バージョンLTW開発ハブ）。**提出と push は本人の操作。** 版を切るかの判断は板（既定＝v1.4.5 として出す）。

## このリリースの中身（v1.4.4 → v1.4.5 の差分）

利用者に届く変更（`src/` と `public/` の差分は `background.js` と `manifest.json` の2ファイルだけ）:

1. **締切スキャン中にログアウトしても、保存済みの締切を消さない**（`33b916c`）
   - 以前: 締切の確認の途中で LETUS のログインが切れると、ログイン画面から「締切なし・状態不明」を作って、保存済みの締切と提出状態を上書きしていた。
   - 今回: ログアウトを検知したら残りを取得せず、何も上書きせずに「LETUSにログインしていないため更新できませんでした。」で中断する。
2. **コースにWeb会議（BigBlueButton）やサブセクションがあっても、未対応モジュールの注意を出し続けない**（`c8cf121`）
   - Moodle 4.5 の標準アクティビティ全24種のうち、この2種だけが未登録だった。スキャン対象は変えない（表示だけ）。

利用者に見えない変更: 版数（1.4.5）・サイレントアップデート対象への追加（`SILENT_UPDATE_VERSIONS`）・テスト追加・検証スクリプト。

## 版数の案

**1.4.5**（パッチ版・既定）。理由: 機能追加がなく不具合修正のみ。v1.4.3・v1.4.4 と同じくサイレントアップデート（更新後に changelog を開かない）にする。権限・通信先・収集項目は不変。

## 0. 申請前チェック（機械的検証・2026-10-14）

| 項目 | 結果 |
|---|---|
| 全テスト | 770件 通過 |
| `tsc -b`（ビルドの型検査） | エラー0 |
| `npm run lint` | エラー0（既存の警告4件） |
| `dist/manifest.json` の版 | 1.4.5 |
| 提出 zip | `letus-task-watcher-1.4.5.zip`（リポ直下・gitignore対象・208,382バイト・19ファイル＋ディレクトリ5） |
| 1.4.4 との差 | `background.js`・`manifest.json` の2ファイルのみ |
| 提出物の指紋 | `store-submission-v1.4.5.sha256`（19ファイル・公開後の照合に使う） |

⚠ 型検査は `tsc --noEmit` でなく **`tsc -b`**（ビルドが使う方）で確かめる。前者はこのリポの構成では全ファイルを見ない（10/14に自分のテストの型エラーを通してしまった）。

## 1. ストア掲載文（提出時）

**「新機能」欄（コピペ用・JP）**
```
LETUSからログアウトされた状態でも、保存済みの締切が消えないよう修正しました。
```

**"What's new" field（コピペ用・EN）**
```
Fixed: if you are logged out of LETUS while deadlines are being checked, your saved deadlines are no longer cleared.
```

（Web会議・サブセクションの注意表示は目に付かない修正なので、新機能欄には書かない。）

**Edge Partner Center「Notes for certification」（コピペ用・EN）**
- 前提: 「テスターに資格情報が必要ですか？」は「はい」のまま（過去の承認済みの版と同じ）。
```
This update (v1.4.5) contains two bug fixes: (1) if the user is logged out of LETUS while a deadline check is running, the extension now stops and keeps the previously saved deadlines instead of overwriting them; (2) two standard Moodle activity types (BigBlueButton and subsection) are no longer reported as unsupported. No new permissions or hosts, and no new network requests.

The extension can be installed, and its popup/dashboard UI is visible without a Tokyo University of Science account. Full functionality requires a login session at letus.ed.tus.ac.jp and class.admin.tus.ac.jp, for which we cannot provide a test account (university-issued credentials only). This is unchanged from prior approved versions.
```
- データセーフティ/権限の申告変更: **なし**。ストア掲載画像・説明欄の本文は**変更なし**（今回は見出し等の差し替えも不要）。

## 2. 提出手順（本人・約15分）

1. 板で「v1.4.5 を切る」を確認（既定）。develop の push が済んでいることを確認する。
2. **Chrome ウェブストア**: パッケージ → 新しいパッケージをアップロード → `letus-task-watcher-1.4.5.zip`。「新機能」欄に §1 の日本語を貼る。提出。
3. **Edge アドオン**: 同じ zip を更新としてアップロード。「Notes for certification」に §1 の英文。提出。
4. 提出したら私へ「提出した」と伝える。**公開確認の見張りタスク（毎日 9:30）をその時に作る**（`scripts/verify-published-package.py --hashes store-submission-v1.4.5.sha256 --expect-version 1.4.5`）。

## 3. 提出結果

（未提出）
