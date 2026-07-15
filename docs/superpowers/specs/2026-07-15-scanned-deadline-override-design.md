# 設計: スキャン課題の締切をユーザーが設定/変更

- 日付: 2026-07-15
- ブランチ: `feature/scanned-deadline-override`（develop分岐予定）

## 背景・問題

LETUSの課題は締切を本文などから機械抽出しているが、**締切を取得できない課題が多い**（フォーラム、紙提出、本文にしか締切が無い等）。締切なしの課題は締切通知の対象にならず、一覧でも期限が空欄になる。また抽出が誤ることもある。

現状、LETUSページの課題リンク横に出るバッジは:
- `scanned`（スキャン検出）: `締切 ！/✓`、締切なしは `！` のみ。**クリック不可**。
- `manual`（手動追加）: クリックで提出トグル。
- `unadded`（未追加リンク）: クリックでクイック追加。

`scanned` の締切をユーザーが編集する手段が無い。

## 目的

**すべてのスキャン課題**について、ユーザーがバッジから締切を**設定（締切なし）／変更・上書き（抽出済み含む）／クリア（自動検出に戻す）**でき、その実効締切が表示・緊急度・締切通知（24/3/1h前）・時間割の全てに反映される。

## スコープ

### A. 保存モデル（オーバーレイ方式）

- 新storageキー `DEADLINE_OVERRIDES_KEY = 'deadlineOverrides'`、値 `Record<正規化URL, ISO日時>`。
  - キーは `normalizeAssignmentUrl(url)`（`src/core/badgeState.ts` の既存関数・再スキャンで安定）。バッジは課題リンクURL、`assignment.url` も同じ正規化で一致する。
- **`assignments` のパース済み締切は改変しない**。オーバーライドは**読み取り時に重ねる**。
- クリア＝マップからキー削除→次回読取で自動検出値（パース値）に戻る。パース値が保持されるのが本方式の利点。

### B. 純ロジック `src/core/deadlineOverride.ts`（新規・TDD）

- `applyDeadlineOverrides(assignments: Assignment[], overrides: Record<string, string>): Assignment[]`
  各 assignment について `overrides[normalizeAssignmentUrl(a.url)]` があれば `{ ...a, deadline: 上書き値, deadlineSource: 'user' }` を返し、なければそのまま。
- `Assignment['deadlineSource']` に `'user'` を追加（表示のマーカー判定に使う）。既存の switch/比較が網羅前提でないことを確認して追加。
- `normalizeAssignmentUrl` は `badgeState.ts` から import（core同士）。

### C. バッジUI（`src/content/manualTaskWidget.ts` + `src/core/badgeState.ts`）

- `computeBadgeState(url, assignments, manualAssignments, overrides?)` に第4引数 `overrides` を追加。
  - `scanned` の場合、実効締切 `overrides[norm] ?? scanned.deadline` と `userSet: overrides[norm] != null` を返す。
- バッジ描画（`applyBadgeState`）:
  - `scanned` を **clickable** に。締切なし → 「**＋ 締切**」と読める表示（琥珀・押せる見た目）。締切あり → `M/D ！`。`userSet` の時は末尾に小さく `✎`。
  - クリックで `preventDefault/stopPropagation`（LETUSリンクへ遷移させない）→ 締切エディタを開く。
- content script は import ガードのため、`deadlineOverrides` の get/set は**インライン**（`chrome.storage.local`）。読取値を `computeBadgeState` に渡す。`buildCourseBadges` で `deadlineOverrides` もロードする。`storage.onChanged` に `deadlineOverrides` を再描画トリガとして追加。

### D. 締切エディタ（content script・右下固定ミニフォーム）

- 既存ウィジェットと同じ **右下固定・Shadow DOM**（`openQuickAddForm` と同方式。バッジ直下ポップオーバーにはしない＝LETUSのDOMでのクリップ回避・既存挙動と統一）。
- 内容: 見出し「締切を設定」／`<input type="datetime-local">`（現在の実効締切をプリフィル）／**保存**・**クリア（自動検出に戻す）**・**キャンセル**。
- 保存 → `deadlineOverrides[norm] = ISO(datetime-local値)` を set。クリア → キー削除。datetime-local↔ISO 変換は手動追加フォームと同じ方式を用いる。
- 保存/クリア後は `storage.onChanged` によりバッジ再描画。ポップアップ/通知は次回読取で反映。

### E. 反映点（オーバーレイの適用箇所・実装で漏らさないこと）

`applyDeadlineOverrides` を以下すべてに適用（各1行）。共有の純関数を使う。
1. **ポップアップ/ダッシュボード**: `App.tsx` の `refreshAll` で `getAssignments()` 直後に適用してから state へ。→ 表示・緊急度・時間割（`TimetableSection` に渡る `assignments`）・`getUrgentAssignments` すべてが実効締切になる。
2. **ポップアップの締切通知**: `App.tsx` の締切通知チェック（consent effect 内で `getAssignments()` を読む箇所）で適用。
3. **background の締切通知**: `checkDeadlineWarningNotifications()`（`getAssignments()` を読む箇所）で適用。
4. **background の完了サマリ/緊急**: `notifyDeadlineSummary(finalAssignments)`（締切スキャン末尾）と `runManualUpdate` の `getUrgentAssignments` で適用。※ここは `getAssignments()` ではなく scan の `finalAssignments` を使うため、直前に overrides をロードして適用。
- content script バッジは C で inline 適用済み。

### F. テスト

- `deadlineOverride.test.ts`: override 有→上書き＆`deadlineSource:'user'`／無→不変／正規化URL一致（末尾スラッシュ等の揺れ）／空マップ。
- `badgeState.test.ts`（既存拡張）: overrides 付き `scanned` で実効締切＋`userSet`／override 無で従来どおり。
- 反映点は純関数の単体テストで担保。UI（エディタ・バッジのclickable化）は実機目視（ユーザー）。

## 非目標（YAGNI）

- ポップアップ一覧から直接締切設定（今回はバッジ起点。将来の追加候補）。
- 手動課題（`manual`）の締切編集（別UX・別物）。
- 締切の繰り返し/リマインド個別設定。

## 影響

- 権限・収集・外部送信は無変更（ローカルの `deadlineOverrides` のみ）。
- 既定（override無し）の表示・通知タイミングは不変。
- content script import ガード維持（`badgeState` は content 側でinline化される既存経路・新規 pure モジュールは popup/background からのみ import・`manualTaskWidget.ts` の override get/set はinline）。

## 実装後の別成果物（本specの対象外・後続タスク）

1. **操作案内アニメ**（手動追加ガイドと同形式の共有HTML）: 「締切なしの `！` バッジを押す→締切を選ぶ→保存→一覧に締切付きで反映」。**カーソル位置のズレに細心の注意**（`getBoundingClientRect` ベースで実要素中心に合わせる）。
2. **動画/GIF化**: 公開Artifactを実Chrome（claude-in-chrome）で開き `gif_creator` で録画→GIF。**同時にカーソル整合を実機目視検証**。Xに載せやすい尺・比率で。可否は実施時に正直に報告。
