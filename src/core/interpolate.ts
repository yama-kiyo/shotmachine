// カメラポーズ補間（A→Bムーブのプレビュー/再生）
import { lerpV, lerp } from './math'
import type { CameraPose } from '../model/types'

export const easeInOut = (t: number): number => t * t * (3 - 2 * t) // smoothstep

export function lerpPose(a: CameraPose, b: CameraPose, t: number, eased = true): CameraPose {
  const k = eased ? easeInOut(Math.max(0, Math.min(1, t))) : t
  return {
    position: lerpV(a.position, b.position, k),
    lookAt: lerpV(a.lookAt, b.lookAt, k),
    roll: lerp(a.roll, b.roll, k),
    focalLength: lerp(a.focalLength, b.focalLength, k),
  }
}
