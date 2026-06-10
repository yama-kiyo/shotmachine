// カメラムーブ A→B の自動分類
import { sub, dot, normalize, v3, length, deg, azimuthXZ, wrapAngle, distanceXZ } from './math'
import type { CameraPose, MoveType } from '../model/types'

const POS_EPS = 0.05 // m
const ANG_EPS = 2 // 度
const FOCAL_EPS = 1 // mm

export function classifyMove(a: CameraPose, b: CameraPose): MoveType {
  const dPos = sub(b.position, a.position)
  const posMag = length(dPos)
  const fA = normalize(sub(a.lookAt, a.position))
  const fB = normalize(sub(b.lookAt, b.position))
  const yawA = Math.atan2(fA.x, fA.z)
  const yawB = Math.atan2(fB.x, fB.z)
  const pitchA = Math.asin(Math.max(-1, Math.min(1, fA.y)))
  const pitchB = Math.asin(Math.max(-1, Math.min(1, fB.y)))
  const dYaw = Math.abs(deg(wrapAngle(yawB - yawA)))
  const dPitch = Math.abs(deg(pitchB - pitchA))
  const dFocal = Math.abs(b.focalLength - a.focalLength)
  const rotating = dYaw >= ANG_EPS || dPitch >= ANG_EPS

  if (posMag < POS_EPS) {
    if (!rotating && dFocal < FOCAL_EPS) return 'Static'
    if (!rotating) return 'Zoom'
    if (dFocal >= FOCAL_EPS) return 'Compound' // パン/ティルト＋ズームの複合
    return dYaw >= dPitch ? 'Pan' : 'Tilt'
  }

  // 被写体（注視点）基準の解析。Arcは「同一の注視点」を見続けたまま距離を保ち方位角が回る。
  // Truckは注視点ごと平行移動するので、lookAtの移動量で弁別する
  const target = a.lookAt
  const lookAtStable = distanceXZ(a.lookAt, b.lookAt) < 0.3
  const distA = distanceXZ(a.position, target)
  const distB = distanceXZ(b.position, target)
  const dAz = Math.abs(deg(wrapAngle(
    azimuthXZ(target, b.position) - azimuthXZ(target, a.position),
  )))
  if (lookAtStable && distA > POS_EPS && Math.abs(distB - distA) <= 0.1 * distA && dAz > 10) {
    return 'Arc'
  }

  // ローカル成分分解（A時点の前方/右/上）
  const right = normalize(v3(fA.z, 0, -fA.x))
  const dF = dot(dPos, fA)
  const dR = dot(dPos, right)
  const dY = dPos.y
  const comps: Array<{ mag: number; type: MoveType }> = [
    { mag: Math.abs(dF), type: dF > 0 ? 'Push-in' : 'Pull-out' },
    { mag: Math.abs(dR), type: dR > 0 ? 'Truck R' : 'Truck L' },
    { mag: Math.abs(dY), type: dY > 0 ? 'Pedestal Up' : 'Pedestal Down' },
  ]
  comps.sort((x, y) => y.mag - x.mag)
  // 第2成分が主成分の60%超なら複合ムーブ
  if (comps[1].mag > 0.6 * comps[0].mag && comps[1].mag > POS_EPS) return 'Compound'
  return comps[0].type
}

export const MOVE_LABELS_JA: Record<MoveType, string> = {
  Static: '固定', Pan: 'パン', Tilt: 'ティルト',
  'Push-in': 'プッシュイン', 'Pull-out': 'プルアウト',
  'Truck L': 'トラック左', 'Truck R': 'トラック右',
  'Pedestal Up': 'ペデスタル上', 'Pedestal Down': 'ペデスタル下',
  Arc: 'アーク', Zoom: 'ズーム', Compound: '複合ムーブ',
}
