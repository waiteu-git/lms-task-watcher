# CLASS連携（時間割 収集＋グリッド表示＋科目連携）設計

作成: 2026-07-07
種別: 機能設計（v1.2.0 No.2 の実装フェーズ個別設計）

## 位置づけ

`docs/superpowers/specs/2026-07-06-v1.2.0-scope-change-design.md` が定めた v1.2.0 の No.2「CLASS時間割 収集＋グリッド表示＋科目連携」の詳細設計。スコープ設計が確定済みの前提（収集は既存Content Script方式踏襲・常駐スクレイピング/バックグラウンド巡回はしない・保存は `chrome.storage.local` のみ・`host_permissions` に `class.admin.tus.ac.jp` 追加で一括Phase C申請）はここでは再決定せず踏襲する。

シラバス埋め込み表示（No.3）とコース更新通知（No.4）は本設計の対象外。ただし時間割コマからのシラバス導線（URL生成は移植済み `src/core/syllabus.ts`）は本設計のUIに含める。

関連（実地調査の根拠）:
- `C:\dev\litus\docs\2026-07-04-v2.0.0-mobile-app-initial-design.md` 付録A（CLASS時間割ページ `Kmd008` のメニュー導線・セレクタ・時限時刻表・学期切替の実証）
- 移植済み純粋ロジック: `src/core/timetable.ts`（`parseTimetable`/`parsePeriodTimes`/`parseClassCell`）、`src/core/syllabus.ts`（`buildSyllabusUrl`/`academicYear`）。いずれもテスト済み（2026-07-07 litusから移植、コミット `e5c2653`）。

## 確定した方針

### 収集は passive-only（現在表示学期をタグ付け取得）

- content script はページに**現在表示されている** `table.classTable` を読み取るだけ。学期セレクタ（`gakki`相当）の**選択中の値/表示テキスト**と年度を読み取ってタグ付けする。フォームを能動操作（学期セレクタを切り替えて `search` を押す driving 取得）は**しない**。
- 理由: (1) 後期時間割は後期開始後・履修登録期間を経ないと確定しないため、前期のうちに後期を先取り取得しても暫定データを掴むだけで誤解を生む。(2) CLASS側が期に応じて初期表示学期を出し分けるため、passive に「画面に出ている学期」を取れば自然に現在の期が取れる。よって driving は不要かつ有害。
- 学期は前期に開けば前期・後期に開けば後期が自然に蓄積する。各取得は**取込日時**を保存し、暫定/古いデータを見分けられるようにする（後期確定後に再度開けば上書き更新）。

### パースはアプリ側（content scriptは "dumb grabber"）

- content script は生の `table.classTable` の `outerHTML`・時限時刻エリアのテキスト・学期・年度を保存するだけ。`node-html-parser` を使うパース（`parseTimetable`）は**ダッシュボード（Reactアプリ）側**で実行する。
- 理由: `content.js` に `node-html-parser` をバンドルせずバンドルを軽量に保つ。パースロジックはアプリに既にバンドルされる。

### 表示デフォルトは直近取得学期

- 既定表示＝最後に取り込んだ学期。CLASSが今の期を出し、ユーザーはそれを取り込むので自然に今の期になる。判定不能時は日付（4–9月＝前期 / 10月–翌3月＝後期）でフォールバック。
- 前期/後期トグルは「取得済みの学期」を並べるだけ。切替は保存済みデータの表示切替で再訪不要。未取得の学期は空状態＋取込導線。

### 収集範囲の厳格限定

- 取得対象は `table.classTable`（時間割）と時限時刻エリアのみ。成績・掲示等の機微情報には一切アクセスしない。審査説明にも明記する。

## アーキテクチャ

各ユニットは単一責務・独立テスト可能に保つ。

### 1. content script（新規） — `src/content/classTimetable.ts`

