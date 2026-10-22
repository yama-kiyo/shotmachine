import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// セキュリティヘッダ（CSP 等）の正本は vercel.json。`vite preview` でも同じヘッダを返し、
// ローカル／E2E で本番と同じ CSP 下の動作を検証できるようにする（dev サーバーには付けない）
interface VercelHeaders { headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }> }
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as VercelHeaders
const securityHeaders = Object.fromEntries(
  (vercel.headers?.find((h) => h.source === '/(.*)')?.headers ?? []).map((h) => [h.key, h.value]),
)

export default defineConfig({
  // 相対パス: GitHub Pages（/shotmachine/ 配下）と Vercel（/ 直下）の両方で同じビルドが動く
  base: "./",
  plugins: [react()],
  preview: { headers: securityHeaders },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
