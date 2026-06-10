import { describe, it, expect } from 'vitest'
import { sideOf, establishSide, checkCameraSide } from '../axis180'
import { generateCoverage } from '../coverage'
import { v3 } from '../math'
import type { Character } from '../../model/types'

const a = v3(-1, 0, 0)
const b = v3(1, 0, 0) // 軸 = X軸

describe('180°ルール', () => {
  it('サイド符号: +Z側と-Z側で符号が逆', () => {
    const sPlus = sideOf(a, b, v3(0, 1.5, 3))
    const sMinus = sideOf(a, b, v3(0, 1.5, -3))
    expect(sPlus).not.toBe(0)
    expect(sMinus).not.toBe(0)
    expect(sPlus).toBe(-sMinus as 1 | -1)
  })

  it('ライン上（許容幅内）は 0', () => {
    expect(sideOf(a, b, v3(0.5, 1.5, 0))).toBe(0)
    expect(sideOf(a, b, v3(0.5, 1.5, 0.04))).toBe(0) // 5cm未満
    expect(sideOf(a, b, v3(0.5, 1.5, 0.1))).not.toBe(0)
  })

  it('establishSide → checkCameraSide: 同サイド=ok、反対=crossed、ライン上=on-line', () => {
    const cam = v3(0, 1.5, 3)
    const locked = establishSide(a, b, cam)
    expect(checkCameraSide(a, b, locked, cam)).toBe('ok')
    expect(checkCameraSide(a, b, locked, v3(0, 1.5, -3))).toBe('crossed')
    expect(checkCameraSide(a, b, locked, v3(0, 1.5, 0))).toBe('on-line')
  })

  it('Re-establish: 反対サイドで再確立すると元のカメラがcrossedになる', () => {
    const cam1 = v3(0, 1.5, 3)
    const cam2 = v3(0, 1.5, -3)
    const locked1 = establishSide(a, b, cam1)
    expect(checkCameraSide(a, b, locked1, cam2)).toBe('crossed')
    const locked2 = establishSide(a, b, cam2)
    expect(checkCameraSide(a, b, locked2, cam2)).toBe('ok')
    expect(checkCameraSide(a, b, locked2, cam1)).toBe('crossed')
  })
})

describe('カバレッジ自動生成', () => {
  const maya: Character = { id: 'a', name: 'Maya', color: '#f00', position: v3(-1, 0, 0), rotationY: Math.PI / 2, height: 1.68 }
  const dan: Character = { id: 'b', name: 'Dan', color: '#00f', position: v3(1, 0, 0.5), rotationY: -Math.PI / 2, height: 1.8 }

  it.each([[1], [-1]] as const)('全5台が正サイド（lockedSide=%d）', (side) => {
    const cams = generateCoverage(maya, dan, side as 1 | -1, 16 / 9)
    expect(cams).toHaveLength(5)
    expect(cams.map((c) => c.name)).toEqual(['MASTER', 'OTS Maya', 'OTS Dan', 'CU Maya', 'CU Dan'])
    for (const c of cams) {
      expect(
        checkCameraSide(maya.position, dan.position, side as 1 | -1, c.pose.position),
        `${c.name} がライン違反`,
      ).toBe('ok')
    }
  })
})
