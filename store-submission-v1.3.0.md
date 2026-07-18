# Chrome Web Store 申請チェックリスト — v1.3.0

アップロード用パッケージ: **`letus-task-watcher-1.3.0.zip`**（`dist/` を forward-slash パスで zip 化・Python `zipfile` 生成＝Windows Compress-Archive の backslash 問題を回避）
manifest version: **1.3.0**（**公開中の 1.2.2 からの通常アップデート**。v1.2.2 は 2026-07-17 に Chrome Web Store で公開済み）／ manifest v3 ／ 決済・外部サーバー通信なし（ローカル完結）

## このリリースの中身（v1.2.2 → v1.3.0 の差分）

品質・耐性リリース＋クォーター科目対応。**新しい権限の追加はなし**（自己診断・フィンガープリントは既存fetchレスポンスの解析と `chrome.storage.local` への保存のみ／courseDetector の変更は既存 content script 内／新メッセージ `COURSE_DETECTION_EMPTY` は拡張内部通信）。**外部送信ゼロ・単一用途・データ収集なし・LETUSペーシング（180ms）はすべて v1.2.2 から不変。大学向けリクエスト数は増えていない**（ログアウト検知強化はむしろ無駄なfetchを打ち切る方向）。

1. **クォーター科目（前半・後半）対応**（`feature/quarter-classes`）
   - CLASS が半期科目を同一曜限に2科目積む形式を正しく解釈し、時間割に両科目を表示（従来は片方を捨てていた既存バグも修正）
   - 前半/後半のトグル表示・期間外科目の薄表示・期間はユーザー指定（CLASSは1Q/2Qを公開していないため）
   - 積まれた2科目それぞれに LETUS コースの自動ひも付けが機能することをテストで証明済み
2. **自己診断＝「読み取れませんでした」の正直表示**（`feature/moodle51-resilience` 中核）
   - 純粋層 `src/core/diagnose.ts`（7種の DiagnosticCode）＋診断台帳 `diagnosticsState.ts`（hard/info 区分・連続2回で昇格・LOGGED_OUT は即時）＋ popup/dashboard バナー
   - 矛盾検知: ログイン済みなのに0コース／コースHTML取得成功なのに0活動／締切キーワードはあるのに日付が読めない／既知コースの課題全喪失（**厳密過半の一斉喪失で警告昇格**・1コースのみは正当な非表示とみなし info）
   - 誤検知抑制: 初回スキャン・正当な空コースでは発火しない（迷ったら鳴らさない）。破損時は last-good データを保持し破壊的更新をしない
   - すべて `chrome.storage.local` 内で完結（テレメトリなし・外部送信ゼロ維持）
3. **Moodle 5.x（Bootstrap5世代）耐性**＝将来の LETUS 更新への休眠保険
   - 実 Moodle 5.2（公開デモ）と実 LETUS 4.5.8 の生DOMを採取・比較し、実証ベースで堅牢化（実5.2 fixture を `src/core/fixtures/moodle/` に同梱・PIIなし）
   - courseDetector にハイドレーション耐性: 初回0件時のみ有界 MutationObserver（総予算3秒・必ずdisconnect）で遅延描画を拾い直し。0件確定時はダッシュボード面のみ背景へ能動報告
   - passive 版フィンガープリント（docs リンク/body class を既存レスポンスから読むだけ・**追加リクエストゼロ**）。BS5世代を観測したら情報ノート表示（挙動切替は次版）
   - ログアウト検知を実機SSOチェーン（303→/auth/shibboleth/→学外IdP）に合わせて強化・案内バナーを一本化
4. **バグ修正（実機実証済み）**
   - **未提出課題の提出状況が「不明」になっていた問題を修正**: 実 LETUS の未提出表示は「まだ提出されていません。」で、従来の「未提出」文字列判定に一致していなかった（実機DOMで実証）。EN 表記も追加
   - 「今日」「明日」「あと◯日」等の相対的な締切表記の読み取りに対応（ラベル直後の値形式に限定し、説明文の誤検知を防ぐ設計・レビューで捏造2経路を検出し排除済み）
5. **開発品質**
   - vitest 収集範囲を `src/` に限定（外部ツールのテスト誤収集で FAIL 表示されていたノイズを解消）
   - `fix/syllabus-irregular-whitespace` 回収（lint整理）
   - テスト 297 → **675**（+378・fixture駆動の実DOM経路テスト含む）

## 0. 申請前チェック（機械的検証・2026-07-19）

