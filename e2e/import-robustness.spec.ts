// 壊れた／最小限のプロジェクトファイルを読んでも画面が真っ白にならないことの確認。
// （moveType 欠落で BoardTab の toUpperCase が落ちていた件の回帰テスト＋エラー境界の動作確認）
import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const pose = { position: { x: 0, y: 1.5, z: 3.5 }, lookAt: { x: 0, y: 1.2, z: 0 }, roll: 0, focalLength: 35 }
const camera = { id: 'cam_a', name: 'CAM A', pose, moveDurationSec: 4 }

async function openProject(page: Page, data: unknown): Promise<void> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sm-e2e-')), 'test.shotmachine.json')
  fs.writeFileSync(file, JSON.stringify(data))
  await page.getByTestId('menu-file').click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByText('プロジェクトを開く…').click()
  await (await chooser).setFiles(file)
}

for (const [label, data] of [
  ['v2 最小（moveType 欠落）', { version: 2, scene: { characters: [], cameras: [camera] }, shots: [{ poseSnapshot: { a: pose } }] }],
  ['v1 移設（moveType 欠落・dialogue 付き）', {
    version: 1, scene: { characters: [], cameras: [camera] },
    shots: [{ poseSnapshot: { a: pose }, dialogue: { speaker: 'A', text: 'こんにちは' } }],
  }],
] as const) {
  test(`${label} のファイルを開いてもボード・タイムラインが表示される`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('/')
    await openProject(page, data)
    await page.getByTestId('tab-board').click()
    await expect(page.getByTestId('board-grid')).toBeVisible()
    await page.getByTestId('tab-timeline').click()
    await expect(page.getByTestId('error-boundary')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('描画エラー時はエラー境界が復帰手段を出し、新規プロジェクトで再開できる', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('menu-file')).toBeVisible()
  // 想定外の状態を直接注入して描画エラーを起こす（E2E 用フック window.useStore）
  await page.evaluate(() => {
    const st = (window as unknown as { useStore: { setState: (f: (s: any) => any) => void } }).useStore
    st.setState((s) => ({ project: { ...s.project, scene: null } }))
  })
  const boundary = page.getByTestId('error-boundary')
  await expect(boundary).toBeVisible()
  // データやスタックトレースは表示しない
  await expect(boundary).not.toContainText(/TypeError|at |\.tsx|\.js/)
  // 履歴のスロットル（400ms）を超えてから復帰操作する＝壊れた状態が Undo 履歴に積まれる実使用の条件
  await page.waitForTimeout(800)
  await page.getByTestId('error-boundary-reset').click()
  await expect(page.getByTestId('menu-file')).toBeVisible()
  await expect(boundary).toHaveCount(0)
  // 復帰後に Undo しても壊れた状態へ戻らない（Undo 履歴を消している）
  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z')
  await page.waitForTimeout(300)
  await expect(boundary).toHaveCount(0)
  await expect(page.getByTestId('menu-file')).toBeVisible()
})

test('極端な値（カット尺 1e307・部屋幅 1e9）のファイルでもタイムラインと配置図書き出しが短時間で終わる', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await openProject(page, {
    version: 2,
    scene: {
      room: { width: 1e9, depth: 1e9, wallHeight: 1e9, showBackWall: true, showSideWall: true },
      characters: [], cameras: [camera], props: [],
    },
    shots: [{ poseSnapshot: { a: pose }, moveType: 'Static', durationSec: 1e307 }],
  })
  const t0 = Date.now()
  await page.getByTestId('tab-timeline').click()
  await expect(page.getByTestId('timeline-view')).toBeVisible()
  const timelineMs = Date.now() - t0
  expect(timelineMs).toBeLessThan(5000)
  const timings: Record<string, number> = { timelineMs }
  for (const label of ['機材配置図 PNG', '機材配置図 PDF']) {
    await page.getByTestId('menu-export').click()
    const dl = page.waitForEvent('download', { timeout: 10_000 })
    const t1 = Date.now()
    await page.getByText(label).click()
    await dl
    timings[label] = Date.now() - t1
    expect(timings[label]).toBeLessThan(5000)
  }
  test.info().annotations.push({ type: 'timings', description: JSON.stringify(timings) })
  console.log('[extreme-values timings]', JSON.stringify(timings))
  await expect(page.getByTestId('error-boundary')).toHaveCount(0)
  expect(errors).toEqual([])
})
