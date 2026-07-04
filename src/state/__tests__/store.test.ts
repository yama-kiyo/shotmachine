import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store'
import { emptyProject } from '../../model/defaults'
import { v3 } from '../../core/math'
import type { Project, Shot, DialogueClip, CameraRig, CameraPose, Alignment } from '../../model/types'

const pose = (focal = 35): CameraPose => ({ position: v3(0, 1.5, 3), lookAt: v3(0, 1.2, 0), roll: 0, focalLength: focal })
const cam = (id: string, name: string, focal = 35): CameraRig => ({ id, name, pose: pose(focal), moveDurationSec: 4 })
const shot = (id: string, durationSec: number, extra: Partial<Shot> = {}): Shot => ({
  id, cameraId: 'cam1', cameraName: 'CAM A', thumbnail: '',
  focalLength: 35, moveType: 'Static', subjectIds: [], durationSec,
  notes: { action: '', camera: '' }, poseSnapshot: { a: pose() },
  source: 'capture', ...extra,
})
const clip = (id: string, startSec: number, durationSec: number, extra: Partial<DialogueClip> = {}): DialogueClip =>
  ({ id, speaker: null, text: '', startSec, durationSec, ...extra })

const load = (patch: Partial<Project>): void => {
  useStore.getState().loadProject({ ...emptyProject(), ...patch })
  useStore.temporal.getState().clear()
}

beforeEach(() => {
  load({})
})

describe('store: splitShotAtPlayhead', () => {
  it('再生ヘッド位置でカットを2つに割り、moveRangeを比率分割する', () => {
    load({ shots: [shot('a', 4, { source: 'script', moveRange: [0, 1] })] })
    useStore.getState().setPlayTime(1)
    useStore.getState().splitShotAtPlayhead()
    const shots = useStore.getState().project.shots
    expect(shots).toHaveLength(2)
    expect(shots.map((s) => s.durationSec)).toEqual([1, 3])
    expect(shots[0].moveRange).toEqual([0, 0.25])
    expect(shots[1].moveRange).toEqual([0.25, 1])
    // 右カットが選択される
    expect(useStore.getState().selectedShotId).toBe(shots[1].id)
  })
  it('最小尺を割る位置では分割しない', () => {
    load({ shots: [shot('a', 4)] })
    useStore.getState().setPlayTime(0.2)
    useStore.getState().splitShotAtPlayhead()
    expect(useStore.getState().project.shots).toHaveLength(1)
  })
})

describe('store: mergeShotWithNext', () => {
  it('次カットと結合し尺を合算する', () => {
    load({ shots: [shot('a', 2), shot('b', 3)] })
    useStore.getState().mergeShotWithNext('a')
    const shots = useStore.getState().project.shots
    expect(shots).toHaveLength(1)
    expect(shots[0].durationSec).toBe(5)
  })
})

describe('store: reassignShotCamera', () => {
  it('capture カットは新カメラのポーズを凍結し直す', () => {
    load({
      scene: { ...emptyProject().scene, cameras: [cam('cam1', 'CAM A', 35), cam('cam2', 'CAM B', 85)] },
      shots: [shot('a', 3, { cameraId: 'cam1', source: 'capture' })],
    })
    useStore.getState().reassignShotCamera('a', 'cam2')
    const s = useStore.getState().project.shots[0]
    expect(s.cameraId).toBe('cam2')
    expect(s.cameraName).toBe('CAM B')
    expect(s.focalLength).toBe(85)
    expect(s.poseSnapshot.a.focalLength).toBe(85) // 再凍結
  })
  it('script カットはライブリンクのまま（poseSnapshotを触らない）', () => {
    const snapA = pose(28)
    load({
      scene: { ...emptyProject().scene, cameras: [cam('cam1', 'CAM A'), cam('cam2', 'CAM B', 85)] },
      shots: [shot('a', 3, { cameraId: 'cam1', source: 'script', poseSnapshot: { a: snapA } })],
    })
    useStore.getState().reassignShotCamera('a', 'cam2')
    const s = useStore.getState().project.shots[0]
    expect(s.cameraId).toBe('cam2')
    expect(s.poseSnapshot.a.focalLength).toBe(28) // 凍結ポーズは変えない
  })
})

describe('store: moveClip', () => {
  it('総尺内・重なり禁止でクランプする', () => {
    load({
      shots: [shot('s', 6)],
      audioTrack: [clip('a', 0, 2), clip('b', 4, 2)],
    })
    // b を a に重なる位置へ → a の右端へスナップ
    useStore.getState().moveClip('b', 1)
    expect(useStore.getState().project.audioTrack.find((c) => c.id === 'b')!.startSec).toBe(2)
    // a を総尺超へ → maxStart=6-2=4
    useStore.getState().moveClip('a', 99)
    // a を末尾へ寄せると b(2..4) と重なるため b の手前 or 末尾にクランプ
    const a = useStore.getState().project.audioTrack.find((c) => c.id === 'a')!
    expect(a.startSec).toBeLessThanOrEqual(4)
    expect(a.startSec).toBeGreaterThanOrEqual(0)
  })
})

