import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serializeProject, deserializeProject } from '../serialization'
import { shotStarts, roundTime } from '../../core/cutTrack'
import { emptyProject } from '../defaults'
import type { Shot, Alignment } from '../types'

// fixtures/ 配下は test/TEST.shotmachine.json の音声base64を除去したサニタイズ版
// （test/ はkiyoボイス素材等のためgitignore対象。CIでも読めるようsrc内に置く）
const fixtureRaw = readFileSync(resolve(__dirname, 'fixtures/TEST.v1.shotmachine.json'), 'utf8')

// v1 フィクスチャの旧 dialogue 形（現行 Shot 型からは削除済み。ブラケットで読む）
type RawShot = Shot & { dialogue?: { speaker: string | null; alignment?: Alignment } }
const rawShots = (): RawShot[] => (JSON.parse(fixtureRaw) as { shots: RawShot[] }).shots
const hasDlg = (s: RawShot): boolean => !!s['dialogue']

describe('マイグレーション v1 → v2', () => {
  it('version 2 に変換され audioTrack が生成される', () => {
    const dialogueCount = rawShots().filter(hasDlg).length
    const p = deserializeProject(fixtureRaw)
    expect(p.version).toBe(2)
    expect(p.audioTrack).toHaveLength(dialogueCount)
  })

  it('clip の startSec がカット累積開始に一致する', () => {
    const raw = rawShots()
    const starts = shotStarts(raw)
    const p = deserializeProject(fixtureRaw)
    // audioTrack は dialogue 付きカット順に生成される
    const dialogueStarts = raw
      .map((s, i) => (hasDlg(s) ? starts[i] : null))
      .filter((x): x is number => x !== null)
    expect(p.audioTrack.map((c) => c.startSec)).toEqual(dialogueStarts.map(roundTime))
  })

  it('clip の durationSec は alignment 最終値優先', () => {
    const firstDlg = rawShots().find(hasDlg)!
    const expected = roundTime(firstDlg['dialogue']!.alignment!.ends.at(-1)!)
    const p = deserializeProject(fixtureRaw)
    expect(p.audioTrack[0].durationSec).toBe(expected)
  })

  it('source が付与される（dialogue=script / なし=capture）', () => {
    const raw = rawShots()
    const p = deserializeProject(fixtureRaw)
    p.shots.forEach((s, i) => {
      expect(s.source).toBe(hasDlg(raw[i]) ? 'script' : 'capture')
    })
  })

  it('shot から dialogue は落ちて clipId が張られ、audioTrack のクリップに対応する', () => {
    const p = deserializeProject(fixtureRaw)
    const scriptShots = p.shots.filter((s) => s.source === 'script')
    expect(scriptShots.length).toBeGreaterThan(0)
    const clipIds = new Set(p.audioTrack.map((c) => c.id))
    for (const s of scriptShots) {
      expect((s as unknown as Record<string, unknown>)['dialogue']).toBeUndefined()
      expect(s.clipId).toBeDefined()
      expect(clipIds.has(s.clipId!)).toBe(true)
    }
    // capture カットには clipId が付かない
    for (const s of p.shots.filter((s) => s.source === 'capture')) {
      expect(s.clipId).toBeUndefined()
    }
  })

  it('ト書き（speaker:null）も音声なしテキストクリップとして残る想定の防御', () => {
    // フィクスチャに speaker:null が無くても、text クリップは全 dialogue から生成される
    const p = deserializeProject(fixtureRaw)
    expect(p.audioTrack.every((c) => typeof c.text === 'string')).toBe(true)
    expect(p.audioTrack).toHaveLength(rawShots().filter(hasDlg).length)
  })

  it('ラウンドトリップが安定する（v1→v2保存→再読込で deep-equal）', () => {
    const a = deserializeProject(fixtureRaw)
    const b = deserializeProject(serializeProject(a))
    expect(b).toEqual(a)
  })

  it('v2 ファイルは version 2 として保存・再読込できる', () => {
    const a = deserializeProject(fixtureRaw)
    const json = serializeProject(a)
    expect(JSON.parse(json).version).toBe(2)
    expect(deserializeProject(json).version).toBe(2)
  })
})

describe('v2 audioTrack 防御的検証', () => {
  it('壊れた clip を捨て、巨大 audio 文字列を除去する', () => {
    const base = emptyProject()
    const dirty = {
      ...base,
      shots: [],
      audioTrack: [
        { id: 'ok', speaker: null, text: 'a', startSec: 0, durationSec: 1 },
        { id: 'bad-no-dur', speaker: null, text: 'b', startSec: 1 }, // durationSec 欠落 → 捨てる
        { id: 'huge', speaker: null, text: 'c', startSec: 2, durationSec: 1, audio: 'x'.repeat(5_000_001) },
        'not-an-object',
      ],
    }
    const p = deserializeProject(JSON.stringify(dirty))
    const ids = p.audioTrack.map((c) => c.id)
    expect(ids).toContain('ok')
    expect(ids).toContain('huge')
    expect(ids).not.toContain('bad-no-dur')
    const huge = p.audioTrack.find((c) => c.id === 'huge')!
    expect(huge.audio).toBeUndefined()
  })
})
