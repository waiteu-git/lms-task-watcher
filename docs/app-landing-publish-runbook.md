# リタス ランディング 公開ランブック（/app）

対象: `feature/app-landing-litas` ブランチのリタス事前登録ランディングを本番公開し、Xで告知する手順。
状態: 実装・レビュー・翠テーマ化まで完了、`origin/feature/app-landing-litas` にpush済み・**develop未マージ（未公開）**。

公開すると `https://lms.waiteu.dev/app` が一般公開される。**フォーム送信先の `POST /api/waitlist` が動くよう、先にラズパイAPIをデプロイすること**（順序厳守）。

## 手順（この順序で）

### 1. ラズパイのAPIをデプロイ（先に）
フォームの送信先を先に生かす。これを飛ばすと公開直後のフォーム送信が404になる。

```bash
# ラズパイにSSH（Tailscale経由・鍵は project_raspi_connection 参照）
# api/ の変更（waitlistテーブル＋POST /api/waitlist）を反映
cd <ラズパイのリポジトリ>/api
git fetch origin
git checkout develop        # ※手順2でdevelopにマージ後にpull。マージ前ならfeatureブランチをpull
git pull
pm2 restart letus-api       # feedback_raspi_deploy_restart
pm2 logs letus-api --lines 20   # 起動確認
# 疎通確認（別端末から）
curl -s -X POST https://api.waiteu.dev/api/waitlist \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke-test@example.com","source":"runbook"}'
# → {"ok":true} が返ればOK
```

### 2. ランディングを本番へ（feature → develop）
`landing/*` はdevelopへのpushでCloudflare Pagesが自動デプロイ。

```bash
cd C:/dev/lms-task-watcher
git checkout develop
git pull origin develop
git merge feature/app-landing-litas
git push origin develop
# Cloudflare Pages が landing/* を自動ビルド・デプロイ（数分）
```

### 3. 本番確認
- `https://lms.waiteu.dev/app` が表示される（翠テーマ・リタス）
- `https://lms.waiteu.dev/app-og.png` が 200 で画像を返す（**X告知前に必須**）
- フォームに自分のメールを入れて送信 → 「事前登録が完了しました」表示
- ラズパイ側で `waitlist` テーブルに行が入ったことを確認（`sqlite3 data/app.db "SELECT * FROM waitlist;"`）
- スモークテスト行（手順1のsmoke-test@）は削除しておく

### 4. Xで告知（@yning_y2）
**手順3で og画像の200を確認してから投稿する**。Xはカード画像を初回取得時にキャッシュするため、画像が配信される前に投稿するとカードが出ない。
下の下書きから選ぶ。URLを貼ればOG（`app-og.png`）が自動でカード表示される。

---

## X告知 下書き

### A案（簡潔・1ツイート／推奨）
```
LETUSもCLASSも、スマホひとつに。

理科大生向けアプリ「リタス」開発中。課題の締切通知・CLASSの時間割・出席をスマホだけで。
CLASS連携などはまず、PC拡張機能「LETUS Task Watcher」v1.2.0で先行公開予定。

近日公開・事前登録↓
https://lms.waiteu.dev/app
```

### B案（スレッド）
1本目（フック）
```
理科大のLETUSとCLASS、アプリひとつにまとめました。

「リタス（Litas）」開発中。
LETUSの課題通知も、CLASSの時間割・出席も、スマホだけで完結。

近日公開・事前登録↓
https://lms.waiteu.dev/app
```
2本目（機能）
```
リタスでできること（公開時）
・課題を自動収集＆締切をプッシュ通知（24h/3h/1h前）
・毎朝、その日の締切をまとめて通知
・CLASS時間割の自動取込＆出席リマインド
・科目コードで課題と時間割を自動ひも付け
・締切間近の未提出を追いかける「見張り番」
```
3本目（LTW先行＋CTA）
```
CLASS連携（時間割・科目連携・シラバス・更新通知）は、アプリに先立ってPC拡張機能「LETUS Task Watcher」v1.2.0で先行公開予定。スマホ版を待たず、PCで先に使えます。

リタス事前登録↓
https://lms.waiteu.dev/app
```

### ハッシュタグ候補（任意で末尾に）
`#東京理科大` `#理科大` `#理科大生` `#東京理科大学`

補足: 絵文字はブランドトーン（ランディングは絵文字なしのクリーン基調）に合わせて控えめ推奨。付けるなら📱1つ程度。

---

## メモ
- アプリ本体（v2.0.0）はまだ開発中（公開目標2026年後期）。ランディングは事前登録の受け皿。
- 科目連携（課題↔時間割の自動ひも付け）はv2.0.0本体へ前倒し取り込み・1〜2週ロールアウト目標（project_v200_progress）。
- 未修正Minor（非ブロッカー・任意で後日）: waitlistレート制限Mapのstale掃除／メール形式のクライアント検証。
- 拡張機能（index.html）は紫のまま。app.htmlのみ翠にテーマ分岐済み。
