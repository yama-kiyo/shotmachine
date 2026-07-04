// タイムコード表記。再生バー用の secondsToTimecode（整数秒）と、
// 絵コンテ・書き出し用の 24fps 固定「秒＋コマ」表記（secondsToTC / secondsToFC）を持つ。
const FPS = 24

export function secondsToTimecode(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

// 総フレーム数（0.5コマ以上で繰り上げ）。ff==FPS の桁上がりも %/floor で自然に吸収する。
function totalFrames(sec: number): number {
  return Math.round(Math.max(0, sec) * FPS)
}

// 絶対時刻を mm:ss+ff（24fps固定）で表す。例: 4.208s → "00:04+05"、3.999s → "00:04+00"。
export function secondsToTC(sec: number): string {
  const f = totalFrames(sec)
  const ff = f % FPS
  const totalSec = Math.floor(f / FPS)
  const mm = Math.floor(totalSec / 60)
  const ss = totalSec % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+${String(ff).padStart(2, '0')}`
}

// 尺を「秒＋コマ」s+ff（24fps固定）で表す。例: 2.79s → "2+19"、7.0s → "7+00"。
export function secondsToFC(sec: number): string {
  const f = totalFrames(sec)
  const ff = f % FPS
  const s = Math.floor(f / FPS)
  return `${s}+${String(ff).padStart(2, '0')}`
}
