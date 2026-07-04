import { describe, it, expect } from 'vitest'
import { charStateAt, lerpAngle, upsertKeyframe, baseCharState } from '../charAnim'
import { colorNameOf, hexToRgb } from '../colorName'
import { TIME_OF_DAY_PRESETS, TIME_OF_DAY_ORDER } from '../lighting'
import type { Character, CharKeyframe } from '../../model/types'

const CHAR: Character = {
  id: 'c1', name: 'ミサキ', color: '#e8743b',
  position: { x: 0, y: 0, z: 0 }, rotationY: 0, height: 1.6,
}

const KF = (time: number, x: number, ry = 0, pose: CharKeyframe['poseState'] = 'stand', arm: CharKeyframe['armPose'] = 'natural'): CharKeyframe =>
  ({ time, position: { x, y: 0, z: 0 }, rotationY: ry, poseState: pose, armPose: arm })

describe('キャラクターキーフレーム', () => {
  it('キーフレームなし→ベース状態', () => {
    const s = charStateAt(CHAR, 5)
    expect(s).toEqual(baseCharState(CHAR))
    expect(s.poseState).toBe('stand')
  })

  it('範囲外は端のキーで固定', () => {
    const c = { ...CHAR, keyframes: [KF(2, 1), KF(4, 3)] }
    expect(charStateAt(c, 0).position.x).toBe(1)
    expect(charStateAt(c, 10).position.x).toBe(3)
  })

  it('区間内は位置を線形補間', () => {
    const c = { ...CHAR, keyframes: [KF(2, 1), KF(4, 3)] }
    expect(charStateAt(c, 3).position.x).toBeCloseTo(2, 5)
    expect(charStateAt(c, 2.5).position.x).toBeCloseTo(1.5, 5)
  })

  it('向きは最短弧で補間（-π/π境界をまたぐ）', () => {
    expect(lerpAngle(Math.PI * 0.9, -Math.PI * 0.9, 0.5)).toBeCloseTo(Math.PI, 4)
    expect(lerpAngle(0, Math.PI / 2, 0.5)).toBeCloseTo(Math.PI / 4, 6)
  })

  it('姿勢・腕ポーズはセグメント開始キーの値を維持（ステップ切替）', () => {
    const c = { ...CHAR, keyframes: [KF(0, 0, 0, 'stand', 'natural'), KF(4, 2, 0, 'sit', 'crossed')] }
    expect(charStateAt(c, 2).poseState).toBe('stand')
    expect(charStateAt(c, 2).armPose).toBe('natural')
    expect(charStateAt(c, 4).poseState).toBe('sit')
    expect(charStateAt(c, 5).armPose).toBe('crossed')
  })

  it('upsertKeyframe: 時刻順に挿入され、同時刻は置換される', () => {
    let kfs = upsertKeyframe(undefined, KF(3, 1))
    kfs = upsertKeyframe(kfs, KF(1, 0))
    kfs = upsertKeyframe(kfs, KF(2, 5))
    expect(kfs.map((k) => k.time)).toEqual([1, 2, 3])
    kfs = upsertKeyframe(kfs, KF(2.01, 9)) // 2秒のキーを置換
    expect(kfs).toHaveLength(3)
    expect(kfs[1].position.x).toBe(9)
  })
})

describe('色名変換', () => {
  it('代表色を正しく命名', () => {
    expect(colorNameOf('#d2322d')).toBe('red')
    expect(colorNameOf('#3b6fe8')).toBe('blue')
    expect(colorNameOf('#a07a4f')).toBe('brown')
    expect(colorNameOf('#4f7a4f')).toBe('dark green')
    expect(colorNameOf('#f4f0e0')).toBe('white')
  })
  it('不正なhexはそのまま返す', () => {
    expect(colorNameOf('rebeccapurple')).toBe('rebeccapurple')
    expect(hexToRgb('#ggg')).toBeNull()
  })
})

describe('時間帯プリセット', () => {
  it('4種すべて定義され、プロンプト記述を持つ', () => {
    expect(TIME_OF_DAY_ORDER).toHaveLength(4)
    for (const k of TIME_OF_DAY_ORDER) {
      const p = TIME_OF_DAY_PRESETS[k]
      expect(p.sun.intensity).toBeGreaterThan(0)
      expect(p.promptEn.length).toBeGreaterThan(5)
    }
  })
  it('夜は昼より暗い', () => {
    expect(TIME_OF_DAY_PRESETS.night.ambient.intensity).toBeLessThan(TIME_OF_DAY_PRESETS.day.ambient.intensity)
    expect(TIME_OF_DAY_PRESETS.night.sun.intensity).toBeLessThan(TIME_OF_DAY_PRESETS.day.sun.intensity)
  })
})
