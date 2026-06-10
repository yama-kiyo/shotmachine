import { describe, it, expect } from 'vitest'
import {
  solveFraming, solveOTS, solvePOV, solveTwoShot, SHOT_SIZE_DEFS, framingDistance, EYE_NORM,
} from '../framing'
import { focalToVFovDeg, focalToHFovDeg } from '../lens'
import { sideOf } from '../axis180'
import { v3, distanceXZ, sub, normalize, dot, deg, rad } from '../math'
import type { Character } from '../../model/types'

const AR = 16 / 9
const maya: Character = { id: 'a', name: 'Maya', color: '#f00', position: v3(-1, 0, 0), rotationY: Math.PI / 2, height: 1.68 }
const dan: Character = { id: 'b', name: 'Dan', color: '#00f', position: v3(1, 0, 0.5), rotationY: -Math.PI / 2, height: 1.8 }

describe('フレーミングソルバ', () => {
  it('距離の単調性: d(ECU) < d(CU) < d(MCU) < d(MS) < d(FS) < d(WS) < d(EWS)', () => {
    const sizes = ['ECU', 'CU', 'MCU', 'MS', 'FS', 'WS', 'EWS'] as const
    const ds = sizes.map((s) => distanceXZ(solveFraming(maya, s, 50, AR).position, maya.position))
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeGreaterThan(ds[i - 1])
  })

  it('逆投影: 被写体スパンがフレーム高に占める割合 = 定義値 ±2%', () => {
    for (const size of ['CU', 'MS', 'FS'] as const) {
      const def = SHOT_SIZE_DEFS[size]
      const pose = solveFraming(maya, size, 65, AR)
      const d = distanceXZ(pose.position, maya.position)
      const frameH = 2 * d * Math.tan(rad(focalToVFovDeg(65, AR)) / 2)
      const span = (def.top - def.bottom) * maya.height
      expect(span / frameH).toBeCloseTo(1, 1) // フレーム高=スパン（占有率100%）
      expect(Math.abs(span / frameH - 1)).toBeLessThan(0.02)
    }
  })

  it('長いレンズほどカメラが遠い（同一ショットサイズ）', () => {
    const d35 = distanceXZ(solveFraming(maya, 'CU', 35, AR).position, maya.position)
    const d85 = distanceXZ(solveFraming(maya, 'CU', 85, AR).position, maya.position)
    expect(d85).toBeGreaterThan(d35 * 2)
  })

  it('currentCamPos指定時は方位角を維持する', () => {
    const camPos = v3(-1, 1.5, 5) // 被写体の+Z側
    const pose = solveFraming(maya, 'MS', 50, AR, camPos)
    expect(pose.position.z).toBeGreaterThan(maya.position.z)
    expect(Math.abs(pose.position.x - maya.position.x)).toBeLessThan(0.01)
  })

  it('POVは目の高さ・視線方向', () => {
    const pose = solvePOV(maya, 35)
    expect(pose.position.x).toBeCloseTo(maya.position.x, 5)
    expect(pose.position.y).toBeCloseTo(EYE_NORM * maya.height, 5)
    const f = normalize(sub(pose.lookAt, pose.position))
    expect(f.x).toBeCloseTo(Math.sin(maya.rotationY), 5)
    expect(f.z).toBeCloseTo(Math.cos(maya.rotationY), 5)
  })

  it('OTSはロックサイドを維持する（両サイドとも）', () => {
    for (const side of [1, -1] as const) {
      const pose = solveOTS(maya, dan, 50, AR, side)
      // 軸 = maya↔dan（sideOfはa=maya, b=danで判定）
      expect(sideOf(maya.position, dan.position, pose.position)).toBe(side)
      // ターゲットの目を見ている
      expect(pose.lookAt.y).toBeCloseTo(EYE_NORM * maya.height, 5)
    }
  })

  it('2-SHOTは両者がフラスタム内に入る', () => {
    const pose = solveTwoShot(maya, dan, 35, AR)
    const f = normalize(sub(pose.lookAt, pose.position))
    const hHalf = rad(focalToHFovDeg(35, AR)) / 2
    for (const c of [maya, dan]) {
      const toChar = normalize(sub(v3(c.position.x, pose.position.y, c.position.z), pose.position))
      const angle = Math.acos(Math.min(1, dot(f, toChar)))
      expect(deg(angle)).toBeLessThan(deg(hHalf))
    }
  })

  it('2-SHOTもロックサイドを維持する', () => {
    for (const side of [1, -1] as const) {
      const pose = solveTwoShot(maya, dan, 35, AR, side)
      expect(sideOf(maya.position, dan.position, pose.position)).toBe(side)
    }
  })

  it('framingDistance: 身長1.75mのフルショットを50mm/16:9で撮る距離は約4.7m', () => {
    // span=1.89m(FS def 1.06-(-0.02)=1.08 × 1.75) → d = span/2/tan(vFov/2)
    const span = 1.08 * 1.75
    const d = framingDistance(span, 50, AR)
    expect(d).toBeCloseTo(span / 2 / Math.tan(rad(focalToVFovDeg(50, AR)) / 2), 6)
    expect(d).toBeGreaterThan(4)
    expect(d).toBeLessThan(6)
  })
})
