# 🎬 ショットマシン STUDIO V2

台本テキストから、キャラがしゃべるカットシーン（アニマティック動画）を半自動生成する3Dショット計画ツール。

**Web版**: https://yama-kiyo.github.io/shotmachine/

## 主な機能

- **📜 スクリプトモード** — 台本貼付（`名前「セリフ」`／`名前（感情）「セリフ」`／ト書き）→ ⚡一発でキャラ配置・MASTER/OTS/CU切り返しカメラ・180°軸・カット列を自動生成
- **⏱ タイムライン（V2）** — 編集ソフト風トラックUI。カット境界ドラッグ（ロール/リップル）・再生ヘッド位置での分割・カメラ差し替え・音声クリップ移動・±1コマnudge（24fps）・スナップ
- **🚶 キャラクターキーフレーム（V2強化）** — トラック上のダイヤ直接編集・オートキー🔴・3Dビューにモーションパス表示。位置・向き・姿勢・腕を補間再生
- **🔊 TTS＋リップシンク** — ElevenLabs v3で話者別セリフ音声（感情タグ対応）、文字タイムスタンプから「あいうえお」口形状を自動適用。まばたき・呼吸イドルつき（APIキーは画面から入力・localStorage保存）
- **🧍 VRMアバター** — VRoid等の.vrmを読込（実身長自動計測でフレーミング連動）。姿勢・腕ポーズプリセット
- **🎥 撮影機材の3Dモデル＋実発光** — 照明が実際にシーンを照らす。機材配置図PDF出力
- **📋 絵コンテ出力（V2強化）** — 各コマに尺（秒＋コマ）・IN/OUTタイムコード・セリフ付きのPDF/PNG。香盤CSV
- **🤖 AI動画生成連携（V2）** — Seedance生成パッケージ（各カットのIN点1920×1080参照フレーム＋プロンプトJSONをZIP一括出力）。Seedance/Veo/Runway向けプロンプト
- **🎬 アニマティック動画書き出し** — 字幕焼き込み・セリフ音声入りmp4/webm

## セットアップ（ローカル）

```bash
npm install
npm run build
起動.bat               # localhost:5183（vite preview）※Mac は 起動.command / start-mac.command（同ポート）
```

```bash
npm run dev        # 開発サーバー
npm test           # 単体テスト（Vitest）
npm run e2e        # E2Eテスト（Playwright・要ビルド済みdist）
```

ElevenLabs APIキー（任意・TTS利用時のみ）は起動後の画面から入力するか、`.env.example` を `.env` にコピーして設定。

## アーキテクチャ

- `src/core/` — レンズ数学・フレーミング・180°判定・自動カット割り・カットトラック編集・リップシンク・キーフレーム補間などの**純関数層**（three/react非依存、単体テスト済み）
- `src/three/` — Three.js（react-three-fiber）3D表示・VRMアバター・機材モデル・キャプチャ
- `src/services/` — ElevenLabs TTS・音声バス・動画/フレーム書き出し・VRMライブラリ・シーンチャットツール
- `src/state/` — Zustandストア（zundo Undo/Redo）
- `src/ui/` / `src/export/` — パネル群・タイムライン・PDF/PNG/CSV/ZIP/プロンプト出力

## 注意

- `.env`（APIキー）・`dist/`（キーを設定してビルドした場合に埋め込まれる）はコミット対象外（.gitignore済み）
- APIキーはブラウザのlocalStorageまたは.envのみ。外部送信はElevenLabs / Anthropic APIへの直接呼び出しのみ

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
