# ops/ — 運用スクリプト

現在このディレクトリにあるのは `litus-devlog/` のみ。手順は
[`litus-devlog/README.md`](litus-devlog/README.md) を参照。

- 実体は Node スクリプト（`collect` / `discord` / `publish` / `state`）で、
  Claude のスケジュールタスク `litus-devlog-report` から呼ばれる。
- 依存する環境変数は `DISCORD_DEVLOG_WEBHOOK` と `LITUS_REPO` の2つだけ。
  webhook URL は**リポジトリ内のファイルにもコミットにも置かない**（実行時にインラインで渡す）。
- テストは `node --test ops/litus-devlog/*.test.mjs`（14件）。
  ディレクトリ指定（`node --test ops/litus-devlog/`）はこの環境では失敗するので使わない。

かつて常時稼働デスクトップ（WSL2 Ubuntu）向けのシェル層があったが、そのホストの
退役に伴い2026-07-22に撤去済み（経緯・当時の実装は `git log -- ops/` を参照）。

ラズパイ自身の死活監視は pi 側の `lmspi-health.timer` が独立して担っており、
このディレクトリには依存していない。
