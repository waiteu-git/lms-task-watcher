# LETUS API締切ハイブリッド（API第一・HTML走査フォールバック）設計

作成: 2026-07-08 / 承認: 2026-07-08（ユーザー確認済み）
上位調査: `litus/docs/2026-07-07-structured-api-first-design.md`（LETUS/CLASS二系統方式の調査・本番実測結果を含む）

## 目的

締切スキャンの締切値を、日本語日付regex（`parseDeadline`）からMoodle sesskey AJAX APIの
Unixタイムスタンプへ置き換え、誤読（年/時刻補完・表記ゆれ・タイトル日付混入）を排除する。
純粋ロジックはltwで磨いてlitusへ移植する（フェーズ2「コード流通」方針）。

## 実測根拠（2026-07-07・LETUS本番）

- `core_calendar_get_action_events_by_timesort`（P1）は**未提出課題の締切のみ**を返す
  （月間ビュー42件との差分を実ページ検分し、差分は全て「評定のために提出済み」で実証）。
  `timesort`=Unix秒、`url`=クリーンな `/mod/assign/view.php?id=N`、`course.fullname` に7桁コード。
- `mod_assign_get_submission_status` / `core_course_get_contents` は `servicenotavailable`
  （**AJAX不可**）→ 提出状態はHTML課題ページ訪問が唯一の正。
- sesskeyは**生HTML**に `"sesskey":"..."` 形で埋まっており、background fetchで取得可能
  （ページ実行コンテキスト不要。実測でページ内 `M.cfg.sesskey` と一致確認）。
- 未提出表示の実文言は「**まだ提出されていません**」で、現行照合語「未提出」を含まない
  → `extractSubmissionStatus` が `unknown` に落ちるバグを併発見。

## 採用案（3案比較から案1・ユーザー確定）

**締切の正＝API、HTMLは提出状態のみ。** HTML課題ページ訪問は提出状態取得のため全件維持し、
締切だけAPI値で上書きする。速度は変わらないが締切の正確性をリスクゼロで得る。
- 不採用・案2（API事前フィルタで未提出のみ訪問）: 「候補にあるがP1に無い」が
  提出済み/締切なし/窓外の3義で、誤判定リスクと月間ビュー併用の複雑さに見合わない。
  案1安定後の第2段候補として保留。
- 不採用・案3（API単独）: 提出状態が取れず（P3不可が実測確定）、提出検知＝ltwの中核と衝突。

ロールアウトは**常時ON＋自動フォールバック**（feature flagなし）。失敗モードが現行挙動そのもの
（regex経路に自然に落ちる）ため。

## スコープ

- 対象: `scanDeadlinesInBackground` のみ。
- 無変更: 候補スキャン・コース更新検知（コースページHTMLが必須）、P2コース一覧API（ltwは手動登録制）、
  月間ビューP1'（案2の材料）。統計機能は見送り（2026-07-08決定）。
- 同梱バグ修正: `extractSubmissionStatus` の照合語に「まだ提出されていません」を追加し
  `not_submitted` を返す（`lifecycleStatus` への影響なし・表示の正確化のみ）。

## モジュール構成

| モジュール | 種別 | 内容 |
|---|---|---|
| `src/core/letusApi.ts`（新規） | 純粋 | `extractSesskey(html): string \| null` / `normalizeAssignmentUrl(url): string`（オリジン＋パス＋idのみ。`/mod/*/view.php` 全モジュール対象） / `mapActionEvents(json): Map<正規化URL, { deadlineIso: string; overdue: boolean }>`（assign/quiz等モジュール問わずurlを持つイベントを採用。不正エントリは安全に落とす） |
| `src/core/letusApi.fixtures.ts`（新規） | fixtures | 実測P1応答の匿名化版（成功14件・空・error応答） |
| `src/background/index.ts`（変更） | I/O | `fetchActionEvents(sesskey)`: service.phpへPOST（timesortfrom=now−90日, limitnum=50, 50件時は aftereventid ページング, 15秒タイムアウト） / `checkIsLoggedIn` の戻りを `{ status, html }` へ拡張しsesskey抽出を相乗り（追加リクエストゼロ） / 締切上書きの結線 / `extractSubmissionStatus` 文言追加 |

## データフロー

```
scanDeadlinesInBackground
  → checkIsLoggedIn の html から extractSesskey
  → fetchActionEvents → mapActionEvents → apiDeadlines
  → 候補A件のHTML訪問ループ（既存・無変更）:
      正規化URLが apiDeadlines に一致 → deadline=API値, deadlineSource='api'
      不一致（提出済み/締切なし/窓外/API失敗）→ 現行regex値, 'field'|'title'|null
```

突合キーは正規化URLのみ（courseId対応表は不要）。90日窓は期限超過・未提出の残留通知をカバー。

## フォールバック条件（常時ON・自動）

sesskey抽出失敗 / fetch非200 / JSONパース失敗 / `[0].error === true` / 15秒タイムアウト
→ `apiDeadlines` を空Mapにするだけ。ループは全件regex経路＝現行挙動。
sesskeyはスキャン毎に新規抽出のため `invalidsesskey` リトライ不要。API失敗はscanStatusに影響させない。

## セキュリティ

sesskeyは関数引数の受け渡しのみ。`chrome.storage` 保存・console出力・エラーメッセージへの混入を禁止。

## 型変更

`Assignment.deadlineSource: 'field' | 'title' | null` → `'api' | 'field' | 'title' | null`。
ダッシュボードで出自確認＝シャドーモード代替の検証手段。他の型は無変更。

## テスト（vitest・純粋層）

- `extractSesskey`: 実HTML断片 / sesskey無し / 壊れHTML
- `normalizeAssignmentUrl`: `forceview=1` 付き / フラグメント付き / quiz等の非assignモジュールURL / `/mod/*/view.php` 以外のURL
- `mapActionEvents`: 実測fixture / 空events / `error:true` / フィールド欠落イベント
- `extractSubmissionStatus`: 「まだ提出されていません」→ `not_submitted`

## litus移植面

- `letusApi.ts`＋fixtures → `litus/src/parsers/` へそのまま。
- I/O層のみ差し替え: background fetch → 注入JS fetch＋`postMessage`（`moodleApiMessage.ts`）。
- 文言バグ修正は `litus/src/parsers/letus.ts` にも同時適用（移植必須項目）。
