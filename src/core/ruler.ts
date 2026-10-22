// 目盛り・グリッド線の生成（純関数）。入力が巨大でも本数に上限を設け、ループで画面が固まらないようにする。

// タイムラインのルーラー目盛りの上限本数
export const MAX_RULER_TICKS = 10_000
// 配置図のグリッド線の上限本数（1方向あたり）
export const MAX_GRID_LINES = 400

// 目盛り時刻の列。step 秒ごと。本数が上限を超える場合は間隔を広げる。total が不正なら空
export function rulerTicks(total: number, step: number, maxTicks = MAX_RULER_TICKS): number[] {
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(step) || step <= 0) return []
  const s = total / step > maxTicks ? Math.ceil(total / maxTicks) : step
  const out: number[] = []
  for (let i = 0; out.length <= maxTicks; i++) {
    const t = i * s
    if (t > total + 1e-6) break
    out.push(Math.round(t * 100) / 100)
  }
  return out
}

// -half..+half の範囲に 1m 間隔（多すぎる場合は間引いた整数間隔）のグリッド座標を返す
export function gridPositions(size: number, maxLines = MAX_GRID_LINES): number[] {
  if (!Number.isFinite(size) || size <= 0) return []
  const half = size / 2
  const step = Math.max(1, Math.ceil(size / maxLines))
  const out: number[] = []
  for (let g = Math.ceil(-half / step) * step; g <= half && out.length <= maxLines; g += step) out.push(g)
  return out
}
