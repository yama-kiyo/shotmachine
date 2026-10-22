import type { Project, Shot, DialogueClip, Alignment, CameraKeyframe } from './types'
import { emptyProject, genId, PROP_CATALOG } from './defaults'
import {
  MAX_PROJECT_FILE_BYTES, LIMITS, STR_LIMITS, TIME_LIMITS, clampTime, clampDuration, safeJsonParse, isPlainObject, isSafeImageDataUrl, isSafeAudioDataUrl,
  isValidVoiceId, sanitizeScene, sanitizeTopLevel, sanitizeShotFields, sanitizeAlignment, capArray, capStr,
  newReport, type SanitizeReport,
} from './sanitize'
import { shotStarts, roundTime } from '../core/cutTrack'
import { normalizeCamKeys } from '../core/cameraTrack'

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2)
}

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
      startSec: roundTime(clampTime(starts[i], TIME_LIMITS.timelineSec, 0)),
      durationSec: roundTime(clampDuration(durationSec, TIME_LIMITS.perItemSec, shot.durationSec)),
    }
    audioTrack.push(clip)
    return { ...base, source: 'script' as const, clipId: clip.id }
  })
  return { shots: outShots, audioTrack }
}

// クリップの URL/パスに入りうる値（voiceId・audio）と型の検証（v1 移設分・v2 読込分の共通処理）
// voiceId は ElevenLabs の URL パスに入るため英数字のみ、audio は audio の base64 dataURL のみ許可
function sanitizeClipFields(clip: Record<string, unknown>): void {
  if (typeof clip.id !== 'string') clip.id = genId('clip')
  clip.id = capStr(clip.id, STR_LIMITS.id)
  clip.text = capStr(clip.text, STR_LIMITS.clipText)
  clip.speaker = typeof clip.speaker === 'string' ? capStr(clip.speaker, STR_LIMITS.speaker) : null
  if (clip.voiceId !== undefined && !isValidVoiceId(clip.voiceId)) clip.voiceId = undefined
  if (clip.audio !== undefined && !isSafeAudioDataUrl(clip.audio)) clip.audio = undefined
  if (clip.emotion !== undefined) clip.emotion = typeof clip.emotion === 'string' ? capStr(clip.emotion, STR_LIMITS.emotion) : undefined
  // alignment.chars は描画・リップシンクで文字列メソッドに渡る。要素の型と長さを揃える
  if (clip.alignment !== undefined) clip.alignment = sanitizeAlignment(clip.alignment)
  // 時刻: NaN・Infinity・負は既定値、巨大値は上限で丸める（roundTime の ×100 で Infinity にしない）
  clip.startSec = roundTime(clampTime(clip.startSec, TIME_LIMITS.timelineSec, 0))
  clip.durationSec = roundTime(clampDuration(clip.durationSec, TIME_LIMITS.perItemSec, 1))
}

// v2 読込時の audioTrack 防御的検証: 壊れた要素は捨て、不正・巨大な audio 文字列は除去。
function validateAudioTrack(raw: unknown, report: SanitizeReport): DialogueClip[] {
  if (!Array.isArray(raw)) return []
  const valid = raw
    .filter((c): c is Record<string, unknown> => isPlainObject(c))
    .filter((c) => Number.isFinite(c.startSec) && Number.isFinite(c.durationSec) && (c.durationSec as number) > 0)
  return capArray(valid, LIMITS.audioClips, '音声クリップ', report)
    .map((c) => {
      const clip = { ...c } as Record<string, unknown>
      sanitizeClipFields(clip)
      return clip as unknown as DialogueClip
    })
}

export function deserializeProject(json: string): Project {
  return deserializeProjectWithReport(json).project
}

