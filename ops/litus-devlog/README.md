# litus devlog — 手動実行手順（フェーズ①）

litus の進捗を「自分用ダイジェスト／X下書き／devlogエントリ」の3種にして Discord 管理ch へ届ける。

## 前提（1度だけ）
- Discord に管理専用チャンネルを作り、Webhook URL を取得 → 環境変数 `DISCORD_DEVLOG_WEBHOOK` に設定。
- litus は `C:/dev/litus`（別なら `LITUS_REPO` で指定）。

## 実行（2〜3日に1回、または「今回分やって」で）

1. 差分を収集:
   ```bash
   node ops/litus-devlog/collect.mjs > /tmp/litus-delta.json
   cat /tmp/litus-delta.json   # count / commits / changelogHead を確認
   ```
   `count` が 0 なら「今回は更新なし」＝スキップ（無投稿）。

2. 下書き3種を作る（LLM/自分で）: `/tmp/litus-delta.json` の commits・changelogHead **のみ**を根拠に、次の3セクションを1つのテキスト `/tmp/litus-draft.txt` に書く。実データに無い機能は書かない。トーンは既存ランディング準拠。
   - `## 自分用ダイジェスト`（出た/進行中/次）
   - `## X下書き`（ハイライト1本。必要ならスレッド）
   - `## devlogエントリ`（`updates.html` に貼れる日付つきHTML断片 or 素の文）

3. Discord へ投稿:
   ```bash
   node ops/litus-devlog/discord.mjs /tmp/litus-draft.txt
   ```

4. 状態を前進（次回の差分起点）:
   ```bash
   NEW=$(node -e "console.log(require('fs').readFileSync('/tmp/litus-delta.json','utf8'))" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).newestSha||''))")
   node -e "import('./ops/litus-devlog/state.mjs').then(m=>m.writeState('ops/litus-devlog/state.json',{lastSha:process.argv[1]||null,lastRunAt:new Date().toISOString()}))" "$NEW"
   git add ops/litus-devlog/state.json && git commit -m "chore(devlog): advance state to $NEW"
   ```

## 公開（レビュー後）
- X: Discordの `## X下書き` をコピペして @yning_y2 で投稿。
- devlog: `## devlogエントリ` を `landing/updates.html` の指定コメント直後に貼る → `git commit` → push（Cloudflare自動デプロイ）。
