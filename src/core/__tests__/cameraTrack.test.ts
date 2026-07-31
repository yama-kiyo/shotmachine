import { describe, it, expect } from 'vitest'
import {
  normalizeCamKeys, activeCamKeys, evalCamKeys, camKeysHaveMove, upsertCamKey,
  moveCamKey, removeCamKey, camKeysFromAB, splitCamKeys, mergeCamKeys,
} from '../cameraTrack'
import { v3 } from '../math'
import type { CameraKeyframe, CameraPose } from '../../model/types'

// x座標だけ動かすポーズ（補間結果を x で読めるようにする）
const pose = (x: number, focal = 35): CameraPose => ({
  position: v3(x, 1.5, 3), lookAt: v3(0, 1, 0), roll: 0, focalLength: focal,
})
const k = (tSec: number, x: number, ease?: CameraKeyframe['ease']): CameraKeyframe => ({ tSec, pose: pose(x), ease })

describe('cameraTrack: normalizeCamKeys', () => {
  it('tSec昇順に整列し、同時刻(±0.005s)は後勝ちで畳む', () => {
    const out = normalizeCamKeys([k(2, 20), k(0, 0), k(2.003, 99)])
    expect(out.map((x) => x.tSec)).toEqual([0, 2])
    expect(out[1].pose.position.x).toBe(99) // 後勝ち
  })
  it('負の時刻は0へクランプし、0.01s丸めする', () => {
    const out = normalizeCamKeys([k(-5, 1), k(1.238, 2)])
    expect(out[0].tSec).toBe(0)
    expect(out[1].tSec).toBe(1.24)
  })
  it('壊れた要素（pose欠損・NaN・座標非数値）は捨てる', () => {
    const broken = [
      k(0, 0),
      { tSec: 1 } as unknown as CameraKeyframe,
      { tSec: NaN, pose: pose(1) } as CameraKeyframe,
      { tSec: 2, pose: { position: { x: 'a' }, lookAt: v3(0, 0, 0), roll: 0, focalLength: 35 } } as unknown as CameraKeyframe,
    ]
    expect(normalizeCamKeys(broken)).toHaveLength(1)
  })
})

describe('cameraTrack: activeCamKeys（inert）', () => {
  it('カット尺より後ろのKFは評価から外す（削除はしない）', () => {
    const keys = [k(0, 0), k(2, 20), k(9, 90)]
    expect(activeCamKeys(keys, 3).map((x) => x.tSec)).toEqual([0, 2])
    expect(keys).toHaveLength(3) // 非破壊
  })
  it('全部が範囲外でも先頭1個は残す（カメラが消えないため）', () => {
    expect(activeCamKeys([k(5, 50), k(9, 90)], 1)).toHaveLength(1)
  })
})

describe('cameraTrack: evalCamKeys', () => {
  it('2キーは従来のA→Bムーブと同じ（easeInOut・中点で50%）', () => {
    const keys = [k(0, 0), k(4, 100)]
    expect(evalCamKeys(keys, 0)!.position.x).toBeCloseTo(0)
    expect(evalCamKeys(keys, 2)!.position.x).toBeCloseTo(50) // smoothstep(0.5)=0.5
    expect(evalCamKeys(keys, 4)!.position.x).toBeCloseTo(100)
  })
  it('3キーの折れ線: 各区間が独立して補間される', () => {
    const keys = [k(0, 0), k(2, 100), k(4, 0)] // 寄って戻る
    expect(evalCamKeys(keys, 1)!.position.x).toBeCloseTo(50)
    expect(evalCamKeys(keys, 2)!.position.x).toBeCloseTo(100)
    expect(evalCamKeys(keys, 3)!.position.x).toBeCloseTo(50)
  })
  it('「静止→寄る」が打てる（同ポーズ2キーの後に移動キー）', () => {
    const keys = [k(0, 0), k(2, 0), k(3, 100)] // 2秒静止 → 1秒で寄る
    expect(evalCamKeys(keys, 1)!.position.x).toBeCloseTo(0)
    expect(evalCamKeys(keys, 2)!.position.x).toBeCloseTo(0)
    expect(evalCamKeys(keys, 2.5)!.position.x).toBeCloseTo(50)
  })
  it('linear 指定の区間は線形補間になる', () => {
    const keys = [k(0, 0, 'linear'), k(4, 100)]
    expect(evalCamKeys(keys, 1)!.position.x).toBeCloseTo(25) // easeInOutなら15.6
  })
  it('先頭より前・末尾より後ろはクランプ（ホールド）', () => {
    const keys = [k(1, 10), k(2, 20)]
    expect(evalCamKeys(keys, 0)!.position.x).toBeCloseTo(10)
    expect(evalCamKeys(keys, 99)!.position.x).toBeCloseTo(20)
  })
  it('1キーはそのポーズ固定、0キーは null', () => {
    expect(evalCamKeys([k(0, 7)], 5)!.position.x).toBe(7)
    expect(evalCamKeys([], 0)).toBeNull()
  })
  it('焦点距離も補間される（ズーム）', () => {
    const keys = [{ tSec: 0, pose: pose(0, 24) }, { tSec: 2, pose: pose(0, 80) }]
    expect(evalCamKeys(keys, 1)!.focalLength).toBeCloseTo(52)
  })
})

