// UI・Three.js非依存の純粋ベクトル演算（コア層はthreeをimportしない）
export type Vec3 = { x: number; y: number; z: number }

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z)
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z)
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s)
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const length = (a: Vec3): number => Math.sqrt(dot(a, a))
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b))
export const distanceXZ = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.z - b.z)
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a)
  return l < 1e-9 ? v3(0, 0, 1) : scale(a, 1 / l)
}
export const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

// XZ平面での方位角（+Z方向=0、時計回り正）
export const azimuthXZ = (from: Vec3, to: Vec3): number =>
  Math.atan2(to.x - from.x, to.z - from.z)

// 角度差を -PI..PI に正規化
export const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

export const deg = (rad: number): number => (rad * 180) / Math.PI
export const rad = (d: number): number => (d * Math.PI) / 180
