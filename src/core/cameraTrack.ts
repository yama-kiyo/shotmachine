// カット内カメラキーフレーム（camKeys）の評価と編集（store 非依存の純関数）。
//
// キャラKFが「タイムライン絶対秒」なのに対し、カメラKFは **カットIN点からのローカル秒**。
// 映画の実務では「ショット＝カメラのセットアップとムーブ」でカメラワークはカットに帰属し、
// また同一カメラリグが複数カットで使い回される（MASTER/OTS/CU）ため、絶対時間では
// 「カットごとに再生する」が表現できない。ローカル秒ならロール/リップルでカット尺が
// 変わってもカメラワークはカットに追従する。
import type { CameraKeyframe, CameraPose } from '../model/types'
import { lerpPose } from './interpolate'

const EPS = 1e-6
export const roundT = (t: number): number => Math.round(t * 100) / 100

const isVec = (v: unknown): boolean => {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
}
// 保存ファイル由来の壊れたKFを弾く（読み込み時の防御。再生中のクラッシュを避ける）
export const isValidCamKey = (k: unknown): boolean => {
  if (typeof k !== 'object' || k === null) return false
  const kf = k as Record<string, unknown>
  if (!Number.isFinite(kf.tSec)) return false
  const pose = kf.pose as Record<string, unknown> | undefined
  if (!pose) return false
  return isVec(pose.position) && isVec(pose.lookAt) &&
    Number.isFinite(pose.roll) && Number.isFinite(pose.focalLength)
}

// tSec 昇順に整列。同時刻（±0.005s）の重複は後勝ちで1つに畳む。負の時刻は0へクランプ。
export function normalizeCamKeys(keys: CameraKeyframe[]): CameraKeyframe[] {
  const sorted = keys
    .filter(isValidCamKey)
    .map((k) => ({ ...k, tSec: roundT(Math.max(0, k.tSec)) }))
    .sort((a, b) => a.tSec - b.tSec)
  const out: CameraKeyframe[] = []
  for (const k of sorted) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.tSec - k.tSec) <= 0.005) out[out.length - 1] = k
    else out.push(k)
  }
  return out
}

// カット尺内の有効KF。尺より後ろのKFは評価から外す（inert・非破壊。尺を戻せば復活する）。
// 全部が範囲外になった場合でもカメラが消えないよう、先頭1個だけは必ず残す。
export function activeCamKeys(keys: CameraKeyframe[], durationSec: number): CameraKeyframe[] {
  const inRange = keys.filter((k) => k.tSec <= durationSec + EPS)
  return inRange.length ? inRange : keys.slice(0, 1)
}

// カット先頭からの経過秒 tInShot におけるカメラポーズ。
// 先頭KFより前・末尾KFより後ろはクランプ（ホールド）。区間の補間は k0.ease に従う。
export function evalCamKeys(
  keys: CameraKeyframe[],
  tInShot: number,
  durationSec = Infinity,
): CameraPose | null {
  const ks = activeCamKeys(keys, durationSec)
  if (!ks.length) return null
  if (ks.length === 1) return ks[0].pose
  if (tInShot <= ks[0].tSec) return ks[0].pose
  const last = ks[ks.length - 1]
  if (tInShot >= last.tSec) return last.pose
  for (let i = 0; i < ks.length - 1; i++) {
    const k0 = ks[i]
    const k1 = ks[i + 1]
    if (tInShot >= k0.tSec && tInShot <= k1.tSec) {
      const span = k1.tSec - k0.tSec
      const u = span <= EPS ? 1 : (tInShot - k0.tSec) / span
      return lerpPose(k0.pose, k1.pose, u, (k0.ease ?? 'easeInOut') === 'easeInOut')
    }
  }
  return last.pose
}

// カメラが実際に動くか（2個以上のKFがあり、どこかでポーズが変化する）。
export function camKeysHaveMove(keys: CameraKeyframe[] | undefined, durationSec = Infinity): boolean {
  if (!keys || keys.length < 2) return false
  const ks = activeCamKeys(keys, durationSec)
  if (ks.length < 2) return false
  const a = ks[0].pose
  return ks.some((k) => {
    const p = k.pose
    return (
      Math.abs(p.position.x - a.position.x) > 1e-4 ||
      Math.abs(p.position.y - a.position.y) > 1e-4 ||
      Math.abs(p.position.z - a.position.z) > 1e-4 ||
      Math.abs(p.lookAt.x - a.lookAt.x) > 1e-4 ||
      Math.abs(p.lookAt.y - a.lookAt.y) > 1e-4 ||
      Math.abs(p.lookAt.z - a.lookAt.z) > 1e-4 ||
      Math.abs(p.roll - a.roll) > 1e-4 ||
      Math.abs(p.focalLength - a.focalLength) > 1e-4
    )
  })
}

