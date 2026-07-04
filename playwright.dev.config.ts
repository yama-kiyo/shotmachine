// build済みdistを別portで preview して spec 実行（Dropbox上ではvite devが不安定なため）
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'pose-debug.spec.ts',
  timeout: 120_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5189/',
    viewport: { width: 1600, height: 950 },
    launchOptions: {
      args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npx vite preview --port 5189 --strictPort',
    url: 'http://localhost:5189/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
