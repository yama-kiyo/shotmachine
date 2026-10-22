import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5183/',
    viewport: { width: 1600, height: 950 },
    screenshot: 'only-on-failure',
    launchOptions: {
      // CI環境でもWebGLを有効化
      args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    // ビルド済みdistを配信（Dropboxドライブ上でdevサーバーの依存最適化が遅いため）
    // reuseExistingServer: false — 残留サーバーを掴んで別バージョンを検証する事故の再発防止
    // E2E 用ビルド（テスト用フック入り・本番の dist とは別フォルダ）を CSP 付き preview で配信
    command: 'npm run build:e2e && npx vite preview --outDir dist-e2e --port 5183 --strictPort',
    url: 'http://localhost:5183/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
