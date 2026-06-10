# 🎬 ショットマシン（Shot Machine）

AI映画製作者向けの3Dショット計画ツール。ブラウザだけで動きます。

**公開URL**: https://yama-kiyo.github.io/shotmachine/

## 主な機能

- **本物のレンズ計算** — フルフレーム36×24mm換算。65mm→31°など実レンズと同じ画角でフラスタム・プレビューに反映
- **俳優・カメラ・セットの3D配置** — マネキン・家具プロップ・複数カメラを配置、移動/回転ギズモで操作
- **ショットサイズ自動フレーミング** — EWS〜ECU/OTS/POV/2-SHOT/INSのボタン一発でカメラが正しい位置に
- **180°ルール警告** — アクション軸を設定するとライン越えカメラを赤色＋⚠で警告。「＋カバレッジ」でマスター+OTS×2+CU×2を正サイドに一括生成
- **カメラムーブ A→B** — 開始/終了ポーズを記録すると Push-in / Arc / Truck 等を自動分類、スライダーで補間プレビュー
- **アニマティック再生** — キャプチャしたショットを尺どおりに連続再生
- **ストーリーボード出力** — 業界慣習（ショット番号1A/1B、矢印記法、ACTION/NOTES欄）のPDF/PNGコンタクトシート
- **AI動画生成プロンプト出力** — ショットごとにSeedance/Veo/Runway向けプロンプトをMarkdown/JSONで一括出力
- **シーンチャット** — 自分のAnthropic APIキーで「もっとローアングルに」等の日本語指示でシーンを操作

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm test           # 単体テスト（Vitest）
npm run e2e        # E2Eテスト（Playwright）
npm run build      # 本番ビルド
```

## アーキテクチャ

- `src/core/` — レンズ数学・フレーミングソルバ・180°判定・ムーブ分類などの**純関数層**（three/react非依存、全て単体テスト済み）
- `src/three/` — Three.js（react-three-fiber）による3D表示・PIPプレビュー・キャプチャ
- `src/state/` — Zustandストア
- `src/ui/` — Reactパネル群
- `src/export/` — PDF/PNG/プロンプト/プロジェクトJSON出力

APIキーはブラウザのlocalStorageにのみ保存され、Anthropic API以外には送信されません。

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
