// 姿勢バグ実機検証スペック: VRMロード→sit/crouch/lie切替→スクリーンショット＆コンソールログ取得
import { test } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const VRM_PATH = path.resolve(__dirname, '..', 'vrm', 'gotou.vrm')

test.setTimeout(180_000)

test('pose-debug: VRMロード→sit/crouch/lie/stand＋腕ポーズ→スクショ＋コンソール', async ({ page }) => {
  const logs: string[] = []
  const dumpLogs = () => {
    try { fs.writeFileSync('test-results/pose-debug-console.log', logs.join('\n'), 'utf8') } catch {}
  }
  page.on('console', (msg) => {
    logs.push(`[${msg.type()}] ${msg.text()}`)
    if (logs.length % 30 === 0) dumpLogs()
  })
  page.on('pageerror', (err) => { logs.push(`[pageerror] ${err.message}\n${err.stack ?? ''}`); dumpLogs() })
  test.info().annotations.push({ type: 'final-dump' })

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(3000) // 初回 module bundling 待ち
    logs.push(`--- VRM file exists: ${fs.existsSync(VRM_PATH)} path=${VRM_PATH}`)
    logs.push(`--- page url: ${page.url()}`)
    dumpLogs()
    const menuFile = page.getByTestId('menu-file')
    await menuFile.waitFor({ state: 'visible', timeout: 60000 })

  // 新規プロジェクト（デフォルト空シーン）で実機検証
  // キャラを1人追加
  await page.getByTestId('add-character').click()
  await page.waitForTimeout(500)
  // 追加されたキャラを選択（テキスト「キャラ 1」）
  await page.getByTestId('outliner-characters').getByText(/キャラ ?1/).click()
  await page.waitForTimeout(400)

  // VRM ロード
  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 })
  await page.getByTestId('vrm-load').click()
  const chooser = await fileChooserPromise
  await chooser.setFiles(VRM_PATH)
  logs.push(`--- filechooser.setFiles done`)
  await page.waitForTimeout(6000) // VRMパース＋初期姿勢適用

  // ストア状態確認
  const charState = await page.evaluate(() => {
    const win = window as unknown as { useStore?: { getState: () => unknown } }
    const st = (win as any).useStore?.getState?.()
    const chars = st?.project?.scene?.characters
    return chars?.map((c: any) => ({ id: c.id, name: c.name, vrmFileName: c.vrmFileName, poseState: c.poseState }))
  })
  logs.push(`--- char state after VRM load: ${JSON.stringify(charState)}`)

  // pose 切替（毎回キャラを再選択して RightPanel が見える状態に）
  const canvas = page.getByTestId('main-viewport').locator('canvas').first()

  // カメラをキャラ正面斜め上から見るように設定
  const box = await canvas.boundingBox()
  if (box) {
    // canvas 中央でホイールズームイン
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -300)
      await page.waitForTimeout(80)
    }
    // 右ドラッグで視点を「少し斜め前から」見るように回す（腕の前後が分かる角度）
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 10 })
    await page.mouse.up({ button: 'right' })
    await page.waitForTimeout(300)
  }

  // ===== 姿勢スクショ =====
  for (const pose of ['stand', 'sit', 'crouch', 'lie'] as const) {
    await page.getByTestId('outliner-characters').getByText(/キャラ ?1/).click()
    await page.waitForTimeout(200)
    await page.getByTestId(`pose-${pose}`).click()
    await page.waitForTimeout(1500)
    await canvas.screenshot({ path: `test-results/pose-${pose}.png` })
    logs.push(`--- captured pose-${pose}.png`)
  }

  // standに戻す
  await page.getByTestId('outliner-characters').getByText(/キャラ ?1/).click()
  await page.waitForTimeout(200)
  await page.getByTestId('pose-stand').click()
  await page.waitForTimeout(800)

  // ===== 腕ポーズスクショ（正面斜め視点に調整）=====
  // カメラをよりキャラの「前面」から見る視点に
  if (box) {
    // 現在の視点からさらに前面寄りに調整
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(box.x + box.width / 2 - 50, box.y + box.height / 2 + 30, { steps: 8 })
    await page.mouse.up({ button: 'right' })
    await page.waitForTimeout(300)
  }

  for (const armPose of ['natural', 'hands_on_hips', 'crossed', 'wave', 'point'] as const) {
    await page.getByTestId('outliner-characters').getByText(/キャラ ?1/).click()
    await page.waitForTimeout(200)
    // 腕ポーズボタンが表示されているか確認（VRM必須）
    const armBtn = page.getByTestId(`arm-${armPose}`)
    const armBtnVisible = await armBtn.isVisible().catch(() => false)
    if (!armBtnVisible) {
      logs.push(`--- arm-${armPose} button not visible, skipping`)
      continue
    }
    await armBtn.click()
    await page.waitForTimeout(1500)
    await canvas.screenshot({ path: `test-results/arm-${armPose}.png` })
    logs.push(`--- captured arm-${armPose}.png`)
  }

  } finally {
    dumpLogs()
    console.log('=== captured console logs (count=' + logs.length + ') ===')
    for (const l of logs.slice(0, 150)) console.log(l)
  }
})