describe('store: applyVoiceToClip', () => {
  it('クリップ尺=実音声長、紐づくカット尺=実音声長+0.6、クリップは再整列', () => {
    const alignment: Alignment = { chars: ['あ'], starts: [0], ends: [1.4] }
    load({
      shots: [
        shot('s1', 3, { source: 'script', clipId: 'c1' }),
        shot('s2', 3, { source: 'script', clipId: 'c2' }),
      ],
      audioTrack: [clip('c1', 0, 3, { speaker: 'A', text: 'あ' }), clip('c2', 3, 3, { speaker: 'A', text: 'い' })],
    })
    useStore.getState().applyVoiceToClip('c1', 'data:audio', alignment, 1.4)
    const st = useStore.getState().project
    const c1 = st.audioTrack.find((c) => c.id === 'c1')!
    const s1 = st.shots.find((s) => s.id === 's1')!
    const s2 = st.shots.find((s) => s.id === 's2')!
    const c2 = st.audioTrack.find((c) => c.id === 'c2')!
    expect(c1.durationSec).toBe(1.4)
    expect(c1.audio).toBe('data:audio')
    expect(s1.durationSec).toBe(2) // 1.4 + 0.6
    // s2 は s1 の後ろへ詰まり、c2 は s2 開始(=2)へ再整列
    expect(s2.durationSec).toBe(3)
    expect(c2.startSec).toBe(2)
  })
})

describe('store: rollCutBoundary / rippleCutBoundary', () => {
  it('ロールは合計不変で境界を動かす', () => {
    load({ shots: [shot('a', 3), shot('b', 2)] })
    useStore.getState().rollCutBoundary(0, 1)
    expect(useStore.getState().project.shots.map((s) => s.durationSec)).toEqual([4, 1])
  })
  it('リップルは後方シフトし、総尺縮小時にクリップを再クランプする', () => {
    load({
      shots: [shot('a', 4), shot('b', 4)],
      audioTrack: [clip('x', 7, 1)], // total=8, clip [7,8)
    })
    useStore.getState().rippleCutBoundary(1, -3) // b: 4→1, total 8→5
    const c = useStore.getState().project.audioTrack[0]
    expect(c.startSec).toBe(4) // maxStart = 5-1
  })
})

describe('store: beginTimelineDrag / endTimelineDrag（1ドラッグ=1 Undo）', () => {
  it('ドラッグ中の連続変更を1件の履歴にまとめ、Undoで開始時点へ戻す', () => {
    load({ shots: [shot('a', 3), shot('b', 3)] })
    const temporal = useStore.temporal.getState()
    expect(temporal.pastStates).toHaveLength(0)

    useStore.getState().beginTimelineDrag()
    // 連続ロール（tracking pause 中は履歴に積まれない）
    useStore.getState().rollCutBoundary(0, 0.5)
    useStore.getState().rollCutBoundary(0, 0.5)
    useStore.getState().rollCutBoundary(0, 0.5)
    expect(useStore.getState().project.shots.map((s) => s.durationSec)).toEqual([4.5, 1.5])
    useStore.getState().endTimelineDrag()

    // ドラッグ全体で履歴は1件
    expect(useStore.temporal.getState().pastStates).toHaveLength(1)
    // Undo で開始時点（3/3）へ
    useStore.temporal.getState().undo()
    expect(useStore.getState().project.shots.map((s) => s.durationSec)).toEqual([3, 3])
    // Redo で最終値へ
    useStore.temporal.getState().redo()
    expect(useStore.getState().project.shots.map((s) => s.durationSec)).toEqual([4.5, 1.5])
  })
  it('変更が無いドラッグは履歴を積まない', () => {
    load({ shots: [shot('a', 3)] })
    useStore.getState().beginTimelineDrag()
    useStore.getState().endTimelineDrag()
    expect(useStore.temporal.getState().pastStates).toHaveLength(0)
  })
})

describe('store: moveCharKeyframe', () => {
  const charWithKfs = () => {
    const base = emptyProject()
    return {
      shots: [shot('s', 6)],
      scene: {
        ...base.scene,
        characters: [{
          id: 'c1', name: 'A', color: '#fff', position: v3(0, 0, 0), rotationY: 0, height: 1.7,
          keyframes: [
            { time: 1, position: v3(0, 0, 0), rotationY: 0, poseState: 'stand' as const, armPose: 'natural' as const },
            { time: 4, position: v3(1, 0, 0), rotationY: 0, poseState: 'stand' as const, armPose: 'natural' as const },
          ],
        }],
      },
    }
  }
  it('KF時刻を変更し昇順ソートを保ち、再生ヘッドを追従させる', () => {
    load(charWithKfs())
    useStore.getState().moveCharKeyframe('c1', 0, 5) // 1→5（4より後ろへ）
    const kfs = useStore.getState().project.scene.characters[0].keyframes!
    expect(kfs.map((k) => k.time)).toEqual([4, 5])
    expect(useStore.getState().playTime).toBe(5)
  })
  it('総尺を超える時刻は総尺へクランプする', () => {
    load(charWithKfs())
    useStore.getState().moveCharKeyframe('c1', 1, 99) // total=6
    const kfs = useStore.getState().project.scene.characters[0].keyframes!
    expect(kfs[kfs.length - 1].time).toBe(6)
  })
})

describe('store: writeCharKeyframeFromGizmo', () => {
  it('再生ヘッド位置にKFを新規追加し、姿勢/腕はキャラ現在値を継承する', () => {
    const base = emptyProject()
    load({
      shots: [shot('s', 6)],
      scene: {
        ...base.scene,
        characters: [{
          id: 'c1', name: 'A', color: '#fff', position: v3(0, 0, 0), rotationY: 0, height: 1.7,
          poseState: 'sit', armPose: 'crossed',
        }],
      },
    })
    useStore.getState().setPlayTime(2)
    useStore.getState().writeCharKeyframeFromGizmo('c1', { position: v3(3, 0, 2), rotationY: 1 })
    const kfs = useStore.getState().project.scene.characters[0].keyframes!
    expect(kfs).toHaveLength(1)
    expect(kfs[0].time).toBe(2)
    expect(kfs[0].position).toEqual(v3(3, 0, 2))
    expect(kfs[0].poseState).toBe('sit')
    expect(kfs[0].armPose).toBe('crossed')
  })
})
