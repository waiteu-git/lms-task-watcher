# LETUS Task Watcher — 仕様書

## 概要

LETUS（東京理科大学LMS、Moodle 4.x基盤、`https://letus.ed.tus.ac.jp`）の課題期限を自動収集・表示・通知するChrome拡張機能（Manifest V3）。

**ゴール**: Chrome Web Storeへの公開

---

## アーキテクチャ

```
dist/
├── manifest.json          # 拡張機能マニフェスト（MV3）
├── index.html             # Popup / Dashboard のエントリポイント
├── assets/                # Viteバンドル済みJS・CSS
├── background.js          # Service Worker（バニラJS、Viteを経由しない）
└── icons/                 # アイコンPNG（現在欠落 → TASKS参照）

src/                       # Viteでビルドされる部分（Popup / Dashboard）
├── main.tsx
├── App.tsx                # Popup（#なし）とDashboard（#dashboard）を切り替え
├── core/
│   ├── types.ts           # 型定義（Course, Assignment等）
│   ├── storage.ts         # chrome.storage.localのCRUD
│   ├── scanStatus.ts      # スキャン進捗の読み書きとポーリング待機
│   └── assignmentScanner.ts  # ※現在Popupから直接は使用しない（background経由）
├── utils/
│   ├── date.ts            # 日時フォーマット・残時間計算
│   ├── assignment.ts      # 課題フィルタリング・ソート
│   └── notification.ts    # chrome.notifications.create ラッパー
└── components/
    ├── AssignmentCard.tsx  # 課題カード
    └── Section.tsx        # セクション（折りたたみ付き）

public/
└── background.js          # Service Worker本体（→ dist/にコピーされる）
```

---

## データフロー

### 1. コース登録（現状: 未実装 → あるべき姿は下記「未実装機能」参照）

現時点では `chrome.storage.local` の `courses` キーにコースデータが保存されていれば動作するが、
自動登録のContent Scriptが存在しない。

### 2. 課題候補スキャン（`START_ASSIGNMENT_SCAN`）

1. Popup/Dashboardから `chrome.runtime.sendMessage({ type: 'START_ASSIGNMENT_SCAN', scanLevel })` を送信
2. Background Service Workerが enabled なコースのURLをfetch（並列3件）
3. HTMLからリンクを正規表現で抽出し、課題らしいURLを判定
4. `chrome.storage.local` の `assignmentCandidates` に保存しながら進捗を更新

**scanLevel の種類:**
| レベル | 対象モジュール |
|--------|---------------|
| `strict` | assign, quiz, turnitin系のみ |
| `standard` | strict + workshop, feedback, choice, questionnaire, lti |
| `broad` | standard + forum, survey, lesson（キーワードマッチも有効） |

### 3. 締切スキャン（`START_DEADLINE_SCAN`）

1. `assignmentCandidates` を取得し、各URLをfetch（並列5件）
2. HTMLを平文化し、締切キーワード（「提出期限」「締切」「Due date」等）周辺のテキストを抽出
3. 日付パターン（`YYYY年MM月DD日`、`MM月DD日`等）を正規表現でパース
4. 提出状況（`submitted`/`not_submitted`/`unknown`）を「提出済み」「未提出」等のテキストから判定
5. ライフサイクル状態（`before_start`/`submitted`/`passed`/`active`）を確定
6. `chrome.storage.local` の `assignments` に保存

### 4. 表示（Popup）

- **ミニサマリ**: 24時間以内件数、今週件数、対象コース数
- **24時間以内セクション**: 最大3件表示
- **次の課題セクション**: 明日・今週の課題を最大3件表示
- ダッシュボードを開くボタン

### 5. 表示（Dashboard、`#dashboard`ハッシュで切り替え）

| セクション | 条件 |
|-----------|------|
| 24時間以内 | `deadline - now ≤ 24h`、未提出 |
| 明日まで | `24h < deadline ≤ 翌日23:59`、未提出 |
| 今週 | `24h < deadline ≤ now + 7日`かつ翌日より後、未提出 |
| それ以降 | `deadline > now + 7日`、未提出 |
| 開始前 | `lifecycleStatus === 'before_start'` |
| 提出済み・完了 | `submissionStatus ∈ {submitted, completed}` |
| 期限切れ（最近） | `lifecycleStatus === 'passed'`かつ30日以内 |
| 期限切れ（古い） | `lifecycleStatus === 'passed'`かつ30日超 |

### 6. 通知

