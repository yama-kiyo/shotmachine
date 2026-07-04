#!/bin/bash
# build → playwright を1回回すループ用スクリプト
set -e
cd "$(dirname "$0")/.."
echo "[$(date +%H:%M:%S)] building..."
npx vite build > /tmp/build-loop.log 2>&1
echo "[$(date +%H:%M:%S)] build exit=$?"
tail -3 /tmp/build-loop.log
echo "[$(date +%H:%M:%S)] running playwright..."
npx playwright test --config=playwright.dev.config.ts --reporter=line > /tmp/pw-loop.log 2>&1
echo "[$(date +%H:%M:%S)] pw exit=$?"
tail -3 /tmp/pw-loop.log
echo "[$(date +%H:%M:%S)] done"
