# Moodle 5.2 実DOM fixture（Mount Orange）

BS5世代（Moodle 5.0〜5.3・Bootstrap5＋再設計Dashboard）に対する回帰fixture（spec §6）。
合成マークアップではなく、公開デモサイトの**実HTML**をトリムしたもの。

- **由来**: Mount Orange（`school.moodledemo.net`・Moodle 5.2・毎時リセットの公開デモサイト）。
- **採取日**: 2026-07-18。ハブセッションが curl（cookie jar＋logintoken）でデモ学生 `student` としてログインし取得した**生HTML**（=拡張の背景fetchが見るもの・クライアント描画前）。
- **採取物一式（フル版）**: `lms-task-watcher-develop` リポの `docs/fixtures-capture/moodle52-mountorange/`（worktree外・README.md に台帳と実測事実）。
- **個人情報**: 含まない。公開デモサイトのデモデータのみ。**TUS実機由来の内容は一切コピーしていない**。
- **テスト**: `src/core/moodle52Fixtures.test.ts`（Vite `?raw` import で実関数を通す）。

## トリム方針

- 各ファイル内の `<!-- 中略 -->` / `<!-- 後略 -->` コメント位置で head・ナビ・フッタ・スクリプト塊・無関係ブロックを削除（60KB目安）。
- パーサが消費する構造は**原文のまま維持**: body開始タグ（class一覧）・`M.cfg = {...}` 行（`<script>` で再ラップ）・全アンカー・activity-dates・提出ステータステーブル・活動一覧の li 構造。
- `course52_raw.html` のみ、60KB目安に収めるため**行頭空白（インデント）だけを機械的に除去**（`sed 's/^[ \t]*//'`）。タグ・属性・テキスト・改行は原文どおりで、正規表現／DOMどちらのパースにも影響しない。

## ファイル台帳

| ファイル | 元ファイル（採取物） | 収録範囲 | 物証（このfixtureが証明する事実） |
|---|---|---|---|
| `my52_raw.html` | `my_raw.html`（RAW `/my/`・EN） | body開始タグ＋M.cfg行＋`block_myoverview` セクション全体（loading placeholder含む） | **RAW Dashboardに `course/view.php` アンカー0件**＝BS5世代はコース発見面が全面クライアント描画。`data-totalcoursecount="19"`（SSRは登録数を知っているのにアンカーは出さない）。docsリンク無し＝版判定は body class フォールバック |
| `course52_raw.html` | `course_62_raw.html`（RAW `/course/view.php?id=62` Psychology in Cinema・EN） | body開始タグ＋M.cfg行＋modアンカーを含む2ブロック（Key terms / Activity results）＋`course-content` の活動一覧全section（li構造原文維持） | **5.2でも活動一覧はSSR維持**: mod-anchor 22件（一意URL 20件・quiz 723とglossary 719がブロックと本文で重複）・assign 4件（id=715/716/724/748）＝背景の課題・締切スキャンはBS5世代でも生存 |
| `assign52_ja.html` | `assign_724_ja.html`（RAW `/mod/assign/view.php?id=724` `?lang=ja`） | body開始タグ＋M.cfg行＋ページヘッダ（activity-dates含む）＋活動説明＋提出ステータステーブル | JAラベル「開始:」「期限:」・日付書式「2023年 12月 12日(火曜日) 00:00」＝現行パーサで締切取得可。**未提出の状態値「まだ提出されていません。」**（現行 `extractSubmissionStatus` の「未提出」includes に不一致＝unknown に落ちる実ギャップ・TUS実機4.5.8でも同値を確認済）。「最終更新日時」行（未提出時は「-」） |
| `assign52_en.html` | `assign_724_raw.html`（同ページ・EN） | 同上 | ENラベル「Opened:」「Due:」・書式「Tuesday, 12 December 2023, 12:00 AM」＝**現行regexでパース不能**（キーワードは見つかる）→ `DEADLINE_KEYWORD_NO_DATE` 診断の題材。未提出値「No submissions have been made yet」も unknown（特性固定） |

## 注意

- URL中の id（62/724等）はデモサイトの毎時リセットで揮発する値。**構造が正典**であり、id の実値に意味はない。
- `extractSubmissionStatus` の unknown アサートは**現状の挙動の特性固定**。P3（状態文字列セット補完）が修正する際にテストも更新される想定。
- ログアウト応答のfixtureはここに無い: Mount Orange の course62 はゲストアクセス許可で `/login/` リダイレクトが発生しないため代替不可（TUS実機の実ログアウト応答は spec §9-7・PII制約によりfixture化しない）。
