// タイムラインのスナップ補助（store 非依存の純関数）。
// ドラッグ中の時刻 t を、候補時刻群のうち閾値内で最も近いものへ吸着する。
// 候補にはカット境界・クリップ端・キーフレーム時刻・0.1sグリッド等を呼び出し側が渡す。
export function snapTime(t: number, candidates: number[], thresholdSec: number): number {
  let best = t
  let bestDist = thresholdSec
  for (const c of candidates) {
    const d = Math.abs(c - t)
    if (d <= bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}

// 0.1s グリッドの最近点（snapTime の候補に混ぜる用）
export function nearestGrid(t: number, gridSec = 0.1): number {
  return Math.round(t / gridSec) * gridSec
}
