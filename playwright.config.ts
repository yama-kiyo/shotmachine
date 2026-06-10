import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5180/shotmachine/',
    viewport: { width: 1600, height: 950 },
    screenshot: 'only-on-failure',
    launchOptions: {
      // CI環境でもWebGLを有効化
      args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    // ビルド済みdistを配信（Dropboxドライブ上でdevサーバーの依存最適化が遅いため）
    command: 'npx vite preview --port 5180 --strictPort',
    url: 'http://localhost:5180/shotmachine/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
