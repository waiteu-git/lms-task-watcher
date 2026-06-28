# 設計書: アップデート通知ページ (changelog.html)

作成日: 2026-06-28

---

## 概要

Chrome拡張機能がアップデートされた後、ユーザーが初めてChromeを起動したときに更新内容ページを自動で新規タブに表示する。ページは拡張機能パッケージに同梱された静的HTMLファイルとして実装する。

---

## トリガー

`src/background/index.ts` の `chrome.runtime.onInstalled` リスナーに `reason` チェックを追加する。

- `reason === 'update'` のときのみ `changelog.html` を新規タブで開く
- `reason === 'install'`（新規インストール）では開かない
- 既存のアラーム登録処理はそのまま維持する

```ts
chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(ALARM_NAME, { ... })  // 既存処理

  if (details.reason === 'update') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('changelog.html') })
  }
})
```

---

## ページ構成 (public/changelog.html)

### 配置場所

`public/changelog.html` → ビルド時に `dist/changelog.html` へそのままコピーされる。Vite設定の変更不要。

### 構成セクション

1. **ヘッダー**: 拡張機能名 + バージョン番号 + 「アップデートしました」の見出し
2. **変更点**: 今バージョンのユーザー向け変更点をリストで記載
3. **ロードマップ**: フェーズ1（完了）・フェーズ2（近日公開）・フェーズ3（将来）の概要。技術的な実装詳細は記載しない
4. **フッター**: フィードバックフォームへのリンク

### スタイル方針

- インラインCSSで完結（外部CSSファイルへの依存なし）
- 拡張機能のポップアップに近い色調（白背景・ダークテキスト・アクセントカラー）
- モバイル考慮不要（Chromeタブで開くデスクトップページ）
- 最大幅 640px、中央寄せ

---

## バージョン管理方針

バージョン番号は `changelog.html` にハードコードする。リリースごとに以下の2ファイルを更新する：

1. `public/manifest.json` — `version` フィールドをインクリメント
2. `public/changelog.html` — ヘッダーのバージョン番号と変更点セクションを更新

---

## 対象外

- `onInstalled` の `reason === 'install'` 時の表示（オンボーディングは別タスク）
- バージョン番号の動的取得（`chrome.runtime.getManifest()` は使わない）
- 過去バージョンの変更履歴の蓄積（今バージョンの内容のみ表示）