// 読込＋検証。切り捨て・補正した内容を warnings で返す（UI でトースト表示する）
export function deserializeProjectWithReport(json: string): { project: Project; warnings: string[] } {
  const report = newReport()
  // 巨大ファイルはパース前に拒否（文字数ベース。UTF-16 1文字≥1バイトなので上限バイト数で十分）
  if (json.length > MAX_PROJECT_FILE_BYTES) {
    throw new Error(`プロジェクトファイルが大きすぎます（上限 ${MAX_PROJECT_FILE_BYTES / 1024 / 1024}MB）。`)
  }
  let raw: unknown
  try {
    // __proto__ / constructor / prototype キーは全階層で除去（プロトタイプ汚染対策）
    raw = safeJsonParse(json)
  } catch {
    throw new Error('JSONの解析に失敗しました。ショットマシンのプロジェクトファイルではありません。')
  }
  if (!isPlainObject(raw)) throw new Error('不正なプロジェクトファイルです。')
  const version = raw.version
  if (version !== 1 && version !== 2) throw new Error(`未対応のバージョンです: ${String(version)}`)
  const rawScene = raw.scene
  if (!isPlainObject(rawScene) || !Array.isArray(rawScene.characters) || !Array.isArray(rawScene.cameras)) {
    throw new Error('シーンデータが欠落しています。')
  }
  const base = emptyProject()
  const obj = sanitizeTopLevel(raw, base as unknown as Record<string, unknown>, report) as
    Omit<Partial<Project>, 'version'> & { version?: number; audioTrack?: unknown }
  const scene = sanitizeScene(
    rawScene, base.scene.room as unknown as Record<string, unknown>, new Set(Object.keys(PROP_CATALOG)), report,
  )
  // ショットの防御的検証: 壊れた要素は捨て、不正・巨大サムネイルは除去（v1/v2 共通）
  // サムネイルは img src に入るため、アプリが生成する base64 画像 dataURL 以外（外部URL等）は捨てる
  // 列挙値（moveType 等）・文字列長・ポーズの型は sanitizeShotFields で正規化（描画で落ちないように）
  const rawShots = (Array.isArray(obj.shots) ? obj.shots : []) as unknown[]
  const shotObjs = rawShots.filter(isPlainObject)
    .map((s) => sanitizeShotFields(s))
    .filter((s): s is Record<string, unknown> => s !== null)
  // カット尺の合計も上限（タイムライン長）。超えたら以降のカットを切り捨てて通知
  let acc = 0
  const withinTotal = shotObjs.filter((s) => (acc += s.durationSec as number) <= TIME_LIMITS.timelineSec)
  if (withinTotal.length < shotObjs.length) {
    report.warnings.push(`カット尺の合計が${TIME_LIMITS.timelineSec / 3600}時間を超えるため、先頭${withinTotal.length}カットのみ読み込みました`)
  }
  const validShots = capArray(withinTotal, LIMITS.shots, 'カット', report).map((shot) => {
    if (!isSafeImageDataUrl(shot.thumbnail)) shot.thumbnail = ''
    if (shot.thumbnailB !== undefined && !isSafeImageDataUrl(shot.thumbnailB)) shot.thumbnailB = undefined
    // カメラKF: 壊れた要素は捨て、tSec昇順へ正規化。空になったらフィールドごと落とす
    // （camKeys なし＝従来のA/Bムーブ評価、という優先順位に自然に戻る）
    if (Array.isArray(shot.camKeys)) {
      const keys = normalizeCamKeys(shot.camKeys as CameraKeyframe[])
      shot.camKeys = keys.length ? keys : undefined
    } else if (shot.camKeys !== undefined) {
      shot.camKeys = undefined
    }
    return shot as unknown as Shot
  })

  let shots: Shot[]
  let audioTrack: DialogueClip[]
  if (version === 1) {
    const migrated = migrateV1toV2(validShots)
    shots = migrated.shots
    audioTrack = migrated.audioTrack
    audioTrack.forEach((c) => sanitizeClipFields(c as unknown as Record<string, unknown>))
  } else {
    shots = validShots
    audioTrack = validateAudioTrack(obj.audioTrack, report)
  }

  const project = {
    ...base,
    ...obj,
    version: 2,
    scene: { ...base.scene, ...scene },
    shots,
    audioTrack,
  } as unknown as Project

  // カメラのフレーミング対象: 存在しないキャラを指していたらフリーへ落とす
  const charIds = new Set(project.scene.characters.map((c) => c.id))
  for (const cam of project.scene.cameras) {
    if (cam.frameTargetId && !charIds.has(cam.frameTargetId)) cam.frameTargetId = null
  }
  return { project, warnings: report.warnings }
}
