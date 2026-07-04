import { describe, it, expect } from 'vitest'
import { snapTime, nearestGrid } from '../snap'

describe('snapTime', () => {
  it('閾値内で最も近い候補へ吸着する', () => {
    expect(snapTime(2.04, [0, 2, 4], 0.1)).toBe(2)
  })
  it('閾値外なら元の値を返す', () => {
    expect(snapTime(2.3, [0, 2, 4], 0.1)).toBe(2.3)
  })
  it('候補が無ければ元の値を返す', () => {
    expect(snapTime(1.23, [], 0.1)).toBe(1.23)
  })
  it('閾値ちょうどの候補は吸着する', () => {
    expect(snapTime(2.5, [2], 0.5)).toBe(2) // 距離0.5=閾値ちょうど（floatで正確な値）
  })
  it('複数候補のうち最近を選ぶ', () => {
    expect(snapTime(3.02, [2, 3, 3.5], 0.2)).toBe(3)
  })
})

describe('nearestGrid', () => {
  it('0.1sグリッドの最近点を返す', () => {
    expect(nearestGrid(2.04)).toBeCloseTo(2.0)
    expect(nearestGrid(2.07)).toBeCloseTo(2.1)
  })
  it('グリッド幅を指定できる', () => {
    expect(nearestGrid(2.3, 0.5)).toBeCloseTo(2.5)
  })
})
