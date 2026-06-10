import { describe, it, expect } from 'vitest'
import { POSE_METRICS, eyeY, headTopY } from '../poseMetrics'
import { solveFraming, solvePOV, framingHeight } from '../framing'
import { LOCATION_TEMPLATES, PROP_CATALOG, EQUIPMENT_KINDS, SET_PROP_KINDS } from '../../model/defaults'
import { makePlanTransform } from '../../export/floorPlan'
import { shotlistCsv } from '../../export/shotlistCsv'
import { sampleProject } from '../../model/defaults'
import { distanceXZ, v3 } from '../math'
import type { Character, Shot } from '../../model/types'

const mk = (pose?: Character['poseState']): Character => ({
  id: 'c1', name: 'Maya', color: '#f00', position: v3(0, 0, 0),
  rotationY: 0, height: 1.7, poseState: pose,
})

describe('V2: 姿勢メトリクス', () => {
  it('目の高さ: 立位 > 座位 > しゃがみ > 横臥', () => {
    const ys = (['stand', 'sit', 'crouch', 'lie'] as const).map((p) => eyeY(mk(p)))
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1])
  })
  it('立位の目の高さは0.93h（V1互換）', () => {
    expect(eyeY(mk())).toBeCloseTo(0.93 * 1.7, 5)
    expect(eyeY(mk('stand'))).toBeCloseTo(0.93 * 1.7, 5)
  })
  it('座位の目の高さは約1.2m（1.7mの人）', () => {
    expect(eyeY(mk('sit'))).toBeCloseTo(0.70 * 1.7, 5) // 1.19m
  })
  it('頭頂: poseごとにtopNorm×身長', () => {
    for (const p of ['stand', 'sit', 'crouch', 'lie'] as const) {
      expect(headTopY(mk(p))).toBeCloseTo(POSE_METRICS[p].topNorm * 1.7, 5)
    }
  })
})

describe('V2: 姿勢対応フレーミング', () => {
  it('座位のCUは立位より低く・近くなる', () => {
    const stand = solveFraming(mk('stand'), 'CU', 65, 16 / 9)
    const sit = solveFraming(mk('sit'), 'CU', 65, 16 / 9)
    expect(sit.position.y).toBeLessThan(stand.position.y)
    expect(distanceXZ(sit.position, v3(0, 0, 0))).toBeLessThan(distanceXZ(stand.position, v3(0, 0, 0)))
    // CUのlook-atは姿勢の実際の目の高さ
    expect(sit.lookAt.y).toBeCloseTo(eyeY(mk('sit')), 5)
  })
  it('座位POVは座った目の高さから', () => {
    expect(solvePOV(mk('sit'), 35).position.y).toBeCloseTo(0.70 * 1.7, 5)
  })
  it('横臥のフレーミング基準身長は下限0.35hでクランプ', () => {
    expect(framingHeight(mk('lie'))).toBeCloseTo(0.35 * 1.7, 5)
  })
})

describe('V2: ロケテンプレート', () => {
  it('6種以上あり、全プロップのkindがカタログに存在する', () => {
    expect(LOCATION_TEMPLATES.length).toBeGreaterThanOrEqual(6)
    for (const tpl of LOCATION_TEMPLATES) {
      expect(tpl.label.length).toBeGreaterThan(0)
      expect(tpl.slugline).toMatch(/^(INT|EXT)\./)
      for (const p of tpl.props) {
        expect(PROP_CATALOG[p.kind], `${tpl.key}: ${p.kind}`).toBeDefined()
        // プロップは部屋の範囲内（余白0.5m許容）
        expect(Math.abs(p.x)).toBeLessThanOrEqual(tpl.room.width / 2 + 0.5)
        expect(Math.abs(p.z)).toBeLessThanOrEqual(tpl.room.depth / 2 + 0.5)
      }
    }
  })
})

describe('V2: 機材カタログと配置図', () => {
  it('機材10種・全てにplanCodeがあり、セット美術と分離されている', () => {
    expect(EQUIPMENT_KINDS.length).toBeGreaterThanOrEqual(10)
    for (const k of EQUIPMENT_KINDS) {
      expect(PROP_CATALOG[k].planCode).toBeTruthy()
      expect(SET_PROP_KINDS).not.toContain(k)
    }
  })
  it('配置図座標変換: 部屋中心は紙面内、スケールは正、左右/上下が正しい向き', () => {
    const t = makePlanTransform(8, 6)
    expect(t.scale).toBeGreaterThan(0)
    const cx = t.toX(0), cy = t.toY(0)
    expect(cx).toBeGreaterThan(0)
    expect(cy).toBeGreaterThan(0)
    expect(t.toX(4) - t.toX(-4)).toBeCloseTo(8 * t.scale, 5)
    expect(t.toY(3)).toBeGreaterThan(t.toY(-3)) // +Z が紙面下
  })
  it('縦長の部屋でも紙面に収まる', () => {
    const t = makePlanTransform(5, 12)
    const w = t.toX(2.5 + 1) - t.toX(-2.5 - 1)
    expect(w).toBeLessThanOrEqual(1754)
  })
})

describe('V2: ショットリストCSV', () => {
  it('ヘッダー＋ショット行、カンマ・引用符をエスケープ', () => {
    const p = sampleProject()
    const shot: Shot = {
      id: 's1', cameraId: 'cam_a', cameraName: 'CAM A', thumbnail: '',
      shotSize: 'CU', focalLength: 65, moveType: 'Static',
      subjectIds: ['char_maya'], durationSec: 3,
      notes: { action: 'テーブルを叩く, 怒り', camera: '手持ち"風"' },
      poseSnapshot: { a: { position: v3(0, 1.5, 3), lookAt: v3(0, 1.2, 0), roll: 0, focalLength: 65 } },
    }
    p.shots = [shot]
    const csv = shotlistCsv(p)
    const lines = csv.split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('ショット番号')
    expect(lines[1]).toContain('"1A"')
    expect(lines[1]).toContain('"テーブルを叩く, 怒り"')
    expect(lines[1]).toContain('"手持ち""風"""')
    expect(lines[1]).toContain('"Maya"')
  })
})
