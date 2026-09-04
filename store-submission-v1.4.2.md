# Chrome Web Store 申請チェックリスト — v1.4.2

アップロード用パッケージ: **`letus-task-watcher-1.4.2.zip`**（`dist/` を zip 化・forward-slashパス・24エントリ・約224KB）
manifest version: **1.4.2**（**公開中の 1.4.1 からの通常アップデート**）／ manifest v3 ／ 決済・外部サーバー通信なし（ローカル完結）

## このリリースの中身（v1.4.1 → v1.4.2 の差分）

**保守モードの即時レーン（実害バグの追加是正）。新しい権限の追加はなし・新規ホストなし・外部送信ゼロ不変。**

1. **取込済みなのに表示が古い学期のままになる不具合を修正**
   - 症状: 同一年度内で明示的に学期タブを選んだ後（例: 前期タブをクリック）、後期の時間割を取り込んでも表示が前期のままになる場合があった。`findMissingCurrentSemester`は「あるべき学期がcapturedに有るか」しか見ておらず表示中の学期を見ていないため、取込後に督促カードが消え、指示に従った行動そのものが唯一の警告を消していた（v1.4.1で追加した督促カード自体の設計上のギャップ）
   - 修正: `findStaleDisplayedSemester`を追加（取得済みなのに表示が古い場合に切替先を返す純関数）。ダッシュボード・ポップアップの両方に「◯期の時間割は取込済みです」＋1タップ切替の案内カードを追加
   - あわせて学期の表示切替を「前期／後期／自動」の3択に拡張（クォーターUIの前半/後半/自動パターンを踏襲）。「自動」を選ぶと取込済みの中で最新の学期を常に表示し、pref固定によるこの種の不具合を今後も自分で解除できる
2. **Android配信開始・LP表記の整理（`landing/`のみ・拡張本体は無変更）**
   - リタスのAndroid版配信開始に伴い、lms.waiteu.devの「Android近日公開」表記6箇所＋OG画像を「iOS / Android配信中」へ更新
3. **拡張機能内changelog・ロードマップの更新**
   - `public/changelog.html`: v1.4.2の変更内容、リタスのフェーズ3を「開発中」→「配信中」、モバイルアプリ節を配信開始の告知に更新

## 0. 申請前チェック（機械的検証・2026-09-04）

- [x] `pnpm exec vitest run src` → **50 files / 736 passed / 0 FAIL**（v1.4.1 の 725 → +11）
- [x] `pnpm exec tsc -b` → エラー0
- [x] `pnpm run lint` → エラー0（既存 exhaustive-deps warning 4件のみ・不変）
- [x] `pnpm run build` → 成功
- [x] `dist/content.js` / `dist/classTimetable.js` に `import` 文なし（grep 0件）
- [x] `dist/manifest.json` の `version` = **1.4.2**、`host_permissions` は `letus.ed.tus.ac.jp` / `class.admin.tus.ac.jp` の2つのみ（**新規ホスト・新規権限なし**）
- [x] zip 内パスに backslash なし（`unzip -l` grep 0件）・24エントリ
- [x] develop へ push 済み（`365de14`=拡張本体のB+F修正、`c246294`/`203438c`/`642995b`=LP・OG画像・一時告知）
- [ ] 実機確認（未・ユーザー操作待ち）: 同一年度内で明示的に学期タブを切り替えた状態を作り、別学期を取り込んでも表示が追随しない状態を再現 → 案内カードが出ること・1タップ切替が効くこと／学期トグルの「自動」を選ぶと最新取込へ追随すること

## 1. ストア掲載文の更新（提出時）

**「新機能」欄（コピペ用・JP）**
```
時間割の学期表示が古いままになる場合を検知し、1タップで切り替えられるようにしました。学期の表示切替も「前期／後期／自動」の3択になりました。
```

**"What's new" field（コピペ用・EN）**
```
Detects when the timetable display is stuck on an old term and lets you switch it with one tap. The term switch is now a 3-way choice: Spring / Fall / Auto.
```

**Long description本文**: `store-assets/description.txt`（JP）／`store-assets/description-en.txt`（EN）を今回更新済み（週間カレンダー・クォーター対応の機能追記が抜けていたため合わせて反映、「新機能」節をv1.4.2へ差替え、末尾にリタスの配信開始告知を追加）。ストアの詳細説明欄へそのまま貼り付け可能。

**Edge Partner Center「Notes for certification」（コピペ用・EN）**
```
This update fixes a bug where the timetable display could remain stuck on the previous academic term even after the current term's data was imported, and adds a one-tap way to switch it. No new permissions or hosts were added. The extension can be fully evaluated without a Tokyo University of Science account: install it, and the popup/dashboard UI (course list, deadline list, settings) is visible immediately. Full functionality (fetching real assignment/timetable data) requires a login session at letus.ed.tus.ac.jp and class.admin.tus.ac.jp, which we cannot provide a test account for (university-issued credentials only) — this is unchanged from prior approved versions.
```

- データセーフティ/権限の申告変更: **なし**（収集項目・送信先・権限とも v1.4.1 から不変）

## 2. 申請方針

- **保守モード方針により Chrome/Edge 同日申請**（版差を審査期間差だけに縮める）
- 締切の実態: 描画時判定のバグのため9/11必達ではないが、Edge審査は数日〜2週間の実績があるため早めの申請を推奨。着地までのつなぎとして、lms.waiteu.devに一時告知（手動回避策の案内）を掲載済み（`642995b`。解消後に削除予定）
