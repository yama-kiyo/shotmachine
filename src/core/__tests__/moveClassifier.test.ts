import { describe, it, expect } from 'vitest'
import { classifyMove } from '../moveClassifier'
import { v3 } from '../math'
import type { CameraPose } from '../../model/types'

const pose = (px: number, py: number, pz: number, lx = 0, ly = 1.2, lz = 0, focal = 50): CameraPose => ({
  position: v3(px, py, pz), lookAt: v3(lx, ly, lz), roll: 0, focalLength: focal,
})

describe('ムーブ分類器', () => {
  const base = pose(0, 1.5, 4)

  it('変化なし → Static', () => {
    expect(classifyMove(base, pose(0, 1.5, 4))).toBe('Static')
  })

  it('閾値未満の微動（<5cm, <2°）→ Static', () => {
    expect(classifyMove(base, pose(0.03, 1.5, 4))).toBe('Static')
  })

  it('位置固定で焦点距離のみ変化 → Zoom', () => {
    expect(classifyMove(base, pose(0, 1.5, 4, 0, 1.2, 0, 85))).toBe('Zoom')
  })

  it('位置固定で水平首振り → Pan', () => {
    expect(classifyMove(base, pose(0, 1.5, 4, 2, 1.2, 0))).toBe('Pan')
  })

  it('位置固定で垂直首振り → Tilt', () => {
    expect(classifyMove(base, pose(0, 1.5, 4, 0, 2.5, 0))).toBe('Tilt')
  })

  it('被写体へ前進 → Push-in', () => {
    expect(classifyMove(base, pose(0, 1.5, 2.5))).toBe('Push-in')
  })

  it('被写体から後退 → Pull-out', () => {
    expect(classifyMove(base, pose(0, 1.5, 5.5))).toBe('Pull-out')
  })

  it('右へ平行移動 → Truck（被写体注視を保たない平行移動）', () => {
    // 前方=(0,?,-1)なので right=(-1,0,0)。-X方向がTruck R
    const r = classifyMove(base, pose(-1, 1.5, 4, -1, 1.2, 0))
    expect(['Truck L', 'Truck R']).toContain(r)
  })

  it('上昇 → Pedestal Up / 下降 → Pedestal Down', () => {
    expect(classifyMove(base, pose(0, 2.5, 4))).toBe('Pedestal Up')
    expect(classifyMove(base, pose(0, 0.6, 4))).toBe('Pedestal Down')
  })

  it('被写体距離を保って方位角が回る → Arc（Truckと弁別）', () => {
    // 半径4を保ち45°回転、注視点は同じ
    const b = pose(4 * Math.sin(Math.PI / 4), 1.5, 4 * Math.cos(Math.PI / 4))
    expect(classifyMove(base, b)).toBe('Arc')
  })

  it('前進+大きな横移動の複合 → Compound', () => {
    expect(classifyMove(base, pose(1.2, 1.5, 2.5, 1.2, 1.2, 0))).toBe('Compound')
  })

  it('位置固定でパン+ズームの複合 → Compound（Pan単独と誤分類しない）', () => {
    expect(classifyMove(base, pose(0, 1.5, 4, 2, 1.2, 0, 85))).toBe('Compound')
  })
})
