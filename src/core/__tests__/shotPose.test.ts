import { describe, it, expect } from 'vitest'
import { moveU, shotPoseAtU, shotHasMove, animaticPoseAt } from '../shotPose'
import { v3 } from '../math'
import type { Shot, CameraRig, CameraPose } from '../../model/types'

const pose = (x: number): CameraPose => ({
  position: v3(x, 1.5, 3), lookAt: v3(0, 1, 0), roll: 0, focalLength: 35,
})

const mkShot = (extra: Partial<Shot> = {}): Shot => ({
  id: 's', cameraId: 'cam1', cameraName: 'CAM A', thumbnail: '',
  focalLength: 35, moveType: 'Static', subjectIds: [], durationSec: 2,
  notes: { action: '', camera: '' },
  poseSnapshot: { a: pose(0) },
  ...extra,
})

describe('shotPose: moveU', () => {
  it('moveRange 既定[0,1]で線形', () => {
    const s = mkShot({ durationSec: 4 })
    expect(moveU(s, 0)).toBeCloseTo(0)
    expect(moveU(s, 2)).toBeCloseTo(0.5)
    expect(moveU(s, 4)).toBeCloseTo(1)
  })
  it('分割後の moveRange 窓を反映する', () => {
    const s = mkShot({ durationSec: 2, moveRange: [0.5, 1] })
    expect(moveU(s, 0)).toBeCloseTo(0.5)
    expect(moveU(s, 2)).toBeCloseTo(1)
  })
})

describe('shotPose: shotPoseAtU / shotHasMove', () => {
  it('capture カットは poseSnapshot を内挿', () => {
    const s = mkShot({ poseSnapshot: { a: pose(0), b: pose(10) } })
    expect(shotHasMove(s, [])).toBe(true)
    expect(shotPoseAtU(s, [], 0.5)!.position.x).toBeCloseTo(5)
  })
  it('ムーブなしは a を返す', () => {
    const s = mkShot()
    expect(shotHasMove(s, [])).toBe(false)
    expect(shotPoseAtU(s, [], 0.7)!.position.x).toBeCloseTo(0)
  })
  it('script カットはライブカメラの poseA/poseB を内挿', () => {
    const cam: CameraRig = {
      id: 'cam1', name: 'CAM A', moveDurationSec: 4,
      pose: pose(0), poseA: pose(0), poseB: pose(20),
    }
    const s = mkShot({ source: 'script', poseSnapshot: { a: pose(99) } })
    expect(shotHasMove(s, [cam])).toBe(true)
    // poseSnapshot(99) ではなくカメラ側 poseA(0)→poseB(20) を内挿（u=0.5で中点）
    expect(shotPoseAtU(s, [cam], 0.5)!.position.x).toBeCloseTo(10)
  })
  it('script カットでもカメラ欠落時は凍結ポーズにフォールバック', () => {
    const s = mkShot({ source: 'script', poseSnapshot: { a: pose(7) } })
    expect(shotPoseAtU(s, [], 0.5)!.position.x).toBeCloseTo(7)
    expect(shotHasMove(s, [])).toBe(false)
  })
})

describe('shotPose: animaticPoseAt', () => {
  it('時刻から該当カット・正規化位置を解決する', () => {
    const shots = [
      mkShot({ id: 'a', durationSec: 2 }),
      mkShot({ id: 'b', durationSec: 2, poseSnapshot: { a: pose(0), b: pose(10) } }),
    ]
    // t=3 → 2カット目の1秒地点（u=0.5）
    expect(animaticPoseAt(shots, [], 3)!.position.x).toBeCloseTo(5)
  })
  it('ショットなしは null', () => {
    expect(animaticPoseAt([], [], 0)).toBeNull()
  })
})
