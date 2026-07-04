#!/bin/bash
# ショットマシン STUDIO V2 ローカル起動（Mac版・プライベート版）
#
# Dropbox 上では実行権限が剥がれ、node_modules も Windows 用バイナリ（rollup等）が
# 入っているため Mac では動かない。よって src/ など必要ファイルだけを Mac ローカル
# (~/shotmachine-studio-v2-local/) に rsync で同期し、そこで Mac 専用 node_modules を
# 作って起動する。Dropbox 同期の Windows 側 node_modules は一切触らない。
# 同期先は V1 (~/shotmachine-studio-local/) と別フォルダ。V1 と消し合わないこと。
#
# Finder でダブルクリック or ターミナルから:
#   bash start-mac.command

set -e

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_DIR="$HOME/shotmachine-studio-v2-local"

mkdir -p "$LOCAL_DIR"

echo "Syncing src/ to $LOCAL_DIR ..."
# node_modules / dist / test-results / .vite はコピーしない（プラットフォーム依存・キャッシュ）
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'test-results' \
  --exclude '.vite' \
  --exclude '.git' \
  --exclude '_backup' \
  --exclude '*.tmp.*' \
  "$SOURCE_DIR/" "$LOCAL_DIR/"

cd "$LOCAL_DIR"

if [ ! -d node_modules ]; then
  echo "Installing Mac-native dependencies (初回のみ・5〜10分)..."
  npm install
fi

echo "Building... (src/ の変更を反映)"
node ./node_modules/vite/bin/vite.js build

echo "Starting preview server on http://localhost:5183/"
( sleep 2 && open "http://localhost:5183/" ) &

node ./node_modules/vite/bin/vite.js preview --port 5183 --strictPort
