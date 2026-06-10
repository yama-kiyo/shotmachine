// カメラ高さ・水平の自動ラベル（「eye-level · level」表示）
import { deg, distanceXZ } from './math'
import type { CameraPose } from '../model/types'

const LEVEL_EPS_DEG = 3
const HEIGHT_EPS_M = 0.15

export interface HeightLabel { height: string; tilt: string }

export function cameraHeightLabel(pose: CameraPose, subjectEyeY?: number): HeightLabel {
  const y = pose.position.y
  let height: string
  if (subjectEyeY !== undefined) {
    if (y < subjectEyeY - HEIGHT_EPS_M) height = 'low-angle'
    else if (y > subjectEyeY + HEIGHT_EPS_M) height = 'high-angle'
    else height = 'eye-level'
  } else {
    if (y < 1.2) height = 'low-angle'
    else if (y > 1.8) height = 'high-angle'
    else height = 'eye-level'
  }
  const horiz = distanceXZ(pose.position, pose.lookAt)
  const pitch = deg(Math.atan2(pose.lookAt.y - y, Math.max(horiz, 1e-6)))
  let tilt: string
  if (Math.abs(pitch) < LEVEL_EPS_DEG) tilt = 'level'
  else tilt = pitch > 0 ? 'tilt up' : 'tilt down'
  return { height, tilt }
}

export const formatHeightLabel = (l: HeightLabel): string => `${l.height} · ${l.tilt}`
