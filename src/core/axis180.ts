// 180°ルール（イマジナリーライン）判定
import type { Vec3 } from './math'

const EPS = 1e-6
export const ON_LINE_TOLERANCE = 0.05 // m相当の外積閾値はライン長で正規化して判定

// XZ平面でa→bラインに対する点pのサイド。+1 / -1 / 0（ライン上）
export function sideOf(a: Vec3, b: Vec3, p: Vec3): 1 | -1 | 0 {
  const cross = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x)
  const lineLen = Math.hypot(b.x - a.x, b.z - a.z)
  // 外積/ライン長 = ラインからの符号付き距離
  const dist = lineLen < EPS ? 0 : cross / lineLen
  if (Math.abs(dist) < ON_LINE_TOLERANCE) return 0
  return dist > 0 ? 1 : -1
}

export type SideStatus = 'ok' | 'crossed' | 'on-line'

// 現在のカメラ位置でサイドを確立（ロック）
export function establishSide(a: Vec3, b: Vec3, camPos: Vec3): 1 | -1 {
  const s = sideOf(a, b, camPos)
  return s === 0 ? 1 : s
}

export function checkCameraSide(
  a: Vec3, b: Vec3, lockedSide: 1 | -1, camPos: Vec3,
): SideStatus {
  const s = sideOf(a, b, camPos)
  if (s === 0) return 'on-line'
  return s === lockedSide ? 'ok' : 'crossed'
}
