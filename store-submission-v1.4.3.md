# Chrome Web Store 申請チェックリスト — v1.4.3

アップロード用パッケージ: **`letus-task-watcher-1.4.3.zip`**（`dist/` を zip 化・forward-slashパス・24エントリ・約208KB）
manifest version: **1.4.3**（**公開中の 1.4.2 からの通常アップデート**）／ manifest v3 ／ 決済・外部サーバー通信なし（ローカル完結）

## このリリースの中身（v1.4.2 → v1.4.3 の差分）

**保守モードの即時レーン（意匠のみの刷新）。機能変更なし・新しい権限の追加なし・新規ホストなし・外部送信ゼロ不変。**

1. **アイコン・ブランディングの刷新**
   - 経緯: 拡張機能のアイコン（稲妻モチーフ・色`#863bff`）が、`npm create vite`雛形が残す`src/assets/vite.svg`（Viteの商標ロゴ）を平行移動・着色しただけの意匠だったと判明（形・色ともVite公式と一致）。開発本部が意匠を再設計し、ユーザー裁定（2026-09-11）で新意匠「足つきT」（朱`#CF4E2A`の角丸容器に白のT、LとTの合字）を採用
   - 新意匠の座標はすべて開発本部の手計算（フォント・既存ロゴ・アイコンセット・画像生成AI不使用）。採用前に画像検索（Googleレンズ・色付き＋シルエット）で既存アプリとの酷似なしを確認済み
   - 反映範囲: `manifest.json`のicons（16/32/48/128px）、`public`/`landing`のfavicon一式・apple-touch-icon、Chrome Web Store掲載アイコン、Edgeストアロゴ（`store-assets/logo-300x300`）、ストア掲載用プロモタイル・スクリーンショット・X告知カード、LPのOG画像。拡張本体のロジック・UIコンポーネントに変更なし
   - 出所の詳細記録: `docs/brand-mark.md`（ローカル限定・gitignore対象。旧意匠の商標由来の経緯と新意匠の採用チェックリストを記載）

2. **✅サイレントアップデート方針（2026-09-11 ユーザー指示）**
   - ユーザー判断: アイコンのみの刷新でありユーザー向けに騒ぎ立てる必要はない＝changelogを出さないサイレントアップデートとする
   - 実装: `src/background/index.ts`に`SILENT_UPDATE_VERSIONS`（現在`{'1.4.3'}`）を追加。`chrome.runtime.onInstalled`の`reason: 'update'`ハンドラで、現在のmanifest版がこの集合に入っていれば`changelog.html`タブの自動オープンをスキップする（既存ユーザーが更新後に何も見せられず終わる＝真の意味でサイレント）。テスト追加済み（`src/background/index.test.ts`「サイレントアップデート対象の版では、フラグ保存済みでもchangelog.htmlを開かない」）
   - `public/changelog.html`・`store-assets/description(.txt/-en.txt)`はv1.4.3向けの編集を撤回し、**v1.4.2の内容のまま**据え置き（manifestのversionだけが1.4.3で、利用者向け文言はv1.4.2表記のまま矛盾するが、これは意図的＝サイレント方針の帰結）
   - ストアの「新機能」欄も同じ方針で、アイコンに触れない一般的な文言に留める（下記1.参照）

## 0. 申請前チェック（機械的検証・2026-09-11）

- [x] `pnpm exec vitest run src` → **50 files / 743 passed / 0 FAIL**（サイレントアップデート判定のテスト1件を追加、それ以外はロジック無変更）
- [x] `pnpm exec tsc -b` → エラー0
- [x] `pnpm run lint` → エラー0（既存 exhaustive-deps warning 4件のみ・不変）
- [x] `pnpm run build` → 成功、`dist/manifest.json`の`version`が1.4.3・`dist/icons/*.png`が新意匠・`dist/changelog.html`はサイレント方針により意図的にv1.4.2表記のままであることを確認
- [x] `dist/content.js` / `dist/classTimetable.js` に `import` 文なし（grep 0件）
- [x] `dist/manifest.json` の `host_permissions` は `letus.ed.tus.ac.jp` / `class.admin.tus.ac.jp` の2つのみ（**新規ホスト・新規権限なし**）
- [x] zip 内パスに backslash なし（`unzip -l` grep 0件）・24エントリ
- [x] 刷新対象PNG（アイコン16/32/48/128・favicon一式・apple-touch-icon・Edgeロゴ・stripe-icon・store-assets掲載アイコン・promo-tile/screenshot/x-card全種・og-image）を目視確認。**再生成漏れ1件を発見・修正済み**＝`store-assets/x-card-v140-calendar-2400x1350@2x.png`が左上1200x675にしか描画されず残り半分が白のままだった不具合（`render.sh`の`--force-device-scale-factor=1`固定と2400x1350の直接指定が原因）。原寸レンダリング＋`--force-device-scale-factor=2`で再生成し、刷新前と同一レイアウトになることを確認（コミット`6af9e76`）
- [x] developへpush済み（v1.4.3アイコン刷新＋リタスマーク刷新本体・`47694d2..c714893`、コミット`c009b2e`込み）。サイレントアップデート化（本チェックリストの2.）は追加コミットとして別途pushが必要（ユーザーの明示的な「push」承認待ち）
- [ ] ストア掲載画像の差し替え（Chrome Web Store・Edge Add-onsの管理画面でアイコン・プロモタイル・スクリーンショットを新意匠のものへ手動アップロード）

## 1. ストア掲載文の更新（提出時）

**サイレントアップデート方針のため、「新機能」欄はアイコンに触れない一般的な文言に留める：**

**「新機能」欄（コピペ用・JP）**
```
軽微な改善を行いました。
```

**"What's new" field（コピペ用・EN）**
```
Minor improvements.
```

**Long description本文**: `store-assets/description.txt`（JP）／`store-assets/description-en.txt`（EN）は**v1.4.2の内容のまま変更なし**（サイレント方針のため、今回の「新機能」節への追記はしない）。ストアの詳細説明欄は現行のまま据え置いてよい。

**Edge Partner Center「Notes for certification」（コピペ用・EN）**
```
This update only refreshes the extension's icon and branding assets. No functional changes, no new permissions or hosts. The extension can be fully evaluated without a Tokyo University of Science account: install it, and the popup/dashboard UI (course list, deadline list, settings) is visible immediately. Full functionality (fetching real assignment/timetable data) requires a login session at letus.ed.tus.ac.jp and class.admin.tus.ac.jp, which we cannot provide a test account for (university-issued credentials only) — this is unchanged from prior approved versions.
```

- データセーフティ/権限の申告変更: **なし**（収集項目・送信先・権限とも v1.4.2 から不変）
- ストア掲載アイコン・プロモ画像は本パッケージのアップロードとは別に、両ストアの管理画面上で個別に差し替えが必要（`store-assets/`配下の更新済みファイルを使用）

## 2. 申請方針

- **保守モード方針により Chrome/Edge 同日申請**（版差を審査期間差だけに縮める）
- 意匠刷新の起点は商標抵触リスクの是正であり期限の緊急性は無いが、外部からの指摘実績（LICENSE ToS問題がX/Twitterで指摘された前例）を踏まえ早期解消を優先
- 審査期間の実績: Chromeは速い（当日〜数日）。Edgeはばらつきあり（v1.4.2は当日、v1.2.1は2週間以上の実績）
