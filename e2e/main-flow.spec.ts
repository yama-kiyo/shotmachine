import { test, expect, Page } from '@playwright/test'

// WebGL描画の安定を待つ
async function waitForApp(page: Page) {
  await page.goto('/')
  // STUDIO版は空シーンで起動するため、ファイルメニューからサンプルを開いて検証する
  await page.getByTestId('menu-file').click()
  await page.getByRole('button', { name: /サンプルを開く/ }).click()
  await expect(page.getByTestId('pip-panel')).toBeVisible()
  await page.waitForTimeout(1200) // canvas初期レンダリング
}

test.describe('ショットマシン 主要フロー', () => {
  test('起動: サンプルシーンとPIPが表示される', async ({ page }) => {
    await waitForApp(page)
    await expect(page.getByTestId('project-name')).toHaveValue('Kitchen Argument (Sample)')
    await expect(page.getByTestId('slugline')).toHaveValue('INT. KITCHEN — NIGHT')
    // アウトライナーにMaya/Dan
    await expect(page.getByTestId('outliner-characters')).toContainText('Maya')
    await expect(page.getByTestId('outliner-characters')).toContainText('Dan')
    // カメラ3台
    await expect(page.getByTestId('outliner-cameras')).toContainText('CAM A')
    await expect(page.getByTestId('outliner-cameras')).toContainText('CAM C')
  })

  test('レンズ計算: 65mmで「31°」表示、プリセット切替', async ({ page }) => {
    await waitForApp(page)
    // CAM Cを選択（65mm）
    await page.getByTestId('outliner-cam-CAM-C').click()
    await expect(page.getByTestId('lens-readout')).toContainText('65mm')
    await expect(page.getByTestId('lens-readout')).toContainText('31°')
    // 50mmプリセット → 40°（39.6°の丸め）
    await page.getByTestId('lens-50').click()
    await expect(page.getByTestId('lens-readout')).toContainText('50mm')
    await expect(page.getByTestId('lens-readout')).toContainText('40°')
  })

  test('キャラクター・カメラの追加', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('add-character').click()
    await expect(page.getByTestId('outliner-characters')).toContainText('キャラ 3')
    await page.getByTestId('add-camera').click()
    await expect(page.getByTestId('outliner-cameras')).toContainText('CAM D')
  })

  test('自動フレーミング: 対象を選ぶとFRAME AS CUでカメラが動く', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('outliner-cam-CAM-A').click()
    // 新規カメラの既定はフリー（勝手に先頭キャラを狙わない）＝サイズ合わせは使えない
    await expect(page.getByTestId('frame-CU')).toBeDisabled()
    await page.getByTestId('frame-target').selectOption({ label: 'Maya' })
    const posX = page.getByTestId('cam-pos-x')
    const before = await posX.inputValue()
    await page.getByTestId('frame-CU').click()
    await page.waitForTimeout(300)
    const after = await posX.inputValue()
    expect(after).not.toBe(before)
  })

  test('フレーミング対象を選べる: 対象を変えると別のキャラを狙う', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('outliner-cam-CAM-A').click()
    // Maya を狙ってCU
    await page.getByTestId('frame-target').selectOption({ label: 'Maya' })
    await page.getByTestId('frame-CU').click()
    await page.waitForTimeout(200)
    const towardMaya = {
      x: parseFloat(await page.getByTestId('cam-pos-x').inputValue()),
      z: parseFloat(await page.getByTestId('cam-pos-z').inputValue()),
    }
    // 対象を Dan に変えて同じCU → 別の位置へ行く（旧実装では常に先頭キャラだった）
    await page.getByTestId('frame-target').selectOption({ label: 'Dan' })
    await page.getByTestId('frame-CU').click()
    await page.waitForTimeout(200)
    const towardDan = {
      x: parseFloat(await page.getByTestId('cam-pos-x').inputValue()),
      z: parseFloat(await page.getByTestId('cam-pos-z').inputValue()),
    }
    expect(Math.hypot(towardDan.x - towardMaya.x, towardDan.z - towardMaya.z)).toBeGreaterThan(0.3)
    // 対象はカメラに保持される（選択を切り替えても戻ってくる）
    await page.getByTestId('outliner-characters').getByText('Maya').click()
    await page.getByTestId('outliner-cam-CAM-A').click()
    await expect(page.getByTestId('frame-target')).toHaveValue(/.+/)
    const label = await page.getByTestId('frame-target').locator('option:checked').textContent()
    expect(label).toBe('Dan')
  })

  test('フリーのカメラはサイズ合わせに縛られず手動で動かせる', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('outliner-cam-CAM-A').click()
    // 既定フリー: フレーミングボタンは全て無効
    await expect(page.getByTestId('frame-CU')).toBeDisabled()
    await expect(page.getByTestId('frame-OTS')).toBeDisabled()
    // それでも位置は自由に変えられる
    await page.getByTestId('cam-pos-x').fill('2.75')
    await page.getByTestId('cam-pos-x').press('Enter')
    await page.waitForTimeout(150)
    expect(parseFloat(await page.getByTestId('cam-pos-x').inputValue())).toBeCloseTo(2.75, 1)
  })

  test('180°ルール: ライン越えで警告、サイド再設定で解消', async ({ page }) => {
    await waitForApp(page)
    // サンプルは軸設定済み（Maya-Dan）。CAM Aを反対サイドへ数値入力で移動
    await page.getByTestId('outliner-cam-CAM-A').click()
    const posZ = page.getByTestId('cam-pos-z')
    await posZ.fill('-4')
    await posZ.press('Enter')
    await expect(page.getByTestId('axis-warning')).toBeVisible()
    // サイド再設定（CAM A基準で再ロック）→ CAM AはOKになる
    await page.getByTestId('reestablish-side').click()
    // CAM B/Cが反対側になる可能性はあるが、警告状態は変化する。CAM A自体の⚠が消えることを確認
    await expect(
      page.getByTestId('outliner-cam-CAM-A').locator('.warn-icon'),
    ).toHaveCount(0)
  })

  test('カバレッジ自動生成: 5台追加され全て正サイド', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('add-coverage').click()
    await expect(page.getByTestId('outliner-cameras')).toContainText('MASTER')
    await expect(page.getByTestId('outliner-cameras')).toContainText('OTS Maya')
    await expect(page.getByTestId('outliner-cameras')).toContainText('CU Dan')
    // 警告が出ていない（全カメラ正サイド）— サンプル初期カメラも正サイドのはず
    await expect(page.getByTestId('axis-warning')).toHaveCount(0)
  })

  test('カメラムーブA→B: 分類表示と補間スライダー', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('outliner-cam-CAM-A').click()
    await page.getByTestId('set-pose-a').click()
    // 前進（被写体へ近づく）
    const posZ = page.getByTestId('cam-pos-z')
    await posZ.fill('1.5')
    await posZ.press('Enter')
    await page.getByTestId('set-pose-b').click()
    await expect(page.getByTestId('move-type')).toContainText('Push-in')
    await expect(page.getByTestId('move-slider')).toBeVisible()
  })

  test('ショットキャプチャ → ショットリスト → ボード表示', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('capture-shot').click()
    await expect(page.getByTestId('shot-card-0')).toBeVisible()
    // 2枚目: 別カメラで
    await page.getByTestId('pip-camera-select').selectOption({ label: 'CAM B' })
    await page.waitForTimeout(400)
    await page.getByTestId('capture-shot').click()
    await expect(page.getByTestId('shot-card-1')).toBeVisible()
    // サムネイルが空でない
    const src = await page.getByTestId('shot-card-0').locator('img').getAttribute('src')
    expect(src).toMatch(/^data:image\/jpeg/)
    // ボードタブ
    await page.getByTestId('tab-board').click()
    await expect(page.getByTestId('board-grid')).toBeVisible()
    await expect(page.getByTestId('board-grid')).toContainText('1A')
    await expect(page.getByTestId('board-grid')).toContainText('1B')
    // アニマティック再生
    await page.getByTestId('tab-animatic').click()
    await expect(page.getByTestId('animatic-view')).toBeVisible()
    await page.getByTestId('play-button').click()
    // タイムコードは整数秒表示なので1秒超過を待つ
    await expect(page.getByTestId('timecode')).not.toContainText('0:00 /', { timeout: 5000 })
  })

  test('プロジェクト保存JSONのダウンロード', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('capture-shot').click()
    await page.getByTestId('menu-file').click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByText('プロジェクトを保存（JSON）').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toContain('.shotmachine.json')
  })

  test('V2 姿勢制御: 座らせるとCUのカメラ高さが下がる', async ({ page }) => {
    await waitForApp(page)
    // 立位でCU（フレーミング対象は Maya を明示）
    await page.getByTestId('outliner-cam-CAM-A').click()
    await page.getByTestId('frame-target').selectOption({ label: 'Maya' })
    await page.getByTestId('frame-CU').click()
    await page.waitForTimeout(200)
    const standY = parseFloat(await page.getByTestId('cam-pos-y').inputValue())
    // Mayaを座らせる
    await page.getByTestId('outliner-characters').getByText('Maya').click()
    await page.getByTestId('pose-sit').click()
    // 再度CU
    await page.getByTestId('tab-camera').click()
    await page.getByTestId('frame-CU').click()
    await page.waitForTimeout(200)
    const sitY = parseFloat(await page.getByTestId('cam-pos-y').inputValue())
    expect(sitY).toBeLessThan(standY)
  })

  test('V2 ロケテンプレート: オフィス適用でセットが入れ替わる', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('template-select').selectOption('office')
    await expect(page.getByTestId('slugline')).toHaveValue('INT. OFFICE — DAY')
    await expect(page.locator('.left-panel')).toContainText('会議テーブル')
    // キャラ・カメラは維持される
    await expect(page.getByTestId('outliner-characters')).toContainText('Maya')
    await expect(page.getByTestId('outliner-cameras')).toContainText('CAM A')
  })

  test('V2 機材＋配置図: 機材を置いてPDFをダウンロード', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('add-prop-lightstand').click()
    await page.getByTestId('add-prop-dolly').click()
    await expect(page.locator('.left-panel')).toContainText('ライト+スタンド')
    await page.getByTestId('menu-export').click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByText('機材配置図 PDF').click()
    const dl = await downloadPromise
    expect(dl.suggestedFilename()).toContain('配置図')
  })

  test('V2 Undo/Redo: キャラ追加を取り消し・やり直し', async ({ page }) => {
    await waitForApp(page)
    await page.getByTestId('add-character').click()
    await expect(page.getByTestId('outliner-characters')).toContainText('キャラ 3')
    await page.getByTestId('undo').click()
    await expect(page.getByTestId('outliner-characters')).not.toContainText('キャラ 3')
    await page.getByTestId('redo').click()
    await expect(page.getByTestId('outliner-characters')).toContainText('キャラ 3')
  })

  test('シーンチャット: APIモックでカメラが下がる', async ({ page }) => {
    await waitForApp(page)
    // Anthropic APIをモック: adjust_camera(dy=-0.5)を返し、2回目はテキストで終了
    let call = 0
    const CORS = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    }
    await page.route('**/api.anthropic.com/**', async (route) => {
      // ブラウザ直アクセスのためCORSプリフライトにも応答する
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: CORS })
        return
      }
      call++
      if (call === 1) {
        await route.fulfill({
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({
            id: 'msg_1', type: 'message', role: 'assistant', model: 'mock',
            stop_reason: 'tool_use', stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [
              { type: 'tool_use', id: 'tu_1', name: 'adjust_camera', input: { dy: -0.5 } },
            ],
          }),
        })
      } else {
        await route.fulfill({
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({
            id: 'msg_2', type: 'message', role: 'assistant', model: 'mock',
            stop_reason: 'end_turn', stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [{ type: 'text', text: 'カメラを0.5m下げてローアングルにしました。' }],
          }),
        })
      }
    })
    // 現在のカメラ高さを記録
    await page.getByTestId('outliner-cam-CAM-C').click()
    const posY = page.getByTestId('cam-pos-y')
    const before = parseFloat(await posY.inputValue())
    // チャットタブでキー設定→送信
    await page.getByTestId('tab-chat').click()
    await page.getByTestId('api-key-input').fill('sk-ant-test-mock-key')
    await page.getByTestId('api-key-save').click()
    await page.getByTestId('chat-input').fill('もっとローアングルにして')
    await page.getByTestId('chat-send').click()
    // アシスタントの応答（モック2回目のテキスト）を待つ
    await expect(page.locator('.chat-msg.assistant')).toContainText('下げて', { timeout: 15000 })
    // カメラYが下がった（1.45 → 0.95）
    await expect.poll(async () => parseFloat(await posY.inputValue()), { timeout: 5000 }).toBeLessThan(before)
  })
  test('V3 時間帯・壁・機材光量・キーフレーム', async ({ page }) => {
    await waitForApp(page)
    // 時間帯切替
    await page.getByTestId('tod-night').click()
    await expect(page.getByTestId('tod-night')).toHaveClass(/active/)
    await page.getByTestId('tod-evening').click()
    await expect(page.getByTestId('tod-evening')).toHaveClass(/active/)
    // 壁のオンオフと位置スライダー
    await page.getByTestId('wall-back-toggle').uncheck()
    await expect(page.getByTestId('wall-back-z')).toHaveCount(0)
    await page.getByTestId('wall-back-toggle').check()
    await expect(page.getByTestId('wall-back-z')).toBeVisible()
    // 機材を追加 → 色・光量UIが出る
    await page.getByTestId('add-prop-lightstand').click()
    await expect(page.getByTestId('prop-color')).toBeVisible()
    await expect(page.getByTestId('prop-light-intensity')).toBeVisible()
    await page.getByTestId('prop-light-on').uncheck()
    await expect(page.getByTestId('prop-light-intensity')).toBeDisabled()
    // キーフレーム: キャラ選択 → 記録 → 削除
    await page.getByTestId('outliner-characters').getByText('Maya').click()
    await page.getByTestId('add-keyframe').click()
    await expect(page.getByTestId('kf-jump-0')).toBeVisible()
    await page.getByTestId('kf-remove-0').click()
    await expect(page.getByTestId('kf-jump-0')).toHaveCount(0)
  })
})
