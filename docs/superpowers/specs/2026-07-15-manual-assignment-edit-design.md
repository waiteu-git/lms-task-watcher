# 手動追加課題の編集機能 設計

## 背景と問題

利用者が「＋」から手動で追加した課題（`manualAssignments`）は、追加後に内容を直せない。

- ポップアップ／ダッシュボードの手動カード（`ManualAssignmentCard`）は「提出トグル」と「削除」のみ。締切・課題名・コース・メモを打ち間違えたら削除してやり直すしかない。
- LETUS ページの手動バッジ（コンテンツスクリプト）はクリックすると提出状態がトグルされるだけで、内容は編集できない。

打ち間違いの訂正と締切変更のたびに削除→再入力を強いるのは負担が大きい。スキャン検出課題には別ブランチ（`feature/scanned-deadline-override`）で締切設定 UI を入れたが、手動課題にはそれに相当する編集手段がない。

## ゴール

手動追加課題を、追加後に **ポップアップ／ダッシュボードのカードからも、LETUS ページの手動バッジからも** 編集できるようにする。編集対象は課題名・締切・コース・メモ・提出状態。

## 非ゴール（YAGNI）

- `letusUrl`（課題ページの URL）の編集：URL はバッジをどのリンクに紐づけるかの鍵で、書き換えるとバッジ表示との対応が崩れる。訂正が必要なら削除→再追加でよい。
- 複数課題の一括編集。
- スキャン検出課題の編集：締切は既存の `feature/scanned-deadline-override` の overlay で対応済み。それ以外のフィールド（課題名など）は LETUS 由来のため編集しない。

## 全体構成

3 層に分けて、それぞれ独立にテスト・変更できるようにする。

1. **コア（純ロジック）** — `src/core/manualAssignment.ts` に `updateManualAssignment(id, patch)` を追加。ストレージへの反映だけを担当し、UI に依存しない。Vitest で単体テストする。
2. **コンテンツスクリプト UI** — `src/content/manualTaskWidget.ts` に `openManualEditForm(assignment, courses)` を追加。手動バッジのクリックを「提出トグル」から「編集フォームを開く」に変更する。提出状態はフォーム内のチェックで変更できるので、トグル機能は失われない。コア関数（`updateManualAssignment`）はコンテンツからは import せず、既存の `toggleManualSubmitted` と同じくインラインで `manualAssignments` を読み書きする（import ガード維持のための意図的な重複）。したがってコアの `updateManualAssignment` の直接の利用者は React/App 層のみ。
3. **React UI** — `src/components/ManualAssignmentCard.tsx` にインライン編集フォームと「編集」ボタンを追加。既存の提出トグル・削除ボタンは残す。

反映（保存後の再描画）は既存の `chrome.storage.local.onChanged` 経路にそのまま乗る。`manualAssignments` キーの変更はコンテンツ側 `watchStorage`（`'manualAssignments' in changes`）と React 側の storage 監視の両方が既に監視しているため、追加配線は不要。

## 詳細設計

### 1. コア: `updateManualAssignment`

```ts
export type ManualAssignmentPatch = Partial<
  Pick<ManualAssignment, 'title' | 'deadline' | 'courseId' | 'courseName' | 'memo' | 'submitted'>
>

export async function updateManualAssignment(
  id: string,
  patch: ManualAssignmentPatch,
): Promise<void> {
  const current = await getManualAssignments()
  const updated = current.map((a) => (a.id === id ? { ...a, ...patch } : a))
  await saveManualAssignments(updated)
}
```

- `id` と `createdAt`、`letusUrl` は patch の対象外（型で除外）。既存不変条件を保つ。
- 該当 `id` が無ければ何もせず保存だけ走る（現状の `deleteManualAssignment` と同じく寛容な挙動）。
- `courseId` と `courseName` は必ずペアで渡す（UI 側の責務。select の選択肢から両方取得する）。

**テスト（Vitest, `src/core/manualAssignment.test.ts` に追記または新規）**

- 指定 id の課題だけ patch が適用され、他は不変。
- patch に含まれないフィールドは元の値を保持。
- 存在しない id では既存データが変化しない。
- `submitted` だけの patch が既存トグルと同じ結果になる。

### 2. コンテンツスクリプト: 手動バッジ→編集フォーム

`applyBadgeState` の `state.kind === 'manual'` 分岐（現在は `toggleManualSubmitted` を呼ぶ）を、`openManualEditForm` を開くように変更する。

```ts
if (state.kind === 'manual') {
  fresh.className = `badge clickable ${state.submitted ? 'submitted' : ''}`
  fresh.textContent = `${formatDeadlineShort(state.deadline)} ${state.submitted ? '✓' : '！'} ✎`
  fresh.addEventListener('click', async (event) => {
    event.preventDefault()
    event.stopPropagation()
    const item = (await getManualAssignments()).find((a) => a.id === state.id)
    if (item) openManualEditForm(item, courses)
  })
  return
}
```

