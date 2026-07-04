import { describe, it, expect } from 'vitest'
import { charToViseme, visemeAt, visemeWeights } from '../lipsync'

describe('リップシンク音素変換', () => {
  it('五十音の行→母音口形状', () => {
    expect(charToViseme('か')).toBe('aa')
    expect(charToViseme('き')).toBe('ih')
    expect(charToViseme('ぐ')).toBe('ou')
    expect(charToViseme('れ')).toBe('ee')
    expect(charToViseme('ぽ')).toBe('oh')
    expect(charToViseme('ワ')).toBe('aa') // カタカナ
  })
  it('ん・っ・句読点は口を閉じる', () => {
    expect(charToViseme('ん')).toBeNull()
    expect(charToViseme('っ')).toBeNull()
    expect(charToViseme('。')).toBeNull()
    expect(charToViseme(' ')).toBeNull()
  })
  it('長音は直前の母音を維持', () => {
    expect(charToViseme('ー', 'oh')).toBe('oh')
  })
  it('ローマ字母音にも対応', () => {
    expect(charToViseme('A')).toBe('aa')
    expect(charToViseme('o')).toBe('oh')
  })

  it('visemeAt: タイムスタンプから時刻の口形状を引く', () => {
    const alignment = {
      chars: ['こ', 'ん', 'に', 'ち', 'は'],
      starts: [0.0, 0.2, 0.4, 0.6, 0.8],
      ends: [0.2, 0.4, 0.6, 0.8, 1.0],
    }
    expect(visemeAt(alignment, 0.1)).toBe('oh') // こ
    expect(visemeAt(alignment, 0.3)).toBeNull() // ん
    expect(visemeAt(alignment, 0.5)).toBe('ih') // に
    expect(visemeAt(alignment, 0.9)).toBe('aa') // は
    expect(visemeAt(alignment, 5.0)).toBeNull() // 発話後
    expect(visemeAt(undefined, 0.1)).toBeNull()
  })

  it('visemeWeights: 該当口形状のみ正の重み', () => {
    const w = visemeWeights('aa')
    expect(w.aa).toBeGreaterThan(0)
    expect(w.ih + w.ou + w.ee + w.oh).toBe(0)
    const closed = visemeWeights(null)
    expect(Object.values(closed).every((x) => x === 0)).toBe(true)
  })
})
