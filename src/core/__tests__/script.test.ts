import { describe, it, expect } from 'vitest'
import { parseScript, uniqueSpeakers, estimateDurationSec } from '../scriptParser'
import { buildCutscene, arrangeSpeakers, scoreCameraPosition } from '../sceneBuilder'
import { checkCameraSide } from '../axis180'
import { distanceXZ } from '../math'
import type { RoomSpec } from '../../model/types'

const ROOM: RoomSpec = { width: 8, depth: 6, wallHeight: 2.6, showBackWall: true, showSideWall: true }

const SAMPLE = `# キッチンの口論
ミサキ「ご機嫌よう、ソウタ」
ソウタ「今日はついてない。話しかけるな」
ミサキ（怒り）「いい加減にして」
ソウタ: そうよ 近くにいい店があるようだが
二人は黙って見つめ合う。
ミサキ「行きましょう」
ソウタ「ああ」
ミサキ「ふふ」
`

describe('台本パーサ', () => {
  it('「」形式・コロン形式・感情注記・ト書き・コメントを解析', () => {
    const lines = parseScript(SAMPLE)
    expect(lines).toHaveLength(8) // コメント1行は除外
    expect(lines[0]).toEqual({ speaker: 'ミサキ', text: 'ご機嫌よう、ソウタ', emotion: undefined })
    expect(lines[2].emotion).toBe('怒り')
    expect(lines[3]).toMatchObject({ speaker: 'ソウタ', text: 'そうよ 近くにいい店があるようだが' })
    expect(lines[4]).toMatchObject({ speaker: null, text: '二人は黙って見つめ合う。' })
  })
  it('話者一覧は登場順・重複なし', () => {
    expect(uniqueSpeakers(parseScript(SAMPLE))).toEqual(['ミサキ', 'ソウタ'])
  })
  it('尺推定: 長文ほど長く、下限1.6秒', () => {
    expect(estimateDurationSec('ああ')).toBeGreaterThanOrEqual(1.6)
    expect(estimateDurationSec('これはとても長いセリフでたっぷり時間がかかるはずです')).toBeGreaterThan(3)
  })
})

describe('自動カット割り', () => {
  const lines = parseScript(SAMPLE)
  const plan = buildCutscene(lines, [], 16 / 9)

  it('話者2人が対面配置で新規作成される', () => {
    expect(plan.characters).toHaveLength(2)
    const [e, l] = plan.characters
    expect(distanceXZ(e.position, l.position)).toBeCloseTo(1.8, 1)
  })

  it('冒頭はマスター（2-SHOT）、以降は話者の切り返し', () => {
    expect(plan.shots[0].shotSize).toBe('2-SHOT')
    expect(plan.shots[0].cameraName).toBe('MASTER')
    // 2行目はソウタの初登場 → OTS
    expect(plan.shots[1].shotSize).toBe('OTS')
    expect(plan.shots[1].speakerName).toBe('ソウタ')
  })

  it('ト書きはマスターに戻る', () => {
    const togaki = plan.shots.find((s) => s.text.includes('見つめ合う'))
    expect(togaki?.cameraName).toBe('MASTER')
  })

  it('全カメラがアクション軸の正サイド', () => {
    expect(plan.axis).toBeDefined()
    const a = plan.characters.find((c) => c.name === plan.axis!.aName)!
    const b = plan.characters.find((c) => c.name === plan.axis!.bName)!
    for (const cam of plan.cameras) {
      expect(
        checkCameraSide(a.position, b.position, plan.axis!.lockedSide, cam.pose.position),
        `${cam.name} がライン違反`,
      ).not.toBe('crossed')
    }
  })

  it('カメラは設定ごとに再利用される（カット数より少ない）', () => {
    expect(plan.shots.length).toBe(8)
    expect(plan.cameras.length).toBeLessThan(plan.shots.length)
    expect(plan.cameras.map((c) => c.name)).toContain('MASTER')
  })

  it('全セリフカットに話者とテキストが載る', () => {
    for (const s of plan.shots) {
      expect(s.text.length).toBeGreaterThan(0)
      expect(s.durationSec).toBeGreaterThanOrEqual(1.6)
    }
  })

  it('3人以上は弧状配置で中心を向く', () => {
    const chars = arrangeSpeakers(['A', 'B', 'C', 'D'], [])
    expect(chars).toHaveLength(4)
    for (const c of chars) {
      expect(distanceXZ(c.position, { x: 0, y: 0, z: 0 })).toBeGreaterThan(1)
    }
  })
})

describe('カメラ配置の部屋考慮（壁の裏に置かない）', () => {
  it('奥壁(-Z)・横壁(-X)のある部屋では、マスターは開いている+Z側に置かれる', () => {
    const plan = buildCutscene(parseScript(SAMPLE), [], 16 / 9, ROOM)
    const master = plan.cameras.find((c) => c.name === 'MASTER')!
    expect(master.pose.position.z).toBeGreaterThan(0) // 奥壁の裏(-Z)ではない
    expect(Math.abs(master.pose.position.z)).toBeLessThan(ROOM.depth / 2 + 1.5)
  })
  it('全カメラが奥壁の裏に出ない', () => {
    const plan = buildCutscene(parseScript(SAMPLE), [], 16 / 9, ROOM)
    for (const cam of plan.cameras) {
      expect(cam.pose.position.z, `${cam.name} が奥壁の裏`).toBeGreaterThan(-ROOM.depth / 2)
    }
  })
  it('部屋情報なしでも+Z側を選ぶ（従来動作の改善）', () => {
    const plan = buildCutscene(parseScript(SAMPLE), [], 16 / 9)
    const master = plan.cameras.find((c) => c.name === 'MASTER')!
    expect(master.pose.position.z).toBeGreaterThan(0)
  })
  it('scoreCameraPosition: 部屋内＞部屋外、+Z側＞-Z側', () => {
    expect(scoreCameraPosition({ x: 0, y: 1.5, z: 2 }, ROOM))
      .toBeGreaterThan(scoreCameraPosition({ x: 0, y: 1.5, z: -4 }, ROOM))
    expect(scoreCameraPosition({ x: 0, y: 1.5, z: 2 }, ROOM))
      .toBeGreaterThan(scoreCameraPosition({ x: 0, y: 1.5, z: -2 }, ROOM))
  })
  it('壁を+Z側へ移動した場合も「実際の壁の裏」を減点する（backWallZ=+1）', () => {
    const moved: RoomSpec = { ...ROOM, backWallZ: 1 }
    // 被写体は原点付近 → 壁(z=1)より奥(z=2)は裏、手前(z=-1)が正
    expect(scoreCameraPosition({ x: 0, y: 1.5, z: -1 }, moved))
      .toBeGreaterThan(scoreCameraPosition({ x: 0, y: 1.5, z: 2 }, moved))
  })
})
