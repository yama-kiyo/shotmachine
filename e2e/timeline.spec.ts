import { test, expect, Page } from '@playwright/test'

// 台本サンプルを取り込んでカット列を生成し、タイムラインタブを開くまで
async function importSampleAndOpenTimeline(page: Page) {
  await page.goto('/')
  // スクリプトタブが初期表示。サンプル投入 → カット割り生成
  await page.getByTestId('script-sample').click()
  await expect(page.getByTestId('script-input')).not.toHaveValue('')
  await page.getByTestId('script-import').click()
  // 生成後はショットタブへ自動切替。タイムラインタブを開く
  await expect(page.getByTestId('tab-timeline')).toBeVisible()
  await page.getByTestId('tab-timeline').click()
  await expect(page.getByTestId('timeline-view')).toBeVisible()
  await page.waitForTimeout(300)
}

test.describe('タイムラインUI', () => {
  test('カットブロックが尺ラベル付きで描画される', async ({ page }) => {
    await importSampleAndOpenTimeline(page)
    await expect(page.getByTestId('tl-cut-0')).toBeVisible()
    // 尺ラベルは「x.xs」形式
    await expect(page.getByTestId('tl-cut-dur-0')).toContainText('s')
    // 複数カット生成されている
    expect(await page.locator('.tl-cut').count()).toBeGreaterThan(1)
  })

  test('再生ヘッドをスクラブして✂分割するとカット数が増える', async ({ page }) => {
    await importSampleAndOpenTimeline(page)
    const before = await page.locator('.tl-cut').count()
    // 先頭カットの中央へルーラーをクリックしてスクラブ（境界から十分離す）
    const cutBox = await page.getByTestId('tl-cut-0').boundingBox()
    const rulerBox = await page.getByTestId('tl-ruler').boundingBox()
    if (!cutBox || !rulerBox) throw new Error('bounding box not found')
    const x = cutBox.x + cutBox.width / 2 - rulerBox.x
    await page.getByTestId('tl-ruler').click({ position: { x, y: 8 } })
    await page.getByTestId('tl-split').click()
    await expect.poll(async () => page.locator('.tl-cut').count()).toBe(before + 1)
  })

  test('境界を選択してキーボードnudge（Shift+→）で尺ラベルが変わる', async ({ page }) => {
    await importSampleAndOpenTimeline(page)
    const durLabel = page.getByTestId('tl-cut-dur-0')
    const beforeText = await durLabel.textContent()
    // 先頭境界ハンドルをクリックしてフォーカス → Shift+→ で±1s nudge（ロール）
    await page.getByTestId('tl-boundary-0').click()
    await page.getByTestId('timeline-view').press('Shift+ArrowRight')
    await expect.poll(async () => durLabel.textContent()).not.toBe(beforeText)
  })

  test('◆＋ボタンでキーフレームを追加するとダイヤが出る', async ({ page }) => {
    await importSampleAndOpenTimeline(page)
    // 最初のキャラのラベル列 ◆＋ を押す（testidはcharId依存なので前方一致で拾う）
    const addBtn = page.locator('[data-testid^="tl-addkf-"]').first()
    await addBtn.click()
    await expect(page.locator('[data-testid^="tl-diamond-"]').first()).toBeVisible()
  })

  test('オートキートグルでビューポートに赤枠バッジが出る', async ({ page }) => {
    await importSampleAndOpenTimeline(page)
    await expect(page.getByTestId('autokey-badge')).toHaveCount(0)
    await page.getByTestId('tl-autokey').click()
    await expect(page.getByTestId('autokey-badge')).toBeVisible()
    await expect(page.getByTestId('autokey-border')).toBeVisible()
  })
})