| トリガー | 内容 |
|---------|------|
| 更新完了（urgent あり） | 「24時間以内の課題: N件」+ 先頭課題タイトル |
| 更新完了（urgent なし） | 「更新完了。24時間以内の未提出課題はありません。」 |
| 期限1時間前 | 「締切まで1時間以内」（各課題で1回のみ） |
| 期限3時間前 | 「締切まで3時間以内」（各課題で1回のみ） |
| データ陳腐化（2h経過） | 「前回更新からN時間です。自動更新を開始します。」（1h間隔で最大1回） |
| 通知クリック | 対応する課題URLをタブで開く |

---

## ストレージスキーマ（`chrome.storage.local`）

| キー | 型 | 内容 |
|------|-----|------|
| `courses` | `Course[]` | 登録コース一覧 |
| `assignmentCandidates` | `AssignmentCandidate[]` | スキャンで検出した課題候補 |
| `assignments` | `Assignment[]` | 締切・提出状況が確定した課題 |
| `assignmentScanStatus` | `AssignmentScanStatus` | スキャン進捗 |
| `deadlineScanStatus` | `DeadlineScanStatus` | 締切スキャン進捗 |
| `lastSuccessfulRefreshAt` | `string` (ISO) | 最終更新日時 |
| `lastStaleRefreshNotificationAt` | `string` (ISO) | 陳腐化通知の最終送信日時 |
| `ignoredAssignmentIds` | `string[]` | 非表示課題ID一覧 |
| `notifiedDeadlineKeys` | `string[]` | 通知済みキー（`{id}:1h` / `{id}:3h`） |
| `notificationTargets` | `{ [notificationId]: url }` | 通知→URL対応マップ |

---

## 型定義（主要）

```typescript
type Course = {
  id: string        // btoa(URL)ベースのID
  name: string
  url: string       // コースページURL
  enabled: boolean  // スキャン対象かどうか
  lmsType: 'unknown' | 'letus' | 'moodle' | ...
  createdAt: string
  updatedAt: string
}

type Assignment = {
  id: string        // btoa(courseId:url)ベースのID
  courseId: string
  courseName: string
  title: string
  url: string
  deadline: string | null   // ISO 8601
  deadlineText: string      // 元テキスト（デバッグ用）
  sourceText: string        // 課題ページ本文の先頭1200文字
  submissionStatus: 'unknown' | 'not_submitted' | 'submitted' | 'completed'
  lifecycleStatus: 'active' | 'new' | 'changed' | 'before_start' | 'submitted' | 'passed' | 'missing' | 'archived'
  detectedAt: string
  firstSeenAt: string
  lastSeenAt: string
  lastCheckedAt: string
}
```

---

## 未実装機能（あるべき姿）

### コース自動登録（Content Script）

- LETUSのトップページ（`/my/index.php`またはダッシュボード相当）を開いた際にContent Scriptが起動
- ページ上のコースリンクを解析して `upsertCourses` でストレージに保存
- manifest.jsonに `content_scripts` エントリを追加する必要がある

### 通知タイミングの拡張

- 前日・当日朝など、3h/1h以前の段階での通知（現在は3h/1hのみ）
- Popup/Dashboardを開かなくても通知が届く自律的なスケジューリング

### 差分検知と履歴管理

- `firstSeenAt` / `lastSeenAt` を活用した「新規」「変更」状態の反映
- `lifecycleStatus: 'new'` / `'changed'` の実際の付与ロジック（現在は常に `'active'`）

---

## 既知のバグ

### background.js: lifecycleStatus が二重代入される

`scanDeadlinesInBackground` 内でライフサイクル状態を決定するブロックが重複しており、
`before_start` の判定が後続の代入に上書きされる。

```js
// 現状（バグあり）
let lifecycleStatus = 'active'
if (isBeforeStart(plainText)) {
  lifecycleStatus = 'before_start'  // ← ここで設定しても...
} else if (...) { ... }

if (submissionStatus === 'submitted' || ...) {  // ← これで上書きされてしまう
  lifecycleStatus = 'submitted'
} else if (isDeadlinePassed(deadline)) {
  lifecycleStatus = 'passed'
}
// before_startが正しく残らないケースがある
```

### background.js: スキャン進捗コールバックで `state: 'completed'` を早期送信

`mapWithConcurrency` の `onProgress` コールバック内で `saveDeadlineScanStatus({ state: 'completed' })` を呼んでおり、スキャン途中でPopup側が完了と誤認する。

### background.js: 通知がスキャン途中に毎回発火

`notifyDeadlineSummary` が `onProgress` コールバック（件数分）呼ばれており、スキャン完了前に大量の通知が発火する可能性がある。