- バッジ文言に `✎`（鉛筆）を付け、編集できることを示す。
- `applyBadgeState` は既に `courses` を受け取っているのでシグネチャ変更不要。
- 完全な `ManualAssignment` は `state`（id/submitted/deadline のみ）に無いので、クリック時に `getManualAssignments()` から id で引く。

**`openManualEditForm(assignment, courses)`** — `openDeadlineEditor` を雛形にした右下固定の closed shadow DOM パネル。

- ホスト id: `letus-task-watcher-manual-editor`。開くたびに既存を `remove()` してから生成（多重表示防止）。
- フィールド：
  - 課題名（text, 初期値 `assignment.title`）
  - 締切（datetime-local, `toLocalInputValue(assignment.deadline)`）
  - コース（select, `courses` から生成、`assignment.courseId` を選択状態に）
  - メモ（textarea, 初期値 `assignment.memo`）
  - 提出済み（checkbox, 初期値 `assignment.submitted`）
- ボタン：更新 / 削除 / キャンセル。
  - **更新**: 課題名・締切・コース未入力ならエラー表示。OK なら
    `updateManualAssignment(assignment.id, { title, deadline: new Date(v).toISOString(), courseId, courseName, memo, submitted })` を呼び、閉じる。保存後の `storage.onChanged` でバッジは再描画される。
  - **削除**: `deleteManualAssignment(assignment.id)` を呼び閉じる。
  - **キャンセル / ✕**: 閉じるだけ。
- コンテンツスクリプトの import ガードを守る：`openManualEditForm` は既存のインライン関数（`getManualAssignments` / `updateManualAssignment` 相当のインライン実装 / `deleteManualAssignment` 相当）だけを使い、`badgeState` など content と popup/background で共有されるモジュールを新たに import しない。`updateManualAssignment` はコアに追加するが、コンテンツ側は既存の `toggleManualSubmitted` と同様にインラインで `manualAssignments` を読み書きする（現状の `manualTaskWidget.ts` はコアの関数を import せずインライン実装している方針に合わせる）。

### 3. React: `ManualAssignmentCard` にインライン編集

- props に `courses: Course[]` と `onUpdate: (id: string, patch: ManualAssignmentPatch) => void` を追加。既存の `onToggleSubmitted` / `onDelete` は残す。
- フッターに「編集」ボタンを追加（提出トグル・削除と並べる）。押すとカード内にインライン編集フォームを開く（`useState` で開閉）。
- 編集フォームのフィールドは 2. と同じ（課題名 / 締切 / コース select / メモ / 提出済み check）。締切は `datetime-local` と ISO の相互変換を行う。
- 「更新」で `onUpdate(assignment.id, patch)` を呼びフォームを閉じる。「キャンセル」で破棄。
- `App.tsx` 側で `onUpdate` に `updateManualAssignment` を配線し、保存後に手動課題リストを再取得（既存の storage 監視で再描画されるならそれに任せる）。`courses` は App が既に保持しているものを渡す。

## データフローと反映

```
編集フォーム（バッジ or カード）
  → updateManualAssignment(id, patch)
  → saveManualAssignments → chrome.storage.local.set({ manualAssignments })
  → storage.onChanged 発火
      ├─ コンテンツ watchStorage（'manualAssignments' in changes）→ バッジ再描画
      └─ React storage 監視 → 手動課題リスト再取得 → カード再描画
```

新規の通知・メッセージ経路は無い。締切通知の再アーム（`rearmDeadlineNotifications`）は手動課題の締切変更にも効かせるべきか要検討だが、手動課題は `deadlineOverrides` ではなく `manualAssignments` に直接締切を持つため、`notifiedDeadlineKeys` の再アーム対象キーが異なる。初版では手動課題の締切変更時の通知再アームは対象外とし、必要なら別途対応する（非ゴールに準じる）。

## リスクと留意

- **import ガード**：`content.js` / `classTimetable.js` に `import` を残さない。`openManualEditForm` はインライン関数のみ使用。ビルド後 `dist/content.js` を grep して import が無いことを確認する。
- **バッジ挙動の変更**：クリックで即トグルしていた操作が、フォームを開く操作に変わる。提出状態の変更は 1 クリック増えるが、誤タップでの状態変化を防げる利点もある。フォーム内チェックで従来通り変更可能。
- **スタックブランチ**：本ブランチは未マージの `feature/scanned-deadline-override`（`manualTaskWidget.ts`・`ManualAssignmentCard` 周辺を触る）の上に積む。両方まとめて v1.2.2 に同梱する。

## テスト方針

- コア `updateManualAssignment` を Vitest で単体テスト（上記 4 ケース）。
- 実機確認：LETUS ページの手動バッジから編集フォームを開き、各フィールドの変更・提出チェック・削除が反映されること。ポップアップ／ダッシュボードのカードからも同様に確認。
- ビルド後の import ガード確認。