- **責務**: CLASS時間割ページで `table.classTable` を検知し、生HTML＋メタを `chrome.storage.local` に保存し、トースト告知する。
- **依存**: `chrome.storage`・DOM のみ（`node-html-parser` に依存しない）。
- **動作**:
  - `class.admin.tus.ac.jp/*` にマッチ（`manifest.json` の `content_scripts`、`run_at: document_idle`）。
  - `MutationObserver` で `table.classTable` の出現/差し替え（JSFポストバック）を監視。検知したら:
    - `table.classTable` の `outerHTML`
    - 時限時刻エリアのテキスト（`parsePeriodTimes` に渡す元。付録Aのセレクタ範囲）
    - 学期: 学期セレクタの選択中 `value`（1=前期/2=後期）と表示テキスト
    - 年度: ページ上の年度表示（無ければ `academicYear(new Date())`）
    を収集し保存。
  - 保存後、ページ上に非侵襲トースト「時間割を取り込みました」。
- **収集の冪等性**: 同一（年度・学期）の内容が変わらなければ `capturedAt` のみ更新。内容変化時は本体を更新。

### 2. ストレージ層 — `src/core/timetableStore.ts`（新規）

- **責務**: 時間割の生データとユーザーオーバーライドの保存/読出を型安全にラップ。
- **キー設計**:
  - `timetable:{year}:{semester}` → `{ rawTableHtml, jigenText, capturedAt }`（`semester` は `'zenki' | 'kouki'`）
  - `timetableOverrides:{year}:{semester}:{courseCode}` → `{ room?: string, note?: string }`（教室等のユーザー編集。再取得で消えない）
  - `timetableView` → `{ year, semester }`（最後に表示していた/取り込んだ選択。既定表示の決定に使う）
- **関数**: `saveTimetableCapture`・`getTimetableCapture`・`listCapturedSemesters`・`getOverride`・`setOverride`・`getPreferredView`・`setPreferredView`。

### 3. 派生ロジック（純粋関数・vitest対象）

- `src/core/timetable.ts`（移植済み）: `parseTimetable`（生HTML→`TimetableSlot[]`）、`parsePeriodTimes`（時限時刻）。**変更しない**。
- `src/core/timetableLink.ts`（新規）: 科目連携の純粋関数群。
  - `extractCourseCode(letusCourseName: string): string | null` — LETUSコース名に埋め込まれた7桁コードを抽出。
  - `linkAssignmentsToSlots(slots, courses, assignments)` — 7桁コードで時間割コマ↔LETUSコース↔課題を突合し、コマごとの課題件数・課題ごとの `{ day, period, room, isRemote, courseCode }` を返す。統合コースは複数コード対応。
  - `applyOverrides(slots, overrides)` — オーバーライド（教室等）をパース結果にマージ。
  - `resolveSemester(now, captured)` — 既定表示学期の決定（直近取得優先・日付フォールバック）。
- **原則**: これらは DOM・chrome API に非依存の純関数として実装し、fixtures でテストする。

### 4. UI（React、`src/App.tsx` ＋ 新規コンポーネント）

- **`src/components/TimetableSection.tsx`（新規）**: ダッシュボードのサマリ直下に折りたたみ「時間割」セクション。
  - 曜日（月〜金、必要なら土）×時限グリッド。今日の曜日列を強調。
  - 各コマ: 科目名・教室（`isRemote` は「遠隔」）・直近課題件数バッジ・シラバスアイコン（`buildSyllabusUrl` で開く）・編集鉛筆（教室等のオーバーライド編集）。
  - ヘッダに 前期/後期 トグル（取得済み学期のみ活性）と最終取込日時。
  - 未取得時は空状態「CLASSの学生時間割表を開くと自動で取り込みます」＋手順。
- **課題カード（既存タイムライン）**: `linkAssignmentsToSlots` で突合できた課題に、曜日時限（例「月1」）・教室・シラバスのチップを表示。突合不可の課題は従来表示のまま。
- **編集UI**: 教室等はコマの鉛筆から編集し `setOverride` で保存。表示は `applyOverrides` 後の値。

