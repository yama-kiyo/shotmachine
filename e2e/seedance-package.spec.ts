import { test, expect, Page } from '@playwright/test'

// サンプルシーンを開いて描画を安定させる
async function waitForApp(page: Page) {
  await page.goto('/')
  await page.getByTestId('menu-file').click()
  await page.getByRole('button', { name: /サンプルを開く/ }).click()
  await expect(page.getByTestId('pip-panel')).toBeVisible()
  await page.waitForTimeout(1200) // canvas初期レンダリング
}

test.describe('Seedance生成パッケージ', () => {
  test('ショットをキャプチャ → ZIPパッケージがダウンロードされる', async ({ page }) => {
    await waitForApp(page)

    // 静止ショットとムーブ（Push-in）ショットの2つを用意
    await page.getByTestId('capture-shot').click()
    await expect(page.getByTestId('shot-card-0')).toBeVisible()

    await page.getByTestId('outliner-cam-CAM-A').click()
    await page.getByTestId('set-pose-a').click()
    const posZ = page.getByTestId('cam-pos-z')
    await posZ.fill('1.5')
    await posZ.press('Enter')
    await page.getByTestId('set-pose-b').click()
    await page.getByTestId('capture-shot').click()
    await expect(page.getByTestId('shot-card-1')).toBeVisible()

    // エクスポートメニューから書き出し
    await page.getByTestId('menu-export').click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByText('Seedance生成パッケージ（ZIP）').click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/_seedance_pkg\.zip$/)
    // 非自明なサイズ（PNG複数＋prompts.jsonを含む）
    const stream = await download.createReadStream()
    let size = 0
    for await (const chunk of stream) size += chunk.length
    expect(size).toBeGreaterThan(1000)
  })
})
