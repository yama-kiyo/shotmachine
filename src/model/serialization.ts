import type { Project } from './types'
import { emptyProject } from './defaults'

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2)
}

export function deserializeProject(json: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('JSONの解析に失敗しました。ショットマシンのプロジェクトファイルではありません。')
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('不正なプロジェクトファイルです。')
  const obj = raw as Partial<Project>
  if (obj.version !== 1) throw new Error(`未対応のバージョンです: ${String(obj.version)}`)
  if (!obj.scene || !Array.isArray(obj.scene.characters) || !Array.isArray(obj.scene.cameras)) {
    throw new Error('シーンデータが欠落しています。')
  }
  // 既定値とマージして欠落フィールドを補完
  const base = emptyProject()
  // ショットの防御的検証: 壊れた要素は捨て、巨大サムネイルはメモリ保護のため除去
  const MAX_THUMB_CHARS = 5_000_000
  const shots = (Array.isArray(obj.shots) ? obj.shots : []).filter((s: unknown) => {
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
    return shot
  })
  return {
    ...base,
    ...obj,
    version: 1,
    scene: { ...base.scene, ...obj.scene },
    shots,
  } as unknown as Project
}
