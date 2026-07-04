// カットトラックの純関数群（store 非依存）。
// 区間規約: 半開区間 [start, end)（境界時刻=次カットの頭）。時刻は 0.01s 丸めを規約化。
// カット境界は shots の順序配列 + durationSec の累積で導出する（startSec は保持しない）。
import type { Shot, DialogueClip } from '../model/types'

// 時刻を 0.01s に丸める（タイムライン全体の丸め規約）
export function roundTime(t: number): number {
  return Math.round(t * 100) / 100
}

// 分割時の右半分 id 用フォールバック（純度のため通常は idGen を注入する）
let fallbackCounter = 0
const fallbackIdGen = (): string => `shot_split_${Date.now().toString(36)}_${(fallbackCounter++).toString(36)}`

// 各カットの開始時刻（累積）。長さと同じ要素数。
export function shotStarts(shots: Shot[]): number[] {
  const starts: number[] = []
  let acc = 0
  for (const s of shots) {
    starts.push(roundTime(acc))
    acc += s.durationSec
  }
  return starts
}

// 再生時刻 t が属するカットと、そのカット先頭からの経過秒。半開区間 [start, end)。
// 境界時刻は次カットの頭に属する。総尺ちょうど（t>=total）は最終カットの末尾に解決。
export function shotAtTime(shots: Shot[], t: number): { idx: number; tInShot: number } | null {
  if (shots.length === 0) return null
  const total = shots.reduce((a, s) => a + s.durationSec, 0)
  const last = shots.length - 1
  if (t >= total) return { idx: last, tInShot: roundTime(shots[last].durationSec) }
  let acc = 0
  for (let i = 0; i < shots.length; i++) {
    const end = acc + shots[i].durationSec
    if (t < end) return { idx: i, tInShot: roundTime(Math.max(0, t - acc)) }
    acc = end
  }
  return { idx: last, tInShot: roundTime(shots[last].durationSec) }
}

// ロール: カット boundaryIdx と boundaryIdx+1 の境界を動かす。左+δ/右−δ、両カットの合計は不変。
// 双方を minDur 以上にクランプする。境界が範囲外・可動域なしなら元配列を返す。
export function rollBoundary(shots: Shot[], boundaryIdx: number, deltaSec: number, minDur = 0.5): Shot[] {
  if (boundaryIdx < 0 || boundaryIdx >= shots.length - 1) return shots
  const left = shots[boundaryIdx]
  const right = shots[boundaryIdx + 1]
  const lo = minDur - left.durationSec
  const hi = right.durationSec - minDur
  if (lo > hi) return shots // 合計 < 2*minDur で双方を満たせない
  const d = Math.min(Math.max(deltaSec, lo), hi)
  const totalLR = left.durationSec + right.durationSec
  const newLeft = roundTime(left.durationSec + d)
  const newRight = roundTime(totalLR - newLeft) // 合計不変を丸め越しで担保
  const out = shots.map((s) => ({ ...s }))
  out[boundaryIdx] = { ...out[boundaryIdx], durationSec: newLeft }
  out[boundaryIdx + 1] = { ...out[boundaryIdx + 1], durationSec: newRight }
  return out
}

// リップル: 左カット boundaryIdx の尺のみ変更、以降は自動的に後方シフト（累積モデルのため）。
// boundaryIdx = 最終インデックスなら最終カット右端＝総尺の伸縮。minDur でクランプ。
export function rippleBoundary(shots: Shot[], boundaryIdx: number, deltaSec: number, minDur = 0.5): Shot[] {
  if (boundaryIdx < 0 || boundaryIdx >= shots.length) return shots
  const cur = shots[boundaryIdx]
  const newDur = roundTime(Math.max(minDur, cur.durationSec + deltaSec))
  const out = shots.map((s) => ({ ...s }))
  out[boundaryIdx] = { ...cur, durationSec: newDur }
  return out
}

// 分割: カット idx を tInShot（カット先頭基準）で2つに割る。
// moveRange は比率分割（左[u0,um]/右[um,u1]、um=u0+(u1-u0)*(tInShot/dur)）。
// poseSnapshot/thumbnail は複製（呼び出し側が後で再撮影しうる）。右半分は idGen() で新 id。
// どちらかが minDur 未満なら分割不可として null を返す。
export function splitShot(
  shots: Shot[],
  idx: number,
  tInShot: number,
  minDur = 0.5,
  idGen: () => string = fallbackIdGen,
): Shot[] | null {
  if (idx < 0 || idx >= shots.length) return null
  const shot = shots[idx]
  const dur = shot.durationSec
  const leftDur = tInShot
  const rightDur = dur - tInShot
  if (leftDur < minDur || rightDur < minDur) return null
  const [u0, u1] = shot.moveRange ?? [0, 1]
  const um = u0 + (u1 - u0) * (tInShot / dur) // 正規化窓は丸めず精度維持
  const left: Shot = { ...shot, durationSec: roundTime(leftDur), moveRange: [u0, um] }
  const right: Shot = { ...shot, id: idGen(), durationSec: roundTime(rightDur), moveRange: [um, u1] }
  const out = shots.map((s) => ({ ...s }))
  out.splice(idx, 1, left, right)
  return out
}

// 結合: カット idx と idx+1 を1つに。同一カメラ・連続 moveRange（左u1≈右u0）ならムーブ結合し
// moveRange=[左u0, 右u1]。それ以外は左カットのポーズ/サムネを採用。尺は合算。範囲外なら元配列。
export function mergeShots(shots: Shot[], idx: number): Shot[] {
  if (idx < 0 || idx >= shots.length - 1) return shots
  const left = shots[idx]
  const right = shots[idx + 1]
  const dur = roundTime(left.durationSec + right.durationSec)
  const lr = left.moveRange
  const rr = right.moveRange
  const contiguous = !!lr && !!rr && left.cameraId === right.cameraId && Math.abs(lr[1] - rr[0]) < 1e-6
  const merged: Shot = contiguous
    ? { ...left, durationSec: dur, moveRange: [lr![0], rr![1]] }
    : { ...left, durationSec: dur }
  const out = shots.map((s) => ({ ...s }))
  out.splice(idx, 2, merged)
  return out
}

// クリップの startSec を [0, totalSec-durationSec] にクランプし、他クリップとの重なりを禁止。
// 望み位置に最も近い空きへスナップ（重なる相手には中心比較で左右どちらかへ寄せる）。
export function clampClip(clip: DialogueClip, clips: DialogueClip[], totalSec: number): DialogueClip {
  const dur = clip.durationSec
  const maxStart = Math.max(0, totalSec - dur)
  const desired = Math.min(Math.max(clip.startSec, 0), maxStart)
  let lo = 0
  let hi = maxStart
  for (const o of clips) {
    if (o.id === clip.id) continue
    const oStart = o.startSec
    const oEnd = o.startSec + o.durationSec
    if (oEnd <= desired) {
      lo = Math.max(lo, oEnd) // 完全に左 → 下限を押し上げ
    } else if (oStart >= desired + dur) {
      hi = Math.min(hi, oStart - dur) // 完全に右 → 上限を押し下げ
    } else {
      // 望み区間と重なる: 中心比較で寄せる側を決める
      const oCenter = oStart + o.durationSec / 2
      if (desired + dur / 2 < oCenter) hi = Math.min(hi, oStart - dur)
      else lo = Math.max(lo, oEnd)
    }
  }
  let start = lo > hi ? Math.min(Math.max(lo, 0), maxStart) : Math.min(Math.max(desired, lo), hi)
  return { ...clip, startSec: roundTime(start) }
}
