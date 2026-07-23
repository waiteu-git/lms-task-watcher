# ops/ — 運用スクリプト

現在このディレクトリにあるのは `litus-devlog/` のみ。手順は
[`litus-devlog/README.md`](litus-devlog/README.md) を参照。

- 実体は Node スクリプト（`collect` / `discord` / `publish` / `state`）で、
  Claude のスケジュールタスク `litus-devlog-report` から呼ばれる。
- 依存する環境変数は `DISCORD_DEVLOG_WEBHOOK` と `LITUS_REPO` の2つだけ。
  webhook URL は**リポジトリ内のファイルにもコミットにも置かない**（実行時にインラインで渡す）。
- テストは `node --test ops/litus-devlog/*.test.mjs`（14件）。
  ディレクトリ指定（`node --test ops/litus-devlog/`）はこの環境では失敗するので使わない。

## 撤去済み: 常時稼働デスクトップ用のシェル層（2026-07-22）

`nightly.sh` / `canary.sh` / `raspi-health.sh` / `competitor-watch.sh` /
`dev-digest.sh` と、その土台の `run.sh`（CIクローン同期ランチャー）・
`task.sh`（自走タスクCLI）・`lib/common.sh` を削除した。

前提だった常時稼働デスクトップ（WSL2 Ubuntu）が退役し、**どのホストからも
スケジュールされていない状態**になっていたため（Windows タスクスケジューラに
`LMS-*` 登録なし・ラズパイの crontab / systemd timer / `/etc/cron.d` にも参照なし、
いずれも実測）。動いていない設備の設計図と接続情報を公開リポジトリに
置き続けることになるので、露出整理と併せて撤去した。

復活させる場合は `git log -- ops/` から取り出せる。ただし当時のスクリプトは
ホスト名・SSHユーザー・鍵パス・巡回先URLを `~/ops/ops.env` から受け取る形に
直した直後の版なので、**構成値はリポジトリに書き戻さないこと**。

ラズパイ自身の死活監視は pi 側の `lmspi-health.timer` が独立して担っており、
このディレクトリには依存していない。
