#!/usr/bin/env bash
# 固定ランチャー: CIクローンを origin/develop に同期してから、その中のopsスクリプトを実行する。
# 開発ツリー（~/dev/lms-task-watcher）が未push・作業中・divergedでも影響を受けないための間接層。
#
# 設置: このファイルを ~/ops/run.sh にコピーして chmod +x（リポジトリ側を更新したら再コピー）
# 使い方: ~/ops/run.sh nightly|canary|raspi-health|competitor-watch
set -u
# shellcheck disable=SC1090
. "$HOME/.profile" 2>/dev/null || true

CI="$HOME/ops/ci/lms-task-watcher"
SRC="$HOME/dev/lms-task-watcher"

if [ ! -d "$CI/.git" ]; then
  REPO_URL=$(git -C "$SRC" remote get-url origin 2>/dev/null) || REPO_URL="git@github.com:waiteu-git/lms-task-watcher.git"
  mkdir -p "$HOME/ops/ci"
  git clone --branch develop "$REPO_URL" "$CI" || exit 1
fi

git -C "$CI" fetch origin develop && git -C "$CI" reset --hard origin/develop >/dev/null

# 実行中のreset --hardでスクリプト自身が書き換わらないよう、コピーを実行する
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp -r "$CI/ops" "$TMP/ops"
bash "$TMP/ops/$1.sh"