describe('cameraTrack: camKeysHaveMove', () => {
  it('ポーズが変わらない2キーは「動きなし」', () => {
    expect(camKeysHaveMove([k(0, 5), k(2, 5)])).toBe(false)
  })
  it('位置が変われば動きあり / 1キー以下は常に false', () => {
    expect(camKeysHaveMove([k(0, 0), k(2, 1)])).toBe(true)
    expect(camKeysHaveMove([k(0, 0)])).toBe(false)
    expect(camKeysHaveMove(undefined)).toBe(false)
  })
  it('尺の外にしか差分が無い場合は動きなし扱い（inert考慮）', () => {
    expect(camKeysHaveMove([k(0, 0), k(9, 90)], 3)).toBe(false)
  })
})

describe('cameraTrack: 編集操作', () => {
  it('upsertCamKey: 同時刻(±0.05s)は差し替え、それ以外は挿入して昇順維持', () => {
    let keys = upsertCamKey(undefined, 1, pose(10))
    keys = upsertCamKey(keys, 0, pose(0))
    expect(keys.map((x) => x.tSec)).toEqual([0, 1])
    keys = upsertCamKey(keys, 1.02, pose(99))
    expect(keys).toHaveLength(2)
    expect(keys[1].pose.position.x).toBe(99)
  })
  it('moveCamKey: [0,尺]でクランプし再ソート、適用後の時刻を返す', () => {
    const keys = [k(0, 0), k(1, 10), k(2, 20)]
    const r = moveCamKey(keys, 1, 99, 3)
    expect(r.tSec).toBe(3)
    expect(r.keys.map((x) => x.tSec)).toEqual([0, 2, 3])
    expect(moveCamKey(keys, 1, -5, 3).tSec).toBe(0)
  })
  it('removeCamKey: 最後の1個を消すと undefined（A/B評価に戻すため）', () => {
    expect(removeCamKey([k(0, 0), k(1, 1)], 0)).toHaveLength(1)
    expect(removeCamKey([k(0, 0)], 0)).toBeUndefined()
  })
  it('camKeysFromAB: A/Bムーブを2キーへ変換、Bなしは1キー', () => {
    expect(camKeysFromAB(pose(0), pose(9), 4).map((x) => x.tSec)).toEqual([0, 4])
    expect(camKeysFromAB(pose(0), null, 4)).toHaveLength(1)
  })
})

describe('cameraTrack: 分割と結合', () => {
  it('splitCamKeys: 境界に仮想KFが入り、両側でモーションが連続する', () => {
    const keys = [k(0, 0), k(4, 100)]
    const { left, right } = splitCamKeys(keys, 2)
    // 左の末尾と右の先頭が同じポーズ＝分割点で途切れない
    expect(left[left.length - 1].tSec).toBe(2)
    expect(right[0].tSec).toBe(0)
    expect(left[left.length - 1].pose.position.x).toBeCloseTo(50)
    expect(right[0].pose.position.x).toBeCloseTo(50)
    // 右側は tSec が再基準化される
    expect(right[right.length - 1].tSec).toBe(2)
  })
  it('分割→結合のラウンドトリップ: linear区間なら評価ポーズが完全に元へ戻る', () => {
    const keys = [k(0, 0, 'linear'), k(2, 100, 'linear'), k(4, 0, 'linear')]
    const { left, right } = splitCamKeys(keys, 1.5)
    const merged = mergeCamKeys(left, 1.5, right)!
    for (const t of [0, 0.5, 1.5, 2, 3, 4]) {
      expect(evalCamKeys(merged, t)!.position.x).toBeCloseTo(evalCamKeys(keys, t)!.position.x, 4)
    }
  })
  it('分割→結合のラウンドトリップ: 元のKF時刻・ポーズは保存され、境界KFが1つ増える', () => {
    // easeInOut は区間ごとに加減速するため、分割で区間が割れると曲線自体は元と一致しない
    // （分割点で一度減速して再加速する）。カットチェンジ点なので実用上は問題にならないが、
    // 「キーが失われない・時刻がずれない」ことは保証する。
    const keys = [k(0, 0), k(2, 100), k(4, 0)]
    const { left, right } = splitCamKeys(keys, 1.5)
    const merged = mergeCamKeys(left, 1.5, right)!
    expect(merged.map((x) => x.tSec)).toEqual([0, 1.5, 2, 4])
    for (const orig of keys) {
      const found = merged.find((m) => Math.abs(m.tSec - orig.tSec) < 1e-6)
      expect(found?.pose.position.x).toBeCloseTo(orig.pose.position.x)
    }
  })
  it('mergeCamKeys: 右の時刻が左カット尺だけ後ろへずれ、境界の重複は畳まれる', () => {
    const merged = mergeCamKeys([k(0, 0), k(2, 50)], 2, [k(0, 50), k(1, 99)])!
    expect(merged.map((x) => x.tSec)).toEqual([0, 2, 3])
  })
  it('mergeCamKeys: 両方 camKeys なしなら undefined', () => {
    expect(mergeCamKeys(undefined, 2, undefined)).toBeUndefined()
  })
})
