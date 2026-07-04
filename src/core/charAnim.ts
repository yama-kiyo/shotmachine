// キャラクターキーフレームの評価（再生時間→位置・向き・姿勢・腕ポーズ）
// 位置と向きは線形補間（向きは最短弧）、姿勢・腕ポーズはセグメント開始キーの値を保持
import type { Character, CharKeyframe, PoseState, ArmPose } from '../model/types'
import type { Vec3 } from './math'

export interface CharAnimState {
  position: Vec3
  rotationY: number
  poseState: PoseState
  armPose: ArmPose
}

export function baseCharState(char: Character): CharAnimState {
  return {
    position: char.position,
    rotationY: char.rotationY,
    poseState: char.poseState ?? 'stand',
    armPose: char.armPose ?? 'natural',
  }
}

// 角度の最短弧補間（-π..π をまたいでも近い方へ回る）
export function lerpAngle(a: number, b: number, t: number): number {
  const TAU = Math.PI * 2
  let d = (b - a) % TAU
  if (d > Math.PI) d -= TAU
  if (d < -Math.PI) d += TAU
  return a + d * t
}

const kfState = (k: CharKeyframe): CharAnimState => ({
  position: k.position,
  rotationY: k.rotationY,
  poseState: k.poseState,
  armPose: k.armPose,
})

// time昇順前提（store側でソート保証）。範囲外は端のキーで固定
export function charStateAt(char: Character, time: number): CharAnimState {
  const kfs = char.keyframes
  if (!kfs?.length) return baseCharState(char)
  if (time <= kfs[0].time) return kfState(kfs[0])
  const last = kfs[kfs.length - 1]
  if (time >= last.time) return kfState(last)
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]
    const b = kfs[i + 1]
    if (time > b.time) continue
    const span = Math.max(b.time - a.time, 1e-6)
    const t = (time - a.time) / span
    return {
      position: {
        x: a.position.x + (b.position.x - a.position.x) * t,
        y: a.position.y + (b.position.y - a.position.y) * t,
        z: a.position.z + (b.position.z - a.position.z) * t,
      },
      rotationY: lerpAngle(a.rotationY, b.rotationY, t),
      // 姿勢・腕ポーズは補間できないのでセグメント開始キーの値を維持
      poseState: a.poseState,
      armPose: a.armPose,
    }
  }
  return kfState(last)
}

// 同時刻（±epsilon）のキーは置換してソート挿入
export function upsertKeyframe(
  kfs: CharKeyframe[] | undefined, kf: CharKeyframe, epsilon = 0.05,
): CharKeyframe[] {
  const out = (kfs ?? []).filter((k) => Math.abs(k.time - kf.time) > epsilon)
  out.push(kf)
  out.sort((a, b) => a.time - b.time)
  return out
}
