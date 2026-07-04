import { describe, it, expect } from 'vitest'
import {
  roundTime, shotStarts, shotAtTime, rollBoundary, rippleBoundary,
  splitShot, mergeShots, clampClip,
} from '../cutTrack'
import { v3 } from '../math'
import type { Shot, DialogueClip } from '../../model/types'

const mkShot = (id: string, durationSec: number, extra: Partial<Shot> = {}): Shot => ({
  id, cameraId: 'cam1', cameraName: 'CAM A', thumbnail: '',
  focalLength: 35, moveType: 'Static', subjectIds: [], durationSec,
  notes: { action: '', camera: '' },
  poseSnapshot: { a: { position: v3(0, 0, 0), lookAt: v3(0, 0, 0), roll: 0, focalLength: 35 } },
  ...extra,
})

const mkClip = (id: string, startSec: number, durationSec: number): DialogueClip =>
  ({ id, speaker: null, text: '', startSec, durationSec })

describe('cutTrack: roundTime', () => {
  it('0.01秒に丸める', () => {
    expect(roundTime(1.234)).toBe(1.23)
    expect(roundTime(1.235)).toBe(1.24)
    expect(roundTime(2)).toBe(2)
  })
})

describe('cutTrack: shotStarts', () => {
  it('累積開始時刻', () => {
    expect(shotStarts([mkShot('a', 2), mkShot('b', 3), mkShot('c', 1.5)])).toEqual([0, 2, 5])
  })
  it('空配列', () => {
    expect(shotStarts([])).toEqual([])
  })
})

describe('cutTrack: shotAtTime（半開区間 [start,end)）', () => {
  const shots = [mkShot('a', 2), mkShot('b', 3), mkShot('c', 1.5)] // total 6.5, starts 0/2/5
  it('空配列は null', () => {
    expect(shotAtTime([], 0)).toBeNull()
  })
  it('先頭', () => {
    expect(shotAtTime(shots, 0)).toEqual({ idx: 0, tInShot: 0 })
  })
  it('カット内', () => {
    expect(shotAtTime(shots, 1.9)).toEqual({ idx: 0, tInShot: 1.9 })
    expect(shotAtTime(shots, 4.9)).toEqual({ idx: 1, tInShot: 2.9 })
  })
  it('境界時刻は次カットの頭に属する', () => {
    expect(shotAtTime(shots, 2)).toEqual({ idx: 1, tInShot: 0 })
    expect(shotAtTime(shots, 5)).toEqual({ idx: 2, tInShot: 0 })
  })
  it('総尺ちょうどは最終カットの末尾', () => {
    expect(shotAtTime(shots, 6.5)).toEqual({ idx: 2, tInShot: 1.5 })
  })
  it('総尺超過も最終カット末尾', () => {
    expect(shotAtTime(shots, 10)).toEqual({ idx: 2, tInShot: 1.5 })
  })
  it('負の時刻は先頭にクランプ', () => {
    expect(shotAtTime(shots, -1)).toEqual({ idx: 0, tInShot: 0 })
  })
})

describe('cutTrack: rollBoundary（合計不変）', () => {
  it('左+δ/右−δ、合計不変', () => {
    const out = rollBoundary([mkShot('a', 3), mkShot('b', 2)], 0, 1)
    expect(out.map((s) => s.durationSec)).toEqual([4, 1])
  })
  it('右を minDur でクランプ', () => {
    const out = rollBoundary([mkShot('a', 3), mkShot('b', 2)], 0, 5, 0.5)
    expect(out.map((s) => s.durationSec)).toEqual([4.5, 0.5])
  })
  it('左を minDur でクランプ', () => {
    const out = rollBoundary([mkShot('a', 3), mkShot('b', 2)], 0, -5, 0.5)
    expect(out.map((s) => s.durationSec)).toEqual([0.5, 4.5])
  })
  it('元配列を破壊しない（イミュータブル）', () => {
    const src = [mkShot('a', 3), mkShot('b', 2)]
    rollBoundary(src, 0, 1)
    expect(src.map((s) => s.durationSec)).toEqual([3, 2])
  })
  it('境界インデックス範囲外は無変更', () => {
    const src = [mkShot('a', 3), mkShot('b', 2)]
    expect(rollBoundary(src, 1, 1)).toBe(src)
    expect(rollBoundary(src, -1, 1)).toBe(src)
  })
})

describe('cutTrack: rippleBoundary（後方シフト）', () => {
  it('左カットのみ伸縮、以降は累積で自動シフト', () => {
    const out = rippleBoundary([mkShot('a', 3), mkShot('b', 2), mkShot('c', 1)], 0, 1)
    expect(out.map((s) => s.durationSec)).toEqual([4, 2, 1])
  })
  it('最終インデックスは総尺の伸長', () => {
    const out = rippleBoundary([mkShot('a', 3), mkShot('b', 2), mkShot('c', 1)], 2, 2)
    expect(out.map((s) => s.durationSec)).toEqual([3, 2, 3])
  })
  it('minDur でクランプ', () => {
    const out = rippleBoundary([mkShot('a', 3), mkShot('b', 2)], 0, -5, 0.5)
    expect(out.map((s) => s.durationSec)).toEqual([0.5, 2])
  })
})

