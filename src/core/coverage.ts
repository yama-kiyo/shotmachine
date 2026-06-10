// 定番カバレッジの一括自動生成（マスター2S + OTS×2 + CU×2、全て正サイド）
import { solveFraming, solveOTS, solveTwoShot } from './framing'
import { sideOf } from './axis180'
import { v3, normalize, sub, azimuthXZ } from './math'
import type { Character, CameraPose, ShotSize } from '../model/types'

export interface CoverageCamera {
  name: string
  pose: CameraPose
  shotSize: ShotSize
  subjectIds: string[]
}

export function generateCoverage(
  a: Character, b: Character, lockedSide: 1 | -1, ar: number,
): CoverageCamera[] {
  const out: CoverageCamera[] = []

  // マスター: 2-SHOT WS（35mm）
  out.push({
    name: 'MASTER',
    pose: solveTwoShot(a, b, 35, ar, lockedSide),
    shotSize: '2-SHOT',
    subjectIds: [a.id, b.id],
  })

  // OTS×2（50mm）
  out.push({
    name: `OTS ${a.name}`,
    pose: solveOTS(a, b, 50, ar, lockedSide),
    shotSize: 'OTS',
    subjectIds: [a.id, b.id],
  })
  // solveOTSのサイド判定はsideOf(target, over)基準。target=bだと軸の向きが反転するので符号を反転
  out.push({
    name: `OTS ${b.name}`,
    pose: solveOTS(b, a, 50, ar, -lockedSide as 1 | -1),
    shotSize: 'OTS',
    subjectIds: [a.id, b.id],
  })

  // CU×2（65mm）: 相手方向から正サイドに15°オフセットした方位角
  for (const [target, other] of [[a, b], [b, a]] as const) {
    const azToOther = azimuthXZ(target.position, other.position)
    const offset = 0.35 // rad ≈ 20°
    for (const sign of [1, -1]) {
      const az = azToOther + offset * sign
      const probe = v3(
        target.position.x + Math.sin(az),
        0,
        target.position.z + Math.cos(az),
      )
      if (sideOf(a.position, b.position, probe) === lockedSide) {
        const camDir = v3(probe.x, 0, probe.z)
        const pose = solveFraming(target, 'CU', 65, ar, camDir)
        out.push({ name: `CU ${target.name}`, pose, shotSize: 'CU', subjectIds: [target.id] })
        break
      }
    }
  }
  return out
}
