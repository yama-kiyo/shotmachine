# 🎬 ショットマシン STUDIO V2

台本テキストから、キャラがしゃべるカットシーン（アニマティック動画）を半自動生成する3Dショット計画ツール。

**Web版**: https://yama-kiyo.github.io/shotmachine/

## 主な機能

- **📜 スクリプトモード** — 台本貼付（`名前「セリフ」`／`名前（感情）「セリフ」`／ト書き）→ ⚡一発でキャラ配置・MASTER/OTS/CU切り返しカメラ・180°軸・カット列を自動生成
- **⏱ タイムライン（V2）** — 編集ソフト風トラックUI。カット境界ドラッグ（ロール/リップル）・再生ヘッド位置での分割・カメラ差し替え・音声クリップ移動・±1コマnudge（24fps）・スナップ
- **📷 カメラキーフレーム（v2.4）** — カット内に任意個のカメラKFを打ち、タイムライン上の◇をドラッグして時刻を編集。「2秒静止→1秒で寄る→0.5秒でパン」のような複合ワークが、再生・動画書き出し・絵コンテ・AIプロンプトの全系統に反映される。カットを分割しても境界にKFが挿入されて動きが途切れない
- **🎯 フレーミング対象の指定（v2.4）** — カメラごとに **フリー（手動）／対象キャラ** を選択。フリーならキャラの有無に関わらず完全手動で操作でき、対象を選ぶとサイズ合わせ（EWS〜ECU/OTS/POV/2S）が有効になる
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

APIキー（いずれも任意）は**起動後の画面から入力**します（BYOK）。キーはそのブラウザの localStorage にのみ保存され、各APIへの直接呼び出し以外には送信されません。画面の🔑✕／削除ボタンでいつでも消せます。

| キー | 用途 | 入力場所 |
|---|---|---|
| ElevenLabs | TTS＋リップシンク | スクリプトタブのボイス欄 |
| Anthropic | シーンチャット（日本語でシーン操作） | シーンチャットタブ |

環境変数・`.env` からキーを読む仕組みはありません。`VITE_*KEY` / `VITE_*TOKEN` / `VITE_*SECRET` に値があると `npm run build` が失敗し、`dist/` にキー形状の文字列が混入した場合も失敗します（`scripts/check-bundle.mjs`）。

セキュリティヘッダ（CSP 等）の正本は `vercel.json`。`npm run build && npx vite preview` でも同じヘッダが付き、`e2e/csp.spec.ts` が CSP 違反の有無を検証します。

## アーキテクチャ

- `src/core/` — レンズ数学・フレーミング・180°判定・自動カット割り・カットトラック編集・リップシンク・キーフレーム補間などの**純関数層**（three/react非依存、単体テスト済み）
- `src/three/` — Three.js（react-three-fiber）3D表示・VRMアバター・機材モデル・キャプチャ
- `src/services/` — ElevenLabs TTS・音声バス・動画/フレーム書き出し・VRMライブラリ・シーンチャットツール
- `src/state/` — Zustandストア（zundo Undo/Redo）
- `src/ui/` / `src/export/` — パネル群・タイムライン・PDF/PNG/CSV/ZIP/プロンプト出力

## 注意

- `.env`・`dist/` はコミット対象外（.gitignore済み）
- APIキーはブラウザのlocalStorageのみ（BYOK）。外部送信はElevenLabs / Anthropic APIへの直接呼び出しのみ
- プロジェクトファイル（.shotmachine.json）の読込は上限64MB・型検証・`__proto__` 等の危険キー除去・サムネイル/音声は base64 dataURL のみ・voice_id は英数字のみ（`src/model/sanitize.ts`）

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
