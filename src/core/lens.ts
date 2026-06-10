// 本物のレンズ計算。フルフレーム36×24mmセンサー前提。
import { deg } from './math'

export const SENSOR_W = 36 // mm
export const SENSOR_H = 24 // mm
export const FOCAL_PRESETS = [14, 18, 24, 28, 35, 50, 65, 85, 100, 135]

// アスペクト比に応じた有効センサー寸法（センサー内クロップ）
// ar >= 1.5（3:2より横長）: 横36mmフル使用、縦をクロップ
// ar < 1.5（4:3, 1:1, 9:16等）: 縦24mmフル使用、横をクロップ
export function effectiveSensor(ar: number): { w: number; h: number } {
  if (ar >= SENSOR_W / SENSOR_H) return { w: SENSOR_W, h: SENSOR_W / ar }
  return { w: SENSOR_H * ar, h: SENSOR_H }
}

// 水平画角（度）— UI表示用。「65mm · 31°」の31°はこれ（16:9で横36mmフル）
export function focalToHFovDeg(focal: number, ar = 16 / 9): number {
  const { w } = effectiveSensor(ar)
  return deg(2 * Math.atan(w / (2 * focal)))
}

// 垂直画角（度）— Three.jsのPerspectiveCamera.fovはこちら
export function focalToVFovDeg(focal: number, ar = 16 / 9): number {
  const { h } = effectiveSensor(ar)
  return deg(2 * Math.atan(h / (2 * focal)))
}

export function hFovToFocal(hFovDeg: number, ar = 16 / 9): number {
  const { w } = effectiveSensor(ar)
  return w / (2 * Math.tan((hFovDeg * Math.PI) / 360))
}
