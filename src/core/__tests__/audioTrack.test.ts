import { describe, it, expect } from 'vitest'
import { activeClipsAt, relayoutScriptClips, clampClipsToTotal, clipsOverlappingRange } from '../audioTrack'
import { v3 } from '../math'
import type { Shot, DialogueClip } from '../../model/types'

const mkClip = (id: string, startSec: number, durationSec: number, extra: Partial<DialogueClip> = {}): DialogueClip =>
  ({ id, speaker: null, text: '', startSec, durationSec, ...extra })

const mkShot = (id: string, durationSec: number, clipId?: string): Shot => ({
  id, cameraId: 'cam1', cameraName: 'CAM A', thumbnail: '',
  focalLength: 35, moveType: 'Static', subjectIds: [], durationSec,
  notes: { action: '', camera: '' },
  poseSnapshot: { a: { position: v3(0, 0, 0), lookAt: v3(0, 0, 0), roll: 0, focalLength: 35 } },
  source: 'script', clipId,
})

describe('audioTrack: activeClipsAt（半開区間 [start, start+dur)）', () => {
  const clips = [mkClip('a', 0, 2), mkClip('b', 2, 3), mkClip('c', 5, 1.5)] // [0,2) [2,5) [5,6.5)

  it('区間内で該当クリップと tInClip を返す', () => {
    expect(activeClipsAt(clips, 0)).toEqual([{ clip: clips[0], tInClip: 0 }])
    expect(activeClipsAt(clips, 1.9)).toEqual([{ clip: clips[0], tInClip: 1.9 }])
    expect(activeClipsAt(clips, 4.99)).toEqual([{ clip: clips[1], tInClip: 2.99 }])
  })
  it('開始時刻は含む（左閉）', () => {
    expect(activeClipsAt(clips, 2)).toEqual([{ clip: clips[1], tInClip: 0 }])
    expect(activeClipsAt(clips, 5)).toEqual([{ clip: clips[2], tInClip: 0 }])
  })
  it('終了時刻は含まない（右開）→ 次のクリップに属する or 空', () => {
    // clip a の終端 2 は a に属さない（b が拾う）
    expect(activeClipsAt(clips, 2).map((x) => x.clip.id)).toEqual(['b'])
    // 最終クリップの終端 6.5 はどのクリップにも属さない
    expect(activeClipsAt(clips, 6.5)).toEqual([])
  })
  it('クリップの隙間・範囲外は空配列', () => {
    const gapped = [mkClip('a', 0, 1), mkClip('b', 3, 1)] // [0,1) と [3,4) の間に隙間
    expect(activeClipsAt(gapped, 2)).toEqual([])
    expect(activeClipsAt(gapped, -1)).toEqual([])
    expect(activeClipsAt([], 0)).toEqual([])
  })
})

describe('audioTrack: relayoutScriptClips', () => {
  it('clipId で紐づくカットの新しい開始へ startSec を貼り直す', () => {
    // カット尺が変わった後（a=1.5, b=4）の再配置
    const shots = [mkShot('s1', 1.5, 'c1'), mkShot('s2', 4, 'c2')]
    const clips = [mkClip('c1', 0, 1), mkClip('c2', 3, 3)] // 旧 startSec は古いまま
    const out = relayoutScriptClips(shots, clips)
    expect(out.map((c) => c.startSec)).toEqual([0, 1.5]) // s1 開始=0, s2 開始=1.5
    expect(out.map((c) => c.durationSec)).toEqual([1, 3]) // 尺は保持
  })
  it('紐づくカットが無いクリップはそのまま', () => {
    const shots = [mkShot('s1', 2, 'c1')]
    const clips = [mkClip('c1', 0, 1), mkClip('orphan', 5, 1)]
    const out = relayoutScriptClips(shots, clips)
    expect(out[1].startSec).toBe(5)
  })
})

describe('audioTrack: clipsOverlappingRange（半開区間の重なり判定）', () => {
  const clips = [mkClip('a', 0, 2), mkClip('b', 2, 3), mkClip('c', 5, 1.5)] // [0,2) [2,5) [5,6.5)

  it('カット範囲に重なるクリップを元順序で返す', () => {
    // カット [1,3) は a([0,2)) と b([2,5)) の両方に重なる
    expect(clipsOverlappingRange(clips, 1, 3).map((c) => c.id)).toEqual(['a', 'b'])
  })
  it('半開区間: カット終端=クリップ始端は重ならない', () => {
    // カット [0,2) は b([2,5)) と接するだけ → b は含まない
    expect(clipsOverlappingRange(clips, 0, 2).map((c) => c.id)).toEqual(['a'])
  })
  it('半開区間: カット始端=クリップ終端は重ならない', () => {
    // カット [2,5) は a([0,2)) の終端と接するだけ → a は含まない、b のみ
    expect(clipsOverlappingRange(clips, 2, 5).map((c) => c.id)).toEqual(['b'])
  })
  it('分割で境界を跨ぐクリップは両カットに現れる', () => {
    // b([2,5)) を境界3で割ったカット [2,3) と [3,5) の両方に b が出る
    expect(clipsOverlappingRange(clips, 2, 3).map((c) => c.id)).toEqual(['b'])
    expect(clipsOverlappingRange(clips, 3, 5).map((c) => c.id)).toEqual(['b'])
  })
  it('重なりが無ければ空配列', () => {
    const gapped = [mkClip('a', 0, 1), mkClip('b', 3, 1)] // [0,1) [3,4)
    expect(clipsOverlappingRange(gapped, 1, 3)).toEqual([]) // 隙間 [1,3)
    expect(clipsOverlappingRange([], 0, 5)).toEqual([])
  })
})

describe('audioTrack: clampClipsToTotal', () => {
  it('総尺を超えるクリップを引き戻し重なりを解消する', () => {
    const clips = [mkClip('a', 0, 2), mkClip('b', 8, 2)] // total=6 に縮小
    const out = clampClipsToTotal(clips, 6)
    // b は末尾 [4,6) へ、a は [0,2) のまま
    expect(out.find((c) => c.id === 'b')!.startSec).toBe(4)
    expect(out.find((c) => c.id === 'a')!.startSec).toBe(0)
  })
})
