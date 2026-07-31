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

test('台本生成カメラにはフレーミング対象が焼かれている（CU Dan は Dan を狙う）', async ({ page }) => {
  await importSampleAndOpenTimeline(page)
  const rows = await page.evaluate(() => {
    const st = (window as any).useStore.getState()
    const nameById = new Map(st.project.scene.characters.map((c: any) => [c.id, c.name]))
    return st.project.scene.cameras.map((c: any) => ({
      cam: c.name, target: c.frameTargetId ? nameById.get(c.frameTargetId) : null,
    }))
  })
  expect(rows.length).toBeGreaterThan(0)
  // 全カメラに対象が設定されている（フリーのまま取り残されない）
  for (const r of rows as Array<{ cam: string; target: string | null }>) {
    expect(r.target).toBeTruthy()
  }
  // OTS/CU/MCU は名前に人物名が入るので、その人物が対象になっている
  // （MASTER は2ショットなので名前に人物名を含まない。対象は軸のキャラA）
  const named = (rows as Array<{ cam: string; target: string }>).filter((r) => r.cam !== 'MASTER')
  expect(named.length).toBeGreaterThan(0)
  for (const r of named) expect(r.cam).toContain(r.target)
})

// カメラKF: 「タイムラインで打ったキーが、実際の再生カメラを動かす」ことの実機検証。
// 3Dギズモ操作の代わりに store の updateCameraPose でカメラを動かす（ギズモの終着点は同じAPI）。
test.describe('カメラキーフレーム', () => {
  const evalPoseAt = (page: Page, t: number) =>
    page.evaluate((time) => {
      const win = window as unknown as {
        useStore?: { getState: () => any }
        __shotmachine_test__?: { animaticPoseAt: (s: any, c: any, t: number) => any }
      }
      const st = win.useStore?.getState?.()
      const api = win.__shotmachine_test__
      if (!st || !api) return null
      const p = api.animaticPoseAt(st.project.shots, st.project.scene.cameras, time)
      return p ? { x: p.position.x, y: p.position.y, z: p.position.z, focal: p.focalLength } : null
    }, t)

  test('◇＋で打ったKFが再生時のカメラポーズを実際に動かす', async ({ page }) => {
    await importSampleAndOpenTimeline(page)

    // 先頭カットの頭に再生ヘッドを置き、1本目のKFを打つ
    await page.evaluate(() => (window as any).useStore.getState().scrubTo(0.05))
    await page.getByTestId('tl-addcamkf').click()
    await expect(page.getByTestId('tl-camkey-0-0')).toBeVisible()

    // カメラを大きく動かしてから、同じカット内の後ろ寄りで2本目のKFを打つ
    const cutDur = await page.evaluate(() => (window as any).useStore.getState().project.shots[0].durationSec)
    await page.evaluate(() => {
      const st = (window as any).useStore.getState()
      const shot = st.project.shots[0]
      st.updateCameraPose(shot.cameraId, { position: { x: 40, y: 1.5, z: 3 }, focalLength: 85 })
    })
    await page.evaluate((d) => (window as any).useStore.getState().scrubTo(d - 0.05), cutDur)
    await page.getByTestId('tl-addcamkf').click()
    await expect(page.getByTestId('tl-camkey-0-1')).toBeVisible()

    // 再生時のカメラポーズが、カット頭・中間・末尾で実際に変化する
    const head = await evalPoseAt(page, 0.05)
    const mid = await evalPoseAt(page, cutDur / 2)
    const tail = await evalPoseAt(page, cutDur - 0.05)
    expect(head).not.toBeNull()
    expect(tail!.x).toBeGreaterThan(head!.x + 10) // 終点へ向かって実際に動いている
    expect(mid!.x).toBeGreaterThan(head!.x)
    expect(mid!.x).toBeLessThan(tail!.x)
    expect(tail!.focal).toBeGreaterThan(head!.focal) // 焦点距離も補間される
  })

  test('カメラKFがムーブ種別と派生キャッシュ（絵コンテ・CSV・プロンプトの参照元）へ伝わる', async ({ page }) => {
    await importSampleAndOpenTimeline(page)
    const shot0 = () => page.evaluate(() => {
      const s = (window as any).useStore.getState().project.shots[0]
      return { moveType: s.moveType, hasB: !!s.poseSnapshot.b, focal: s.focalLength, ax: s.poseSnapshot.a.position.x }
    })
    expect((await shot0()).moveType).toBe('Static')

    await page.evaluate(() => (window as any).useStore.getState().scrubTo(0.05))
    await page.getByTestId('tl-addcamkf').click()
    await page.evaluate(() => {
      const st = (window as any).useStore.getState()
      st.updateCameraPose(st.project.shots[0].cameraId, { position: { x: 0, y: 1.5, z: 0.4 }, focalLength: 85 })
    })
    const cutDur = await page.evaluate(() => (window as any).useStore.getState().project.shots[0].durationSec)
    await page.evaluate((d) => (window as any).useStore.getState().scrubTo(d - 0.05), cutDur)
    await page.getByTestId('tl-addcamkf').click()

    const after = await shot0()
    expect(after.moveType).not.toBe('Static')
    // poseSnapshot.b が入る＝promptGen の movementText が 'static camera, locked off' を返さなくなる
    expect(after.hasB).toBe(true)
  })

  test('カメラKFのカットのAIプロンプトに、静止ではなく実際のムーブが出る', async ({ page }) => {
    await importSampleAndOpenTimeline(page)
    await page.evaluate(() => (window as any).useStore.getState().scrubTo(0.05))
    await page.getByTestId('tl-addcamkf').click()
    // 被写体へ寄せる（Push-in になる方向へ動かす）
    await page.evaluate(() => {
      const st = (window as any).useStore.getState()
      const shot = st.project.shots[0]
      const cam = st.project.scene.cameras.find((c: any) => c.id === shot.cameraId)
      const p = cam.pose
      const dir = {
        x: p.lookAt.x - p.position.x, y: p.lookAt.y - p.position.y, z: p.lookAt.z - p.position.z,
      }
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1
      st.updateCameraPose(shot.cameraId, {
        position: {
          x: p.position.x + (dir.x / len) * 1.2,
          y: p.position.y + (dir.y / len) * 1.2,
          z: p.position.z + (dir.z / len) * 1.2,
        },
      })
    })
    const cutDur = await page.evaluate(() => (window as any).useStore.getState().project.shots[0].durationSec)
    await page.evaluate((d) => (window as any).useStore.getState().scrubTo(d - 0.05), cutDur)
    await page.getByTestId('tl-addcamkf').click()

    const movement = await page.evaluate(() => {
      const st = (window as any).useStore.getState()
      const api = (window as any).__shotmachine_test__
      return api.shotToPromptJson(st.project.shots[0], st.project, 0).camera_movement as string
    })
    expect(movement).not.toContain('static camera')
    expect(movement).toMatch(/push-in|camera |zoom|compound/i)
  })

  test('カメラKFのあるカットを分割しても、両側にKFが残り動きが途切れない', async ({ page }) => {
    await importSampleAndOpenTimeline(page)
    await page.evaluate(() => (window as any).useStore.getState().scrubTo(0.05))
    await page.getByTestId('tl-addcamkf').click()
    const cutDur = await page.evaluate(() => (window as any).useStore.getState().project.shots[0].durationSec)
    await page.evaluate(() => {
      const st = (window as any).useStore.getState()
      st.updateCameraPose(st.project.shots[0].cameraId, { position: { x: 30, y: 1.5, z: 3 } })
    })
    await page.evaluate((d) => (window as any).useStore.getState().scrubTo(d - 0.05), cutDur)
    await page.getByTestId('tl-addcamkf').click()

    // カット中央で分割
    const half = cutDur / 2
    const before = await evalPoseAt(page, half)
    await page.evaluate((t) => (window as any).useStore.getState().scrubTo(t), half)
    await page.getByTestId('tl-split').click()

    const keyCounts = await page.evaluate(() => {
      const shots = (window as any).useStore.getState().project.shots
      return [shots[0].camKeys?.length ?? 0, shots[1].camKeys?.length ?? 0]
    })
    expect(keyCounts[0]).toBeGreaterThanOrEqual(2)
    expect(keyCounts[1]).toBeGreaterThanOrEqual(2)
    // 分割点のポーズが分割前と一致＝モーションが途切れていない
    const after = await evalPoseAt(page, half)
    expect(Math.abs(after!.x - before!.x)).toBeLessThan(0.5)
  })

  test('KFを選択して Delete で削除できる', async ({ page }) => {
    await importSampleAndOpenTimeline(page)
    await page.evaluate(() => (window as any).useStore.getState().scrubTo(0.05))
    await page.getByTestId('tl-addcamkf').click()
    await expect(page.getByTestId('tl-camkey-0-0')).toBeVisible()
    await page.getByTestId('tl-camkey-0-0').click()
    await page.getByTestId('timeline-view').press('Delete')
    await expect(page.getByTestId('tl-camkey-0-0')).toHaveCount(0)
  })
})