- [x] `npx vitest run`（bare）→ **48 files / 675 passed / 0 FAIL**
- [x] `pnpm build`（tsc -b 込み）→ 成功
- [x] `pnpm lint` → エラー0（既存 exhaustive-deps warning 4件のみ・不変）
- [x] `dist/classTimetable.js` / `dist/content.js` に `import` 文なし（classic script 健全・grep 0件）
- [x] `dist/manifest.json` の `version` が **1.3.0**、`host_permissions` は `letus.ed.tus.ac.jp` と `class.admin.tus.ac.jp` の2つのみ（**新規ホスト追加なし**）
- [x] SDD（subagent駆動開発）: 実装14タスク×各2レビュア＋最終whole-branchレビュー2本×2周＋修正で計53エージェント・実バグ8件以上を出荷前に検出・修正（相対日付の締切捏造2種・未配線2件・info汚染・バナー到達不能ほか）
- [x] develop へ fold 済み（`ed6268f`・マージ後 675緑を再検証・landing 無変更）
- [ ] **実機確認（未・ユーザーゲート）**: ①新バナーが平常時に**出ない**こと（休眠確認・最重要） ②クォーター科目の表示/トグル/課題出現 ③未提出課題が「未提出」表示になること ④ログアウト状態でバナーが1つだけ出て、ログインで自動回復すること

## 1. パッケージ

1. `pnpm build` で `dist/` を生成（version 1.3.0）
2. `letus-task-watcher-1.3.0.zip` を forward-slash で作成（旧 `letus-task-watcher-1.2.2.zip` はアップロードしないこと）
3. Chrome ウェブストア デベロッパー ダッシュボード → 既存アイテムの「パッケージ」タブから **1.3.0** をアップロード
4. Edge Add-ons にも同じ zip で申請（Edge は現在 v1.2.1 のまま＝1.2.2 未申請なら 1.3.0 で追い越し可）

## 2. ストア掲載の「変更点（What's new）」テキスト

日本語:
```
v1.3.0 の変更点
・クォーター科目(前半・後半)に対応:同じ曜日・時限に重なる2科目を両方表示し、前半/後半の切替表示ができます(期間は科目ごとに設定)。
・読み取れないときは正直にお知らせ:LETUS側の画面変更などで課題やコースを読み取れない場合、自動で検知してお知らせし、最後に取得できたデータを保持します。黙って空になりません。
・ログアウト検知を改善:LETUSからログアウトされている状態をより確実に検知し、案内を1つにまとめました。ログインし直すと自動的に再開します。
・提出状況の判定を修正:未提出の課題が「不明」と表示されることがあった問題を、実際のLETUSの表示に合わせて修正しました。
・「今日」「明日」「あと◯日」のような締切表記も読み取れるようになりました。
・将来のLETUS(Moodle)更新で画面が変わっても壊れにくいよう、内部の読み取り処理を全体的に頑丈にしました。
権限の追加はありません。データはこれまでどおりすべて端末内に保存し、外部へ送信しません。
```

English:
```
What's new in v1.3.0
- Quarter courses (first/second half): timetable cells with two stacked courses now show both, with a first-half/second-half toggle (you choose the period per course).
- Honest "couldn't read" reporting: if LETUS page changes ever break reading your courses or assignments, the extension detects it, tells you, and keeps the last successfully fetched data instead of silently going empty.
- Better logout detection: being logged out of LETUS is now detected reliably, with a single clear banner. Log back in and everything resumes automatically.
- Fixed submission status: unsubmitted assignments could show as "unknown" because LETUS's actual wording didn't match. Now matched to the real page text.
- Relative deadlines like "today", "tomorrow", or "in N days" are now recognized.
- Internal parsing hardened against future LETUS (Moodle) upgrades.
No new permissions. All data stays on your device and is never sent externally.
```

## 3. 単一用途 / 権限 / プライバシー

**v1.2.2 から不変。** 単一用途（LETUS 課題締切の収集・通知＋CLASS 時間割連携）・権限（`storage`/`notifications`/`alarms`＋ホスト2つ）・データ収集なし（端末内完結・外部送信ゼロ）。**今回の変更で権限・通信先・データ取り扱いは一切増えていない**。自己診断は取得済みレスポンスの解析結果（件数・フラグ）を `chrome.storage.local` に保存するのみで、ページ内容そのものの保存も送信もしない。

- 規約URL `https://lms.waiteu.dev/terms`（版2・改定なし＝再同意は発生しない）・プライバシー `https://lms.waiteu.dev/privacy`（申請直前に 200 を再確認）

## 4. 意図的な繰り延べ（次版候補・レビュー済み）

- BS5世代検知時の lenient parse 自動切替（本版は観測記録＋情報ノートまで）
- `bigbluebuttonbn` 等一部コアモジュールの既知リスト追加（LETUS での使用が確認されたら）
- quiz/feedback 系の 5.2 fixture テスト固定（素材は採取済み）
- 締切スキャンの中途ログアウト早期打ち切り（現行は課題スキャン側のみ・実害窓は極小）
