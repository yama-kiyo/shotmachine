// ショットサイズ自動フレーミングソルバ
// 身体正規化座標: 0=足元, 1=頭頂。topがフレーム上端、bottomがフレーム下端に来るようカメラ距離を解く
import { Vec3, v3, sub, normalize, azimuthXZ, rad as toRad } from './math'
import { focalToVFovDeg, focalToHFovDeg } from './lens'
import type { Character, CameraPose } from '../model/types'
import type { ShotSize } from '../model/types'

export const EYE_NORM = 0.93 // 目の高さ / 身長
export const SHOULDER_NORM = 0.82

export interface FramingDef { top: number; bottom: number; lookAtNorm: number; label: string }

export const SHOT_SIZE_DEFS: Record<Exclude<ShotSize, 'OTS' | '2-SHOT' | 'POV'>, FramingDef> = {
  ECU: { top: 1.02, bottom: 0.86, lookAtNorm: EYE_NORM, label: 'エクストリームクローズアップ' },
  CU:  { top: 1.04, bottom: 0.78, lookAtNorm: EYE_NORM, label: 'クローズアップ' },
  MCU: { top: 1.06, bottom: 0.65, lookAtNorm: EYE_NORM, label: 'ミディアムクローズアップ' },
  MS:  { top: 1.08, bottom: 0.50, lookAtNorm: 0.85, label: 'ミディアムショット' },
  FS:  { top: 1.06, bottom: -0.02, lookAtNorm: 0.60, label: 'フルショット' },
  WS:  { top: 1.35, bottom: -0.40, lookAtNorm: 0.60, label: 'ワイドショット' },
  EWS: { top: 2.50, bottom: -1.50, lookAtNorm: 0.60, label: 'エクストリームワイド' },
  INS: { top: 0.58, bottom: 0.34, lookAtNorm: 0.46, label: 'インサート（手元）' },
}

export const SHOT_SIZE_LABELS_EN: Record<ShotSize, string> = {
  EWS: 'extreme wide shot', WS: 'wide shot', FS: 'full shot', MS: 'medium shot',
  MCU: 'medium close-up', CU: 'close-up', ECU: 'extreme close-up',
  OTS: 'over-the-shoulder shot', '2-SHOT': 'two shot', POV: 'point-of-view shot',
  INS: 'insert shot',
}

// フレーム高にspanを収めるためのカメラ距離
export function framingDistance(spanM: number, focal: number, ar: number): number {
  const vFov = toRad(focalToVFovDeg(focal, ar))
  return spanM / 2 / Math.tan(vFov / 2)
}

const forwardOf = (rotY: number): Vec3 => v3(Math.sin(rotY), 0, Math.cos(rotY))

// 単独被写体のフレーミング。currentCamPosがあれば現在の方位角を維持、なければ被写体正面
export function solveFraming(
  char: Character, size: keyof typeof SHOT_SIZE_DEFS, focal: number, ar: number,
  currentCamPos?: Vec3,
): CameraPose {
  const def = SHOT_SIZE_DEFS[size]
  const span = (def.top - def.bottom) * char.height
  const d = framingDistance(span, focal, ar)
  const lookY = char.position.y + def.lookAtNorm * char.height
  let az: number
  if (currentCamPos) az = azimuthXZ(char.position, currentCamPos)
  else az = char.rotationY // 正面（キャラ視線方向側）
  const position = v3(
    char.position.x + Math.sin(az) * d,
    lookY, // 水平カメラ
    char.position.z + Math.cos(az) * d,
  )
  const lookAt = v3(char.position.x, lookY, char.position.z)
  return { position, lookAt, roll: 0, focalLength: focal }
}

// POV: キャラの目位置から視線方向
export function solvePOV(char: Character, focal: number): CameraPose {
  const eye = v3(char.position.x, char.position.y + EYE_NORM * char.height, char.position.z)
  const f = forwardOf(char.rotationY)
  return {
    position: eye,
    lookAt: v3(eye.x + f.x * 3, eye.y, eye.z + f.z * 3),
    roll: 0,
    focalLength: focal,
  }
}

// OTS: overキャラの肩越しにtargetをMCU相当で。lockedSideがあればそのサイドを維持
export function solveOTS(
  target: Character, over: Character, focal: number, ar: number, lockedSide?: 1 | -1,
): CameraPose {
  const dir = normalize(sub(target.position, over.position)) // over→target
  let perp = v3(dir.z, 0, -dir.x) // 右手方向
  // カメラ位置候補: overの後方0.45m・肩外側（身長比例≈0.32m）・肩上0.15m
  const shoulderOffset = 0.18 * over.height
  const shoulderY = over.position.y + SHOULDER_NORM * over.height + 0.15
  const mk = (p: Vec3): Vec3 => v3(
    over.position.x - dir.x * 0.45 + p.x * shoulderOffset,
    shoulderY,
    over.position.z - dir.z * 0.45 + p.z * shoulderOffset,
  )
  let position = mk(perp)
  if (lockedSide !== undefined) {
    // 軸 = target↔over。サイドが合わなければ反対の肩へ
    const cross =
      (over.position.x - target.position.x) * (position.z - target.position.z) -
      (over.position.z - target.position.z) * (position.x - target.position.x)
    if (Math.sign(cross) !== lockedSide) position = mk(v3(-perp.x, 0, -perp.z))
  }
  const lookAt = v3(
    target.position.x,
    target.position.y + EYE_NORM * target.height,
    target.position.z,
  )
  return { position, lookAt, roll: 0, focalLength: focal }
}

// 2-SHOT: 2人をフレームに収める。横解と縦解の大きい方
export function solveTwoShot(
  a: Character, b: Character, focal: number, ar: number, lockedSide?: 1 | -1,
): CameraPose {
  const mid = v3(
    (a.position.x + b.position.x) / 2,
    0,
    (a.position.z + b.position.z) / 2,
  )
  const widthM = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) + 1.2 // 体幅+余白
  const hFov = toRad(focalToHFovDeg(focal, ar))
  const dH = widthM / 2 / Math.tan(hFov / 2)
  const maxH = Math.max(a.height, b.height)
  const spanV = 1.25 * maxH // 頭上余白込み
  const dV = framingDistance(spanV, focal, ar)
  const d = Math.max(dH, dV)
  // 軸（A-B線）に垂直な方向に配置
  const axisDir = normalize(sub(b.position, a.position))
  let perp = v3(axisDir.z, 0, -axisDir.x)
  if (lockedSide !== undefined) {
    const cross =
      (b.position.x - a.position.x) * (mid.z + perp.z * d - a.position.z) -
      (b.position.z - a.position.z) * (mid.x + perp.x * d - a.position.x)
    if (Math.sign(cross) !== lockedSide) perp = v3(-perp.x, 0, -perp.z)
  }
  const lookY = 0.55 * maxH
  return {
    position: v3(mid.x + perp.x * d, lookY, mid.z + perp.z * d),
    lookAt: v3(mid.x, lookY, mid.z),
    roll: 0,
    focalLength: focal,
  }
}
