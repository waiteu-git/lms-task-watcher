# litus devlog — 手動実行手順（フェーズ①）

litus の進捗を「自分用ダイジェスト／X下書き／devlogエントリ」の3種にして Discord 管理ch へ届ける。

## 前提（1度だけ）
- Discord に管理専用チャンネルを作り、Webhook URL を取得 → 環境変数 `DISCORD_DEVLOG_WEBHOOK` に設定。
- litus は `/Users/waiteu/dev/litus`（別なら `LITUS_REPO` で指定）。

## 実行（2〜3日に1回、または「今回分やって」で）

1. 差分を収集:
   ```bash
   node ops/litus-devlog/collect.mjs > ops/litus-devlog/.delta.json
   cat ops/litus-devlog/.delta.json   # count / commits / changelogHead を確認
   ```
   **`count` が 0 のときは Step 2〜4 を実行せずスキップ（無投稿）。**

   （注: パスはリポジトリ相対の `ops/litus-devlog/.delta.json` を使うこと。`/tmp/...` のような絶対パスは使わない — このWindows+Git-Bash環境では bash の `/tmp` と Node の `/tmp`（`C:\tmp`）が別物になり、Node側が ENOENT で読めなくなるため。）

2. 下書き3種を作る（LLM/自分で）: `ops/litus-devlog/.delta.json` の commits・changelogHead **のみ**を根拠に、次の3セクションを1つのテキスト `ops/litus-devlog/.draft.txt` に書く。実データに無い機能は書かない。トーンは既存ランディング準拠。
   - `## 自分用ダイジェスト`（出た/進行中/次）
   - `## X下書き`（ハイライト1本。必要ならスレッド）
   - `## devlogエントリ`（`updates.html` に貼れるHTML断片。**必ず下の `.entry` 形式**で書く。デザイン（タイムライン・翠テーマ）は `updates.html` の `<style>` が `.entry` に付与するので、マークアップは classのみでよい。インラインstyleや別構造にしない）:
     ```html
     <div class="entry">
       <div class="date">YYYY-MM-DD</div>
       <h2>見出し（体言止め〜短文）</h2>
       <p>本文。複数段落や箇条書きも可。</p>
       <ul>
         <li><strong>小見出し。</strong> 補足。</li>
       </ul>
     </div>
     ```

3. Discord へ投稿:
   ```bash
   node ops/litus-devlog/discord.mjs ops/litus-devlog/.draft.txt
   ```

4. 状態を前進（次回の差分起点）:
   ```bash
   # 状態を前進（次回の差分起点）
   NEW=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).newestSha||'')" ops/litus-devlog/.delta.json)
   node -e "import('./ops/litus-devlog/state.mjs').then(m=>m.writeState('ops/litus-devlog/state.json',{lastSha:process.argv[1]||null,lastRunAt:new Date().toISOString()}))" "$NEW"
   git add ops/litus-devlog/state.json && git commit -m "chore(devlog): advance state to $NEW"
   ```

## 公開（レビュー後）
- X: Discordの `## X下書き` をコピペして @waiteu_dev で投稿（手動）。
- devlog（webへ公開）: ワンコマンド。

  ```bash
  # 保留中エントリ（ルーティンが .pending-entry.html / .pending-sha に残す）をそのまま公開:
  node ops/litus-devlog/publish.mjs
  # または明示指定:
  node ops/litus-devlog/publish.mjs <確定entry.html> <newestSha>
  ```

  `publish.mjs` は develop 上で「`landing/updates.html` のマーカー直後にエントリ挿入 → `state.json` を newestSha まで前進 → 対象2ファイルのみ commit → `git push origin develop`（Cloudflare 自動デプロイ）→ webhook設定時は管理chへ公開通知 → 保留中ファイル掃除」を一括で行う。develop 以外では誤爆防止で中断する。手動で `state.json` を前進させる旧手順（上記 Step 4）は不要。
