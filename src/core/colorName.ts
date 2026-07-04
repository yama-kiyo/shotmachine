// hex色 → 英語の色名（AI動画生成プロンプト用。hexより色名の方が通じやすい）
const ANCHORS: Array<[string, number, number, number]> = [
  ['black', 20, 22, 26],
  ['dark gray', 70, 74, 80],
  ['gray', 138, 143, 152],
  ['light gray', 200, 204, 210],
  ['white', 244, 244, 240],
  ['red', 210, 50, 45],
  ['orange', 232, 120, 50],
  ['brown', 155, 112, 72],
  ['dark brown', 90, 64, 42],
  ['beige', 226, 205, 168],
  ['yellow', 230, 210, 70],
  ['olive', 110, 116, 45],
  ['green', 70, 160, 80],
  ['dark green', 65, 110, 65],
  ['teal', 60, 160, 155],
  ['light blue', 150, 195, 225],
  ['blue', 60, 105, 220],
  ['navy', 35, 50, 95],
  ['purple', 130, 70, 180],
  ['pink', 230, 130, 180],
  ['magenta', 220, 60, 200],
]

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function colorNameOf(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  let best = ANCHORS[0][0]
  let bestD = Infinity
  for (const [name, r, g, b] of ANCHORS) {
    // 知覚寄りの重み付きユークリッド距離
    const d = 2 * (rgb[0] - r) ** 2 + 4 * (rgb[1] - g) ** 2 + 3 * (rgb[2] - b) ** 2
    if (d < bestD) { bestD = d; best = name }
  }
  return best
}
