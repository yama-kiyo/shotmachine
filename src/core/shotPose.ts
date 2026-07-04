// カット内のカメラポーズ解決（store 非依存の純関数）。
// アニマティック再生・カット分割・スタートフレーム書き出しで同一実装を共有し、
// 「ライブリンク（source==='script'）はカメラ poseA/poseB、それ以外は poseSnapshot」という
// 分岐を1箇所に集約する。
import type { Shot, CameraRig, CameraPose } from '../model/types'
import { shotAtTime } from './cutTrack'
import { lerpPose } from './interpolate'

// カット先頭からの経過秒 tInShot を、moveRange 窓 [u0,u1] 上の正規化位置 u に変換する。
export function moveU(shot: Shot, tInShot: number): number {
  const dur = Math.max(shot.durationSec, 0.001)
  const [u0, u1] = shot.moveRange ?? [0, 1]
  return u0 + (u1 - u0) * (tInShot / dur)
}

// 正規化位置 u（0=A, 1=B）でのカメラポーズ。
// script カットはライブカメラの poseA/poseB を内挿。カメラ欠落時は凍結ポーズにフォールバック。
export function shotPoseAtU(shot: Shot, cameras: CameraRig[], u: number): CameraPose | null {
  if (shot.source === 'script') {
    const cam = cameras.find((c) => c.id === shot.cameraId)
    if (cam) return cam.poseA && cam.poseB ? lerpPose(cam.poseA, cam.poseB, u) : cam.pose
  }
  const { a, b } = shot.poseSnapshot
  return b ? lerpPose(a, b, u) : a
}

// このカットにカメラムーブ（A→B）があるか。ポーズ解決と同じ分岐で判定する。
export function shotHasMove(shot: Shot, cameras: CameraRig[]): boolean {
  if (shot.source === 'script') {
    const cam = cameras.find((c) => c.id === shot.cameraId)
    if (cam) return !!(cam.poseA && cam.poseB)
  }
  return !!shot.poseSnapshot.b
}

// 再生時刻 t におけるアニマティックのカメラポーズ。
export function animaticPoseAt(shots: Shot[], cameras: CameraRig[], t: number): CameraPose | null {
  const at = shotAtTime(shots, t)
  if (!at) return null
  const shot = shots[at.idx]
  return shotPoseAtU(shot, cameras, moveU(shot, at.tInShot))
}
