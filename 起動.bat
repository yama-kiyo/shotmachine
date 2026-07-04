@echo off
rem ショットマシン STUDIO V2 ローカル起動（プライベート版・非公開）
rem build → preview: srcの変更を反映してから配信（Dropbox上ではdev serverが不安定なため）
cd /d "%~dp0"
echo Building... (src/ の変更を反映)
call npx vite build
echo Starting preview server on http://localhost:5183/
start "" http://localhost:5183/
call npx vite preview --port 5183 --strictPort