describe('cutTrack: splitShot（moveRange 比率分割）', () => {
  it('尺と moveRange を比率で割る', () => {
    const shots = [mkShot('a', 4, { moveRange: [0, 1] })]
    const out = splitShot(shots, 0, 1, 0.5, () => 'b')
    expect(out).not.toBeNull()
    expect(out!.map((s) => s.id)).toEqual(['a', 'b'])
    expect(out!.map((s) => s.durationSec)).toEqual([1, 3])
    expect(out![0].moveRange).toEqual([0, 0.25]) // um = 0 + 1*(1/4)
    expect(out![1].moveRange).toEqual([0.25, 1])
  })
  it('既定 moveRange なしでも [0,1] 前提で分割', () => {
    const out = splitShot([mkShot('a', 4)], 0, 3, 0.5, () => 'b')
    expect(out![0].moveRange).toEqual([0, 0.75])
    expect(out![1].moveRange).toEqual([0.75, 1])
  })
  it('部分ムーブ窓の比率分割', () => {
    const shots = [mkShot('a', 4, { moveRange: [0.2, 0.6] })]
    const out = splitShot(shots, 0, 1, 0.5, () => 'b')
    expect(out![0].moveRange![1]).toBeCloseTo(0.3, 10) // 0.2 + 0.4*0.25
    expect(out![1].moveRange).toEqual([0.3, 0.6])
  })
  it('poseSnapshot/thumbnail を複製', () => {
    const shots = [mkShot('a', 4, { thumbnail: 'DATA', cameraId: 'camX' })]
    const out = splitShot(shots, 0, 2, 0.5, () => 'b')
    expect(out![1].thumbnail).toBe('DATA')
    expect(out![1].cameraId).toBe('camX')
    expect(out![1].poseSnapshot).toEqual(shots[0].poseSnapshot)
  })
  it('左半分が minDur 未満は null', () => {
    expect(splitShot([mkShot('a', 4)], 0, 0.3)).toBeNull()
  })
  it('右半分が minDur 未満は null', () => {
    expect(splitShot([mkShot('a', 4)], 0, 3.7)).toBeNull()
  })
  it('インデックス範囲外は null', () => {
    expect(splitShot([mkShot('a', 4)], 5, 2)).toBeNull()
  })
})

describe('cutTrack: mergeShots', () => {
  it('分割ペア（同カメラ・連続ムーブ）を再結合', () => {
    const shots = [
      mkShot('a', 1, { moveRange: [0, 0.25], cameraId: 'cam1' }),
      mkShot('b', 3, { moveRange: [0.25, 1], cameraId: 'cam1' }),
    ]
    const out = mergeShots(shots, 0)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
    expect(out[0].durationSec).toBe(4)
    expect(out[0].moveRange).toEqual([0, 1])
  })
  it('異カメラは左カットのポーズを採用・ムーブ結合しない', () => {
    const shots = [
      mkShot('a', 2, { moveRange: [0, 1], cameraId: 'cam1' }),
      mkShot('b', 3, { moveRange: [0, 1], cameraId: 'cam2' }),
    ]
    const out = mergeShots(shots, 0)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('a')
    expect(out[0].cameraId).toBe('cam1')
    expect(out[0].durationSec).toBe(5)
    expect(out[0].moveRange).toEqual([0, 1]) // 左カットのまま
  })
  it('static（moveRange なし）カットの結合', () => {
    const out = mergeShots([mkShot('a', 2), mkShot('b', 3)], 0)
    expect(out).toHaveLength(1)
    expect(out[0].durationSec).toBe(5)
    expect(out[0].moveRange).toBeUndefined()
  })
  it('範囲外は無変更', () => {
    const src = [mkShot('a', 2), mkShot('b', 3)]
    expect(mergeShots(src, 1)).toBe(src)
  })
})

describe('cutTrack: clampClip（重なり禁止）', () => {
  it('タイムライン先頭にクランプ', () => {
    const clip = mkClip('x', -1, 2)
    expect(clampClip(clip, [clip], 10).startSec).toBe(0)
  })
  it('タイムライン末尾にクランプ', () => {
    const clip = mkClip('x', 9, 2)
    expect(clampClip(clip, [clip], 10).startSec).toBe(8) // maxStart = 10-2
  })
  it('先行クリップと重なる時は右へスナップ', () => {
    const other = mkClip('o', 0, 2) // [0,2] を占有
    const clip = mkClip('x', 1, 2) // 望み位置が重なる
    expect(clampClip(clip, [other, clip], 10).startSec).toBe(2)
  })
  it('後続クリップと重なる時は左へスナップ', () => {
    const other = mkClip('o', 4, 2) // [4,6] を占有
    const clip = mkClip('x', 3.5, 2) // [3.5,5.5] が重なる、中心は他より左
    expect(clampClip(clip, [other, clip], 10).startSec).toBe(2) // oStart - dur = 4-2
  })
  it('重ならない位置はそのまま', () => {
    const other = mkClip('o', 0, 2)
    const clip = mkClip('x', 5, 2)
    expect(clampClip(clip, [other, clip], 10).startSec).toBe(5)
  })
})
