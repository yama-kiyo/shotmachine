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
  await page.getByTestId('error-boundary-reset').click()
  await expect(page.getByTestId('menu-file')).toBeVisible()
  await expect(boundary).toHaveCount(0)
})