### データフロー

```
[CLASS時間割ページ]
  content script: table.classTable + jigenText + 学期 + 年度 を検知
    → timetableStore.saveTimetableCapture (chrome.storage.local, 生HTML)
    → トースト告知
[ダッシュボード]
  timetableStore.getTimetableCapture(既定学期)
    → parseTimetable(生HTML) → TimetableSlot[]
    → applyOverrides(overrides)
    → linkAssignmentsToSlots(courses, assignments)  // 7桁コード突合
    → TimetableSection グリッド描画 / 課題カードにチップ付与
```

## 権限・manifest

- `host_permissions` に `https://class.admin.tus.ac.jp/*` を追加。
- `content_scripts` に**新エントリ**を追加（`matches: https://class.admin.tus.ac.jp/*`）。既存 content script（`src/content/courseDetector.ts` → `content.js`）は `letus.ed.tus.ac.jp/*` 専用でマッチ集合が異なるため統合せず、**別バンドル**（例: `classTimetable.js`）として出力する。`vite.config.ts` の `rollupOptions.input` に `src/content/classTimetable.ts` を追加し、`entryFileNames` で `classTimetable.js` に固定。`run_at: document_idle`。
- ストア審査説明: 「履修時間割の閲覧補助のため、ユーザーがCLASSの学生時間割表を開いた時にその時間割のみを取得する。成績等には一切アクセスしない」。

## エラー処理・空状態

- `table.classTable` が見つからない（時間割ページ以外）→ 何もしない（保存も告知もしない）。
- パース結果が空（`parseTimetable` が `[]`）→ セクションは「時間割を読み取れませんでした。ページを再読込して再度お試しください」。
- 突合0件（コード抽出できない/一致なし）→ 課題カードはチップなしの従来表示。グリッドは課題件数0表示。機能は劣化せず成立する。
- オーバーライド適用対象コマが再取得で消えた（時間割変更）→ オーバーライドは保持するが該当コマが無ければ非表示（データは残す）。

## テスト方針

- 移植済み `timetable.ts`・`syllabus.ts` はテスト済み（変更しない）。
- 新規 `timetableLink.ts`（`extractCourseCode`・`linkAssignmentsToSlots`・`applyOverrides`・`resolveSemester`）を純関数として vitest。統合コース（複数コード）・突合0件・オーバーライドマージ・学期判定境界をカバー。
- `timetableStore.ts` は既存の storage テストパターン（`vi.stubGlobal('chrome', ...)`）に倣う。
- content script のDOM抽出（`MutationObserver`・セレクタ）は薄く保ち、実CLASS DOMでの検証はユーザー環境で行う（自動テスト対象外）。
- `pnpm exec tsc -b`・`pnpm build`・`pnpm exec vitest run src` 全緑。

## 純粋ロジックの litus 逆流

- 本設計で新規に磨く純粋ロジック（`extractCourseCode` 等の突合、`resolveSemester`）のうち litus と共有価値があるものは、実装後に litus の対応箇所へ突き合わせて寄せる。時間割パーサ自体（`timetable.ts`）は移植時点で litus と同一。差分が出たら handover（litus）と WORKLOG（拡張）に逆流済み/未を記録する（スコープ設計の逆流規約）。

## 非目標（本設計で扱わないこと）

- 学期セレクタを driving する能動的な両学期先取り取得（passive-only を確定）。
- 時間割のクロスデバイス同期（`/api/timetable`）— v1.2.0では実装しない（ローカルのみ、スコープ設計どおり）。
- シラバスHTMLの fetch・パース・整形表示（No.3）、コース更新通知（No.4）。
- 休講/補講の自動抑制（初版は扱わない）。
- 出席リマインド（リタス側の機能で、拡張では扱わない）。