// 指定時刻にKFを追加（同時刻±0.05sに既存があれば差し替え）。
export function upsertCamKey(
  keys: CameraKeyframe[] | undefined,
  tSec: number,
  pose: CameraPose,
  ease?: CameraKeyframe['ease'],
): CameraKeyframe[] {
  const t = roundT(Math.max(0, tSec))
  const rest = (keys ?? []).filter((k) => Math.abs(k.tSec - t) > 0.05)
  const existing = (keys ?? []).find((k) => Math.abs(k.tSec - t) <= 0.05)
  return normalizeCamKeys([...rest, { tSec: t, pose, ease: ease ?? existing?.ease }])
}

// KFの時刻変更（[0, durationSec] 内クランプ＋再整列）。適用後の実時刻を返す。
export function moveCamKey(
  keys: CameraKeyframe[],
  index: number,
  tSec: number,
  durationSec: number,
): { keys: CameraKeyframe[]; tSec: number } {
  const kf = keys[index]
  if (!kf) return { keys, tSec: 0 }
  const t = roundT(Math.min(Math.max(tSec, 0), durationSec))
  const rest = keys.filter((_, i) => i !== index)
  return { keys: normalizeCamKeys([...rest, { ...kf, tSec: t }]), tSec: t }
}

// KF削除。空になったら undefined を返す（Shot.camKeys ごと落として旧A/B評価へ戻すため）。
export function removeCamKey(keys: CameraKeyframe[], index: number): CameraKeyframe[] | undefined {
  const out = keys.filter((_, i) => i !== index)
  return out.length ? out : undefined
}

// A→Bの2点ムーブをKF列へ変換（初回KF追加時にカメラワークが消えないための橋渡し）。
// moveRange 窓を適用済みの実効ポーズ（＝カット頭とカット尻で実際に見えるポーズ）を渡すこと。
export function camKeysFromAB(
  poseAtStart: CameraPose,
  poseAtEnd: CameraPose | null,
  durationSec: number,
): CameraKeyframe[] {
  if (!poseAtEnd) return [{ tSec: 0, pose: poseAtStart }]
  return [
    { tSec: 0, pose: poseAtStart },
    { tSec: roundT(Math.max(0.01, durationSec)), pose: poseAtEnd },
  ]
}

// カット分割: tSplit 前後へ振り分け、境界に評価ポーズの仮想KFを両側へ挿入して
// モーションを連続させる（moveRange 比率分割の一般化）。right は tSec を -tSplit で再基準化。
export function splitCamKeys(
  keys: CameraKeyframe[],
  tSplit: number,
  durationSec = Infinity,
): { left: CameraKeyframe[]; right: CameraKeyframe[] } {
  const ks = normalizeCamKeys(keys)
  const boundaryPose = evalCamKeys(ks, tSplit, durationSec)
  const left = ks.filter((k) => k.tSec < tSplit - EPS)
  const right = ks
    .filter((k) => k.tSec > tSplit + EPS)
    .map((k) => ({ ...k, tSec: roundT(k.tSec - tSplit) }))
  if (boundaryPose) {
    // 境界の ease は「その位置を含む区間」の設定を引き継ぐ
    const seg = [...ks].reverse().find((k) => k.tSec <= tSplit + EPS)
    left.push({ tSec: roundT(tSplit), pose: boundaryPose, ease: seg?.ease })
    right.unshift({ tSec: 0, pose: boundaryPose, ease: seg?.ease })
  }
  return { left: normalizeCamKeys(left), right: normalizeCamKeys(right) }
}

// カット結合: right の tSec に leftDur を加算して連結。境界の重複KF（±0.05s）は1個に畳む。
export function mergeCamKeys(
  leftKeys: CameraKeyframe[] | undefined,
  leftDur: number,
  rightKeys: CameraKeyframe[] | undefined,
): CameraKeyframe[] | undefined {
  const l = leftKeys ?? []
  const r = (rightKeys ?? []).map((k) => ({ ...k, tSec: roundT(k.tSec + leftDur) }))
  if (!l.length && !r.length) return undefined
  return normalizeCamKeys([...l, ...r])
}
