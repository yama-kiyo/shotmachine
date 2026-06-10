import { describe, it, expect } from 'vitest'
import { focalToHFovDeg, focalToVFovDeg, effectiveSensor, hFovToFocal } from '../lens'

describe('レンズ計算（フルフレーム36×24mm）', () => {
  // 既知値: hFOV = 2·atan(36/2f)。スクショの「65mm · 31°」と一致すること
  const known: Array<[number, number]> = [
    [14, 104.25], [18, 90.0], [24, 73.74], [28, 65.47], [35, 54.43],
    [50, 39.6], [65, 30.96], [85, 23.91], [100, 20.41], [135, 15.19],
  ]
  it.each(known)('%dmm → 水平FOV %d°（16:9、±0.1°）', (focal, expected) => {
    expect(focalToHFovDeg(focal, 16 / 9)).toBeCloseTo(expected, 1)
  })

  it('65mmはUI表示で31°に丸まる', () => {
    expect(Math.round(focalToHFovDeg(65, 16 / 9))).toBe(31)
  })

  it('16:9の有効センサーは36×20.25mm（縦クロップ）', () => {
    const { w, h } = effectiveSensor(16 / 9)
    expect(w).toBeCloseTo(36, 5)
    expect(h).toBeCloseTo(20.25, 5)
  })

  it('9:16（縦）の有効センサーは13.5×24mm（横クロップ）', () => {
    const { w, h } = effectiveSensor(9 / 16)
    expect(w).toBeCloseTo(13.5, 5)
    expect(h).toBeCloseTo(24, 5)
  })

  it('垂直FOV 50mm/16:9 = 22.90°', () => {
    expect(focalToVFovDeg(50, 16 / 9)).toBeCloseTo(22.9, 1)
  })

  it('hFovToFocalは逆関数（往復誤差なし）', () => {
    for (const f of [14, 35, 65, 135]) {
      expect(hFovToFocal(focalToHFovDeg(f, 16 / 9), 16 / 9)).toBeCloseTo(f, 6)
    }
  })
})
