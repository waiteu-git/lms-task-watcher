# 無料開放 entitlement 変更 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** メモ・優先度・手動課題・同期・テーマを無料開放する（サブスクゲートを外す）。有料はカスタム通知ルールと Discord の 2 つに集約する。

**Architecture:** バックエンド変更なしのフロントエンド専用変更。実ゲートは `AssignmentMemo` の `isSubscriber` プロップのみなのでそれを撤去し、テーマセレクタをサブスク限定ブロックの外へ移動、マーケ文言を更新、未使用の `PremiumGate` を削除する。

**Tech Stack:** React 19 + TypeScript, Vite。検証は `pnpm exec tsc -b`・`pnpm build`・`pnpm exec vitest run src`。

## Global Constraints

- 対象worktree/branch: `C:\dev\lms-task-watcher`（branch develop）。全タスクここで作業
- バックエンド（`api/`）は一切変更しない＝ラズパイデプロイ不要。同期インフラは既に無料アカウント対応済み
- 有料で残すのは**カスタム通知ルール**と**Discord**のみ。これらのゲートは撤去しない
- 既存の該当コンポーネントに単体テストは存在しない（`AssignmentMemo`/`ManualAssignmentCard`/`PremiumGate`のテストファイルは無い）。検証は `tsc`・`build`・`vitest run src`（既存の src テストが緑のまま）で行う
- コミットのフッタは `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## File Structure

- Modify: `src/components/AssignmentMemo.tsx` — `isSubscriber` ゲート撤去、常時編集可
- Modify: `src/components/ManualAssignmentCard.tsx` — `isSubscriber` プロップ撤去、メモ常時表示
- Modify: `src/App.tsx` — 呼び出し箇所の `isSubscriber` 受け渡し削除、テーマセレクタ移動、機能リスト更新
- Modify: `src/components/ProBanner.tsx` — `FEATURES` 更新
- Delete: `src/components/PremiumGate.tsx` — 未使用デッドコード
- Modify: `docs/superpowers/specs/2026-07-04-free-first-strategy-design.md` — テーマ行を無料へ

---

### Task 1: メモ・優先度・手動課題のゲート撤去

**Files:**
- Modify: `src/components/AssignmentMemo.tsx`
- Modify: `src/components/ManualAssignmentCard.tsx`
- Modify: `src/App.tsx`（AssignmentMemo / ManualAssignmentCard 呼び出し箇所）
- Delete: `src/components/PremiumGate.tsx`

**Interfaces:**
- `AssignmentMemo` の Props から `isSubscriber` を削除（`{ assignmentId, apiBaseUrl, popup? }`）
- `ManualAssignmentCard` の props から `isSubscriber` を削除

- [ ] **Step 1: `AssignmentMemo.tsx` のゲートを撤去する**

`src/components/AssignmentMemo.tsx` を次のように変更する。

(a) Props 型から `isSubscriber` を削除:

```ts
type Props = {
  assignmentId: string
  apiBaseUrl: string
  popup?: boolean
}
```

(b) 関数シグネチャから削除:

```ts
export function AssignmentMemo({ assignmentId, apiBaseUrl, popup = false }: Props) {
```

(c) useEffect を常時ロードに:

```ts
  useEffect(() => {
    void getMemo(assignmentId).then(setMemo)
  }, [assignmentId])
```

(d) `if (popup && !isSubscriber) return null` の行（コメント `// ポップアップ・非サブスクは表示しない` ごと）を削除。

(e) 非ポップアップのトグルボタン内（現在 `isSubscriber` 分岐している箇所）を、常にサブスク相当の表示にする。現在の:

```tsx
        <>
            <span className="memoToggleBtnIcon">{isSubscriber ? '✎' : '🔒'}</span>
            {isSubscriber && hasPriority && (
              <span className={`memoPriorityChip ${PRIORITY_CLASS[memo.priority as 0|1|2|3]}`}>
                {PRIORITY_LABELS[memo.priority as 0|1|2|3]}
              </span>
            )}
            {isSubscriber && hasMemoText && !open && (
              <span className="memoSnippet">
                {memo.memo.trim().slice(0, 24)}{memo.memo.trim().length > 24 ? '…' : ''}
              </span>
            )}
            {!isSubscriber && <span className="memoToggleLockLabel">メモ・優先度</span>}
            <span className="memoToggleBtnArrow">{open ? '▲' : '▼'}</span>
          </>
```

を次に置き換える:

```tsx
        <>
            <span className="memoToggleBtnIcon">✎</span>
            {hasPriority && (
              <span className={`memoPriorityChip ${PRIORITY_CLASS[memo.priority as 0|1|2|3]}`}>
                {PRIORITY_LABELS[memo.priority as 0|1|2|3]}
              </span>
            )}
            {hasMemoText && !open && (
              <span className="memoSnippet">
                {memo.memo.trim().slice(0, 24)}{memo.memo.trim().length > 24 ? '…' : ''}
              </span>
            )}
            <span className="memoToggleBtnArrow">{open ? '▲' : '▼'}</span>
          </>
```

(f) 編集パネルの `!isSubscriber ? (ロック) : (編集UI)` を、常に編集UIにする。現在の:

```tsx
      {open && (
        <div className={`memoPanel ${popup ? 'memoPanelPopup' : ''}`} onClick={stopProp}>
          {!isSubscriber ? (
            <div className="memoLocked">
              <p className="memoLockedText">メモ・優先度はサブスクライバー限定機能です。</p>
            </div>
          ) : (
            <>
              <div className="prioritySelector">
                {([0, 1, 2, 3] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`priorityBtn priority${p} ${memo.priority === p ? 'active' : ''}`}
                    onClick={(e) => { stopProp(e); void handlePriorityChange(p) }}
                  >
                    {PRIORITY_LABELS[p]}
                  </button>
                ))}
                {saving && <span className="savingIndicator">保存中…</span>}
              </div>
              <textarea
                className="memoInput"
                placeholder="メモを入力..."
                value={memo.memo}
                onChange={handleMemoChange}
                onClick={stopProp}
                rows={3}
              />
            </>
          )}
        </div>
      )}
```

を次に置き換える:

```tsx
      {open && (
        <div className={`memoPanel ${popup ? 'memoPanelPopup' : ''}`} onClick={stopProp}>
          <div className="prioritySelector">
            {([0, 1, 2, 3] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={`priorityBtn priority${p} ${memo.priority === p ? 'active' : ''}`}
                onClick={(e) => { stopProp(e); void handlePriorityChange(p) }}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
            {saving && <span className="savingIndicator">保存中…</span>}
          </div>
          <textarea
            className="memoInput"
            placeholder="メモを入力..."
            value={memo.memo}
            onChange={handleMemoChange}
            onClick={stopProp}
            rows={3}
          />
        </div>
      )}
```

これで `isSubscriber` の参照がファイルから消える。

- [ ] **Step 2: `ManualAssignmentCard.tsx` のゲートを撤去する**

`src/components/ManualAssignmentCard.tsx`:

(a) props から `isSubscriber` を削除:

```tsx
export function ManualAssignmentCard({
  assignment,
  onToggleSubmitted,
  onDelete,
}: {
  assignment: ManualAssignment
  onToggleSubmitted: (id: string) => void
  onDelete: (id: string) => void
}) {
```

(b) メモ表示を常時表示に（`!isSubscriber` 条件を削除）:

```tsx
      {assignment.memo && <div className="manualCardMemo">{assignment.memo}</div>}
```

- [ ] **Step 3: `App.tsx` の呼び出し箇所から `isSubscriber` を削除する**

`src/App.tsx` で次を実行（Edit の replace_all を使う）:

(a) 全 `AssignmentMemo` 呼び出し: 文字列
`<AssignmentMemo assignmentId={item.assignment.id} apiBaseUrl={API_BASE_URL} isSubscriber={isSubscriber} />`
を
`<AssignmentMemo assignmentId={item.assignment.id} apiBaseUrl={API_BASE_URL} />`
に全置換。

(b) 全 `ManualAssignmentCard` 呼び出しの `isSubscriber={isSubscriber}` 行を削除。各呼び出しは
```tsx
                    isSubscriber={isSubscriber}
```
という独立行（インデント 20 スペース）で 4 箇所ある。`grep -n "isSubscriber={isSubscriber}" src/App.tsx` で残りを確認し、`ManualAssignmentCard` に渡している行をすべて削除する。`AssignmentMemo` の分は (a) で消えている。

削除後、`grep -n "isSubscriber={isSubscriber}" src/App.tsx` の結果が空になること（`isSubscriber` state 自体は Task 2 まで残す＝サブスク限定ブロックの判定に使う）。

- [ ] **Step 4: 未使用 `PremiumGate.tsx` を削除する**

```bash
git rm src/components/PremiumGate.tsx
```

念のため参照が無いことを確認:

Run: `grep -rn "PremiumGate" src/`
Expected: 0 件（import も JSX も無い）

- [ ] **Step 5: 型チェック・ビルド・テスト**

Run: `pnpm exec tsc -b`
Expected: エラーなし

Run: `pnpm build`
Expected: 成功

Run: `pnpm exec vitest run src`
Expected: PASS（src 配下の既存テストが緑のまま。api/tests は vitest 対象外で失敗表示されるが無関係）

- [ ] **Step 6: コミット**

```bash
git add src/components/AssignmentMemo.tsx src/components/ManualAssignmentCard.tsx src/App.tsx
git rm src/components/PremiumGate.tsx
git commit -m "feat(ext): open memo/priority/manual to free (remove subscriber gate)"
```

---

### Task 2: テーマ無料化＋マーケ文言更新

**Files:**
- Modify: `src/App.tsx`（テーマセレクタ移動、機能リスト更新）
- Modify: `src/components/ProBanner.tsx`（FEATURES）
- Modify: `docs/superpowers/specs/2026-07-04-free-first-strategy-design.md`（テーマ行）

**Interfaces:**
- Consumes: `theme` state・`setTheme`・`saveTheme`（既存、App.tsx 内）

- [ ] **Step 1: テーマセレクタをサブスク限定ブロックの外へ移動する**

`src/App.tsx` のサブスク限定ブロック内にある次のテーマ設定行（`premiumSettingsRow` の div、テーマボタンを含む）を削除する:

```tsx
                <div className="premiumSettingsRow">
                  <span className="premiumSettingsLabel">テーマ</span>
                  <div className="themeSelector">
                    {(['default', 'dark'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={`themeBtn ${theme === t ? 'active' : ''}`}
                        onClick={() => {
                          setTheme(t)
                          document.documentElement.setAttribute('data-theme', t)
                          void saveTheme(t)
                        }}
                      >
                        {t === 'default' ? '標準' : 'ダーク'}
                      </button>
                    ))}
                  </div>
                </div>
```

そして、`{isSubscriber ? (...) : (<ProBanner ... />)}` ブロック全体の**直後**（全ユーザーに見える位置）に、常時表示の表示設定ブロックとして追加する:

```tsx
          <div className="displaySettings">
            <span className="displaySettingsLabel">テーマ</span>
            <div className="themeSelector">
              {(['default', 'dark'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`themeBtn ${theme === t ? 'active' : ''}`}
                  onClick={() => {
                    setTheme(t)
                    document.documentElement.setAttribute('data-theme', t)
                    void saveTheme(t)
                  }}
                >
                  {t === 'default' ? '標準' : 'ダーク'}
                </button>
              ))}
            </div>
          </div>
```

- [ ] **Step 2: 表示設定ブロックの CSS を追加する**

`src/App.css` の末尾に追加:

```css
.displaySettings {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  margin-bottom: 12px;
}

.displaySettingsLabel {
  font-size: 12px;
  font-weight: 700;
  color: #475569;
}
```

- [ ] **Step 3: サブスク限定ブロックの「利用可能な機能」リストを更新する**

`src/App.tsx` のサブスク限定ブロック内の機能リスト。現在:

```tsx
                <div className="premiumFeatureSection">
                  <p className="premiumSectionLabel">利用可能な機能</p>
                  <ul className="premiumFeatureList">
                    <li>課題へのメモ・優先度設定</li>
                    <li>ダークテーマ</li>
                    <li>クロスデバイス同期</li>
                    <li>手動課題の追加</li>
                    <li>LETUS上の登録済みインジケーター</li>
                    <li>限定 Discord コミュニティ招待</li>
                  </ul>
                </div>
```

を次に置き換える（有料の 2 機能のみ掲示）:

```tsx
                <div className="premiumFeatureSection">
                  <p className="premiumSectionLabel">サブスク特典</p>
                  <ul className="premiumFeatureList">
                    <li>カスタム通知ルール（科目別の締切通知タイミング）</li>
                    <li>限定 Discord コミュニティ招待</li>
                  </ul>
                </div>
```

- [ ] **Step 4: `ProBanner.tsx` の FEATURES を更新する**

`src/components/ProBanner.tsx` の:

```ts
const FEATURES = [
  '課題へのメモ・優先度設定',
  'ダークテーマ',
  'クロスデバイス同期（PC・研究室・自宅）',
  '手動での課題追加',
  'LETUS上の登録済みインジケーター',
  '限定 Discord コミュニティ招待',
]
```

を次に置き換える:

```ts
const FEATURES = [
  'カスタム通知ルール（科目別の締切通知タイミング）',
  '限定 Discord コミュニティ招待',
]
```

- [ ] **Step 5: free-first 戦略書のテーマ行を無料へ更新する**

`docs/superpowers/specs/2026-07-04-free-first-strategy-design.md` の §2「機能全般」表のテーマ行:

```
| テーマ | — | ✅（実装済み） |
```

を次に置き換える:

```
| テーマ | ✅（2026-07-04 無料化） | — |
```

- [ ] **Step 6: 型チェック・ビルド**

Run: `pnpm exec tsc -b`
Expected: エラーなし

Run: `pnpm build`
Expected: 成功

- [ ] **Step 7: コミット**

```bash
git add src/App.tsx src/App.css src/components/ProBanner.tsx docs/superpowers/specs/2026-07-04-free-first-strategy-design.md
git commit -m "feat(ext): make theme free, update upsell copy to notification-rules + Discord only"
```

---

## 完了条件

- Task 1〜2 の全チェックボックス完了
- `pnpm exec tsc -b`・`pnpm build`・`pnpm exec vitest run src` 全緑
- 非サブスクでメモ・優先度が編集でき、ロック表示（🔒・「サブスクライバー限定機能です」）が出ない
- テーマが全ユーザーで切替可能（常時表示の表示設定ブロック）
- ProBanner と機能リストの有料掲示がカスタム通知ルール・Discord のみ
- 未使用 `PremiumGate` が削除されている
- バックエンド変更なし（ラズパイデプロイ不要）
