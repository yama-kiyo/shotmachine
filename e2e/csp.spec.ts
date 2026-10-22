// セキュリティヘッダ（正本 vercel.json を vite preview でも返す）の下で、主要フローが CSP 違反なく動くことを確認する。
// VRM読込（ArrayBuffer→blob: テクスチャ）・サムネイル（data: 画像）・保存→再読込・アニマティック再生を通す。
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VRM_PATH = path.resolve(__dirname, 'sample.vrm')

test('CSP/セキュリティヘッダ下で主要フローに違反が出ない', async ({ page }) => {
  test.setTimeout(120_000)
  const consoleErrors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] }
    w.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
  })

  const res = await page.goto('/')
  const h = res!.headers()
  expect(h['content-security-policy']).toContain("default-src 'self'")
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'")
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['referrer-policy']).toBe('no-referrer')
  expect(h['cross-origin-opener-policy']).toBe('same-origin')

  // サンプルシーン
  await page.getByTestId('menu-file').click()
  await page.getByRole('button', { name: /サンプルを開く/ }).click()
  await expect(page.getByTestId('pip-panel')).toBeVisible()
  await page.waitForTimeout(1200)

  // ショットキャプチャ → サムネイル（data:image/jpeg）が img で実際に描画される
  await page.getByTestId('capture-shot').click()
  await expect(page.getByTestId('shot-card-0')).toBeVisible()
  const thumbWidth = () => page.getByTestId('shot-card-0').locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)
  await expect.poll(thumbWidth).toBeGreaterThan(0)

  // VRM 読込（先頭キャラを選択して差し替え）
  await page.getByTestId('outliner-characters').getByText('Maya').click()
  const vrmChooser = page.waitForEvent('filechooser')
  await page.getByTestId('vrm-load').click()
  await (await vrmChooser).setFiles(VRM_PATH)
  await expect(page.getByTestId('vrm-load')).toContainText('sample.vrm')
  await page.waitForTimeout(4000) // VRMパース・テクスチャ展開

  // 保存 → 再読込（検証済みの読込経路を通す）
  await page.getByTestId('menu-file').click()
  const download = page.waitForEvent('download')
  await page.getByText('プロジェクトを保存（JSON）').click()
  const saved = await (await download).path()
  await page.getByTestId('menu-file').click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByText('プロジェクトを開く…').click()
  await (await chooser).setFiles(saved!)
  await expect(page.getByTestId('shot-card-0')).toBeVisible()
  await expect.poll(thumbWidth).toBeGreaterThan(0)

  // アニマティック再生
  await page.getByTestId('tab-animatic').click()
  await page.getByTestId('play-button').click()
  await expect(page.getByTestId('timecode')).not.toContainText('0:00 /', { timeout: 5000 })

  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)
  expect(violations).toEqual([])
  expect(consoleErrors.filter((t) => /Content Security Policy|Refused to/i.test(t))).toEqual([])
})
