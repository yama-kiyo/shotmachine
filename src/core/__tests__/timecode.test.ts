import { describe, it, expect } from 'vitest'
import { secondsToTimecode, secondsToTC, secondsToFC } from '../timecode'

describe('timecode: secondsToTimecode（既存・再生バー用の整数秒表記）', () => {
  it('分:秒（0埋め）で表す', () => {
    expect(secondsToTimecode(0)).toBe('0:00')
    expect(secondsToTimecode(4.9)).toBe('0:04') // 小数切り捨て
    expect(secondsToTimecode(65)).toBe('1:05')
  })
})

describe('timecode: secondsToTC（mm:ss+ff・24fps固定）', () => {
  it('既知値: 4.208s → 00:04+05', () => {
    expect(secondsToTC(4.208)).toBe('00:04+05') // round(0.208*24)=5
  })
  it('0 は 00:00+00', () => {
    expect(secondsToTC(0)).toBe('00:00+00')
  })
  it('丁度フレーム: 7.0s → 00:07+00', () => {
    expect(secondsToTC(7.0)).toBe('00:07+00')
  })
  it('コマ繰り上がり(ff==24): 3.999s → 00:04+00', () => {
    // round(3.999*24)=round(95.976)=96フレーム=4秒0コマ
    expect(secondsToTC(3.999)).toBe('00:04+00')
  })
  it('分をまたぐ: 65.5s → 01:05+12', () => {
    // round(65.5*24)=1572フレーム, 1572%24=12, floor(1572/24)=65秒=1:05
    expect(secondsToTC(65.5)).toBe('01:05+12')
  })
  it('負値は 00:00+00 にクランプ', () => {
    expect(secondsToTC(-1)).toBe('00:00+00')
  })
})

describe('timecode: secondsToFC（尺 s+ff・24fps固定）', () => {
  it('既知値: 2.79s → 2+19', () => {
    expect(secondsToFC(2.79)).toBe('2+19') // round(2.79*24)=67, 67%24=19, floor=2
  })
  it('丁度フレーム: 7.0s → 7+00', () => {
    expect(secondsToFC(7.0)).toBe('7+00')
  })
  it('コマ繰り上がり: 3.999s → 4+00', () => {
    expect(secondsToFC(3.999)).toBe('4+00')
  })
  it('0 は 0+00', () => {
    expect(secondsToFC(0)).toBe('0+00')
  })
  it('60秒超も秒数はそのまま（尺表記は分に繰り上げない）: 62.5s → 62+12', () => {
    expect(secondsToFC(62.5)).toBe('62+12')
  })
})
