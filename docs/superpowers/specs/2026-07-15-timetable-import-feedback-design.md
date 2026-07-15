# 設計: 時間割「取得した」の表示強化＋初回のみ通知

- 日付: 2026-07-15
- ブランチ: `feature/timetable-import-feedback`（develop分岐）

## 背景・問題

CLASS学生時間割表を取り込んだ（`timetable:${year}:${semester}` を `chrome.storage.local` に保存した）ことを
ユーザーへ伝える手段が弱い。

1. **唯一の即時フィードバックが3秒トーストのみ**。`classTimetable.ts` の `showToast('時間割を取り込みました')` は
   CLASSページ右下に3秒だけ出る汎用文言で、年度・学期・日時を含まない。
2. **ポップアップ/ダッシュボードに取込状態の明示表示がない**。1秒ポーリングで時間割グリッドが黙って差し替わるだけで、
   「取り込み済みか／いつ取り込んだか」を示す表示がない。取込データには `capturedAt`（日時）も保存済みなのに未表示。
3. **OS通知がない**。オンボーディングで時間割取込を先頭ステップに案内するようになった今、
   「取り込めた」達成感を後押しする通知がない。

方針: **表示強化（全ユーザー共通）＋初回取込時のみ1回だけOS通知**。
（初回＝「一度も取り込んでいない状態からの最初の取込」＝グローバル初回。以後の再取込では鳴らさない。）

## スコープ（2パート）

### Part A: 表示強化（共通）

- **A-1. CLASSページのトースト詳細化** — `src/content/classTimetable.ts`
  `capture()` 内の `showToast('時間割を取り込みました')` を
  `` showToast(`${year}年度${semester === 'zenki' ? '前期' : '後期'}の時間割を取り込みました`) `` に変更。
  `year`・`semester` は同関数内の既存局所変数。**import は追加しない**（content script のimportガードに抵触させない）。
- **A-2. 時間割ヘッダに最終取込日時を表示** — `src/components/TimetableSection.tsx`
  `getTimetableCapture` の結果から `capturedAt` を state に保持し、時間割が存在する（`rawHtml !== null`）ときだけ
  ヘッダに `最終取込 {formatDateTime(capturedAt)}` を表示。`formatDateTime` は `src/utils/date.ts` の既存関数を再利用
  （「M/D HH:mm」・無効値は「未更新」）。未取込時は既存の案内文（`timetableEmpty`）のまま。
  必要なら `src/App.css` に軽微なスタイル（`.timetableCapturedAt` など、控えめな muted テキスト）を追加。

### Part B: 初回取込のみOS通知（background）

通知は content script から出せない（`chrome.notifications` は content script で使用不可）。
既存の background `chrome.storage.onChanged`（area==='local'）で `timetable:*` キーの新規セットを検知して通知する。これは技術制約上ほぼ一択。

- **B-1. 新規純ロジック** `src/core/timetableImportNotify.ts`
  - `parseTimetableKey(key: string): { year: number; semester: Semester } | null`
    正規表現 `^timetable:(\d{4}):(zenki|kouki)$` で厳密一致。
    `timetableOverrides:2026:zenki:...`・`timetableView` 等を誤検知しないこと（アンカー必須）。
  - `pickFirstImportNotification(setKeys: string[], alreadyNotified: boolean): { year: number; semester: Semester } | null`
    `alreadyNotified` が true なら null。false なら `setKeys` の中で最初に `parseTimetableKey` が成功したものを返す。なければ null。
  - `buildFirstImportNotification(year: number, semester: Semester): { title: string; message: string }`
    title「時間割を取り込みました」／message「`${year}年度${前期/後期}`の時間割を登録しました。ダッシュボードで確認できます。」
  - `Semester` 型は `src/core/timetableLink.ts` から type-only import。
- **B-2. 新規storageキー** — `src/background/storageKeys.ts`
  `export const TIMETABLE_IMPORT_NOTIFIED_KEY = 'timetableImportNotified'`
- **B-3. background配線** — `src/background/index.ts`
  既存の `chrome.storage.onChanged` リスナ（area チェック済、`timetable:` prefix で `applyAutoSelect` を呼んでいる箇所）で、
  `changes` から「`timetable:` prefix かつ `newValue !== undefined`（＝セット/更新、削除でない）」のキー配列を作る。
  1件以上なら従来どおり `applyAutoSelect()` を呼びつつ、新規 `maybeNotifyFirstTimetableImport(setKeys)` を呼ぶ。
  - `maybeNotifyFirstTimetableImport`: `TIMETABLE_IMPORT_NOTIFIED_KEY` を読み、`pickFirstImportNotification(setKeys, notified===true)` が
    非nullなら **先にフラグを true に set**（再入防止）→ `buildFirstImportNotification` → `createNotification({ id: 'timetable-imported', title, message, url: `${chrome.runtime.getURL('index.html')}#dashboard` })`。
  - 通知idは固定 `'timetable-imported'`。万一の二重発火でも Chrome が同一idを上書きするため可視通知は常に1つ。
  - クリック遷移は既存の `chrome.notifications.onClicked`＋`NOTIFICATION_TARGETS_KEY` の仕組みを流用（新規コード不要）。
- **B-4. 既存ユーザー移行** — `src/background/index.ts` `handleInstalled`（`details.reason === 'update'`）
  `chrome.storage.local.get(null)` で全キーを列挙し、`timetable:` prefix のキーが1つでも存在すれば
  `TIMETABLE_IMPORT_NOTIFIED_KEY` を true に set。既存利用者が更新後に時間割ページを開いた際の
  不要な「初回」通知を抑止する。列挙は update 時の1回のみ。

## テスト（純ロジックTDD）

`src/core/timetableImportNotify.test.ts`:
- `parseTimetableKey`: `timetable:2026:zenki`→`{2026,zenki}`／`timetable:2025:kouki`→`{2025,kouki}`／
  `timetableOverrides:2026:zenki:1234567`→null／`timetableView`→null／`manualAssignments`→null／`timetable:2026:haru`→null。
- `pickFirstImportNotification`: alreadyNotified=true→null／該当キーなし→null／1件→その値／複数（timetable以外を含む）→最初のtimetableキー。
- `buildFirstImportNotification`: message に year と「前期」/「後期」を含む。title は固定文言。

表示側（`formatDateTime`）は `src/utils/date.test.ts` の既存テストで担保。

## 非目標（YAGNI）

- 学期別の初回通知（＝毎学期の最初の取込を通知）。今回はグローバル初回のみ。
- 取込失敗・パース失敗の通知。
- 通知クリック時に該当学期へ直接スクロール等の高度な導線。
- サーバー同期（凍結中・ローカル保存のみ）。

## 影響

- 権限追加なし（`notifications` は既存）。収集・外部送信は無変更。
- 既定の締切通知・コース更新通知のタイミング/挙動に影響なし。
- content script の import ガード（`dist/classTimetable.js`・`dist/content.js` に import 文が出ない）を維持
  （A-1 は inline 変更のみ、新規 pure モジュールは background/popup からのみ import）。
