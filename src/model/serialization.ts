import type { Project, Shot, DialogueClip, Alignment } from './types'
import { emptyProject, genId } from './defaults'
import { shotStarts, roundTime } from '../core/cutTrack'

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2)
}

const MAX_AUDIO_CHARS = 5_000_000

// v1 カットが持っていた旧 dialogue の形（現行 Shot 型からは削除済み。移設のためだけに読む）
interface LegacyDialogue {
  speaker: string | null
  text?: string
  emotion?: string
  voiceId?: string
  audio?: string
  alignment?: Alignment
}

// v1 の shot['dialogue'] を audioTrack の DialogueClip へ移設する。
// startSec はカット累積開始、durationSec は alignment 最終値（実音声尺）優先・なければカット尺。
// speaker:null のト書きも「音声なしテキストクリップ」として移設する。
// 移設後、shot からは dialogue を落とし、source と（scriptカットには）clipId を付与する。
function migrateV1toV2(shots: Shot[]): { shots: Shot[]; audioTrack: DialogueClip[] } {
  const starts = shotStarts(shots)
  const audioTrack: DialogueClip[] = []
  const outShots = shots.map((shot, i) => {
    const rec = shot as unknown as Record<string, unknown>
    const dlg = rec['dialogue'] as LegacyDialogue | undefined
    const rest = { ...rec }
    delete rest['dialogue'] // shot には残さない
    const base = rest as unknown as Shot
    if (!dlg) return { ...base, source: 'capture' as const }
    const ends = dlg.alignment?.ends
    const durationSec = Array.isArray(ends) && ends.length > 0 ? Number(ends[ends.length - 1]) : shot.durationSec
    const clip: DialogueClip = {
      id: genId('clip'),
      speaker: dlg.speaker ?? null,
      text: dlg.text ?? '',
      emotion: dlg.emotion,
      voiceId: dlg.voiceId,
      audio: dlg.audio,
      alignment: dlg.alignment,
      startSec: roundTime(starts[i]),
      durationSec: roundTime(durationSec > 0 ? durationSec : shot.durationSec),
    }
    audioTrack.push(clip)
    return { ...base, source: 'script' as const, clipId: clip.id }
  })
  return { shots: outShots, audioTrack }
}

// v2 読込時の audioTrack 防御的検証: 壊れた要素は捨て、巨大 audio 文字列はメモリ保護のため除去。
function validateAudioTrack(raw: unknown): DialogueClip[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .filter((c) => typeof c.startSec === 'number' && typeof c.durationSec === 'number' && (c.durationSec as number) > 0)
    .map((c) => {
      const clip = { ...c } as Record<string, unknown>
      if (typeof clip.id !== 'string') clip.id = genId('clip')
      if (typeof clip.text !== 'string') clip.text = ''
      if (clip.speaker !== null && typeof clip.speaker !== 'string') clip.speaker = null
      if (typeof clip.audio === 'string' && clip.audio.length > MAX_AUDIO_CHARS) clip.audio = undefined
      clip.startSec = roundTime(Math.max(0, clip.startSec as number))
      clip.durationSec = roundTime(clip.durationSec as number)
      return clip as unknown as DialogueClip
    })
}

export function deserializeProject(json: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('JSONの解析に失敗しました。ショットマシンのプロジェクトファイルではありません。')
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('不正なプロジェクトファイルです。')
  const obj = raw as Omit<Partial<Project>, 'version'> & { version?: number; audioTrack?: unknown }
  const version = obj.version
  if (version !== 1 && version !== 2) throw new Error(`未対応のバージョンです: ${String(version)}`)
  if (!obj.scene || !Array.isArray(obj.scene.characters) || !Array.isArray(obj.scene.cameras)) {
    throw new Error('シーンデータが欠落しています。')
  }
  const base = emptyProject()
  // ショットの防御的検証: 壊れた要素は捨て、巨大サムネイルはメモリ保護のため除去（v1/v2 共通）
  const MAX_THUMB_CHARS = 5_000_000
  const validShots = (Array.isArray(obj.shots) ? obj.shots : []).filter((s: unknown) => {
    if (typeof s !== 'object' || s === null) return false
    const shot = s as Record<string, unknown>
    const snap = shot.poseSnapshot as Record<string, unknown> | undefined
    return !!snap && typeof snap.a === 'object' && snap.a !== null
  }).map((s) => {
    const shot = { ...(s as object) } as Record<string, unknown>
    if (typeof shot.thumbnail !== 'string' || shot.thumbnail.length > MAX_THUMB_CHARS) shot.thumbnail = ''
    if (typeof shot.thumbnailB === 'string' && shot.thumbnailB.length > MAX_THUMB_CHARS) shot.thumbnailB = undefined
    if (typeof shot.durationSec !== 'number' || !(shot.durationSec > 0)) shot.durationSec = 3
    if (typeof shot.focalLength !== 'number' || !(shot.focalLength >= 5)) shot.focalLength = 35
    if (typeof shot.notes !== 'object' || shot.notes === null) shot.notes = { action: '', camera: '' }
    if (!Array.isArray(shot.subjectIds)) shot.subjectIds = []
    return shot as unknown as Shot
  })

  let shots: Shot[]
  let audioTrack: DialogueClip[]
  if (version === 1) {
    const migrated = migrateV1toV2(validShots)
    shots = migrated.shots
    audioTrack = migrated.audioTrack
  } else {
    shots = validShots
    audioTrack = validateAudioTrack(obj.audioTrack)
  }

  return {
    ...base,
    ...obj,
    version: 2,
    scene: { ...base.scene, ...obj.scene },
    shots,
    audioTrack,
  } as unknown as Project
}
