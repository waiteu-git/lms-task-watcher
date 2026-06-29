# 作業ログ

作業の進捗・決定事項・問題と修正を時系列で記録する。

---

## 2026-06-29

### manualTaskWidget: enabledCourses フィルタ削除

**変更ファイル:** `src/content/manualTaskWidget.ts`

**問題:** `initManualTaskWidget()` 内で `courses.filter(c => c.enabled)` を使い、有効化済みコースのみに絞り込んでいた。その結果、コースが未有効化の状態ではウィジェットが表示されない。

**修正:** `enabledCourses` 変数を削除し、`courses` をそのまま渡すように変更。コースが1件も存在しない場合のみ早期リターン。

**理由:** ウィジェット（手動課題追加ボタン）はコースの有効/無効に関わらず表示すべき。有効/無効フィルタはダッシュボード表示側の責務。

---

### changelog 対応（直前コミット群）

- `feat(changelog)`: ロードマップのアコーディオン化、価格表示削除
- `fix(changelog)`: MV3 CSP 準拠のため外部スクリプト方式に変更
- `feat(changelog)`: Phase 2 をサブスク tier と明記、注釈追加
- 月額料金はユーザー向け UI に表示しない方針を決定（→ memory: `feedback_pricing_display.md`）

---

### ブランチ状況

- `develop` ブランチで v1.1.0 サブスク機能開発中
- `main` は v1.0.x バグ修正のみ
- 直前リリース: v1.1.0（手動課題追加・スキャン済みインジケーター）
