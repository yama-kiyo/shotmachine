// ショット→AI動画生成用プロンプト変換（Seedance / Veo / Runway）
import type { Shot, Project, Character } from '../model/types'
import { focalToHFovDeg } from './lens'
import { aspectToNumber } from '../model/types'
import { cameraHeightLabel, formatHeightLabel } from './heightLabel'
import { SHOT_SIZE_LABELS_EN } from './framing'
import { eyeY, poseOf, POSE_METRICS } from './poseMetrics'
import { MOVE_LABELS_JA } from './moveClassifier'
import { sideOf } from './axis180'
import { TIME_OF_DAY_PRESETS } from './lighting'
import { colorNameOf } from './colorName'
import { PROP_CATALOG, SET_PROP_KINDS } from '../model/defaults'
import { shotStarts } from './cutTrack'
import { secondsToTC, secondsToFC } from './timecode'

export type PromptEngine = 'seedance' | 'veo' | 'runway'

export interface ShotPromptJson {
  shot_number: string
  shot_size: string
  lens: string
  camera_height: string
  camera_movement: string
  duration_sec: number
  timecode_in: string // タイムライン絶対時刻 mm:ss+ff（24fps）
  timecode_out: string
  duration_tc: string // 尺 s+ff（24fps）
  subjects: Array<{ name: string; blocking: string }>
  scene: string
  time_of_day: string // 時間帯の照明記述（英語）
  set_dressing: string // 色名つきの美術リスト（英語）
  aspect_ratio: string
  action_notes: string
  camera_notes: string
  reference_frame?: string // スタートフレーム書き出し時に付与（IN点PNGのZIP内ファイル名）
  reference_frame_out?: string // ムーブありカットのOUT点PNG（あれば）
}

// プロップ種別の英語名（プロンプト用）
const PROP_KIND_EN: Record<string, string> = {
  cube: 'box', table: 'table', chair: 'chair', sofa: 'sofa', bed: 'bed',
  counter: 'counter', sink: 'sink', desk: 'desk', shelf: 'shelf',
  lamp: 'floor lamp', light: 'practical light', door: 'door', window: 'window',
  wall: 'wall', plant: 'potted plant', tv: 'TV screen', rug: 'rug',
}

// シーンの美術を「色名 + 英語名」で列挙（AI動画生成に色で伝える。撮影機材は除外）
// 同色・同種は「2x brown chair」のように集約して冗長さを抑える
export function setDressingText(project: Project, max = 8): string {
  const setKinds = new Set<string>(SET_PROP_KINDS)
  const counts = new Map<string, number>()
  for (const p of project.scene.props) {
    if (!setKinds.has(p.kind)) continue
    const key = `${colorNameOf(p.color ?? PROP_CATALOG[p.kind].color)} ${PROP_KIND_EN[p.kind] ?? p.kind}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .slice(0, max)
    .map(([key, n]) => (n > 1 ? `${n}x ${key}` : key))
    .join(', ')
}

const POSE_EN: Record<string, string> = {
  stand: 'standing', sit: 'seated', crouch: 'crouching', lie: 'lying down',
}

function subjectBlocking(shot: Shot, char: Character): string {
  const pose = shot.poseSnapshot.a
  const s = sideOf(pose.position, pose.lookAt, char.position)
  // sideOf の +1 は「カメラのスクリーン右方向 r=(-dz,0,dx) との内積が正」＝画面右。
  // 旧実装は左右を逆に割り当てており、Seedance生成で立ち位置が反転していた（2026-07-04 監督報告で修正）
  const side = s === 0 ? 'center' : s === 1 ? 'frame right' : 'frame left'
  const p = poseOf(char)
  return p === 'stand' ? side : `${side}, ${POSE_EN[p]}`
}

function movementText(shot: Shot): string {
  if (shot.moveType === 'Static' || !shot.poseSnapshot.b) return 'static camera, locked off'
  const en: Record<string, string> = {
    Pan: 'camera pans', Tilt: 'camera tilts',
    'Push-in': 'slow push-in toward the subject', 'Pull-out': 'slow pull-out away from the subject',
    'Truck L': 'camera trucks left', 'Truck R': 'camera trucks right',
    'Pedestal Up': 'camera rises (pedestal up)', 'Pedestal Down': 'camera lowers (pedestal down)',
    Arc: 'camera arcs around the subject', Zoom: 'lens zooms', Compound: 'compound camera move',
  }
  return `${en[shot.moveType] ?? shot.moveType} over ${shot.durationSec}s`
}

export function shotNumber(index: number): string {
  // 1A, 1B, ... 1Z, 1AA...
  let n = index, label = ''
  do { label = String.fromCharCode(65 + (n % 26)) + label; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return `1${label}`
}

export function shotToPromptJson(shot: Shot, project: Project, index: number): ShotPromptJson {
  const ar = aspectToNumber(project.aspect)
  const pose = shot.poseSnapshot.a
  const chars = project.scene.characters.filter((c) => shot.subjectIds.includes(c.id))
  const subjectEyeY = chars[0] ? eyeY(chars[0]) : undefined
  const inSec = shotStarts(project.shots)[index] ?? 0
  return {
    shot_number: shotNumber(index),
    shot_size: shot.shotSize ? SHOT_SIZE_LABELS_EN[shot.shotSize] : 'custom framing',
    lens: `${Math.round(pose.focalLength)}mm (${focalToHFovDeg(pose.focalLength, ar).toFixed(0)}° hFOV, full-frame)`,
    camera_height: formatHeightLabel(cameraHeightLabel(pose, subjectEyeY)),
    camera_movement: movementText(shot),
    duration_sec: shot.durationSec,
    timecode_in: secondsToTC(inSec),
    timecode_out: secondsToTC(inSec + shot.durationSec),
    duration_tc: secondsToFC(shot.durationSec),
    subjects: chars.map((c) => ({ name: c.name, blocking: subjectBlocking(shot, c) })),
    scene: project.slugline || 'INT. SCENE',
    time_of_day: TIME_OF_DAY_PRESETS[project.scene.timeOfDay ?? 'day'].promptEn,
    set_dressing: setDressingText(project),
    aspect_ratio: project.aspect,
    action_notes: shot.notes.action,
    camera_notes: shot.notes.camera,
  }
}

export function shotToPromptText(
  shot: Shot, project: Project, index: number, engine: PromptEngine,
): string {
  const j = shotToPromptJson(shot, project, index)
  const subjects = j.subjects.length
    ? j.subjects.map((s) => `${s.name} (${s.blocking})`).join(', ')
    : 'empty scene'
  const action = j.action_notes ? ` ${j.action_notes}.` : ''
  const camNotes = j.camera_notes ? ` ${j.camera_notes}.` : ''
  const dressing = j.set_dressing ? ` Set: ${j.set_dressing}.` : ''
  switch (engine) {
    case 'seedance':
      return (
        `${j.scene}, ${j.time_of_day}. ${j.shot_size} of ${subjects}, shot on a ${j.lens} lens, ` +
        `${j.camera_height} camera. ${j.camera_movement}.${action}${camNotes}${dressing} ` +
        `Cinematic lighting, photorealistic, ${j.aspect_ratio}.`
      )
    case 'veo':
      return (
        `Cinematic ${j.shot_size}. Scene: ${j.scene}, ${j.time_of_day}. Subjects: ${subjects}. ` +
        `Lens: ${j.lens}. Camera: ${j.camera_height}, ${j.camera_movement}.` +
        `${action}${camNotes}${dressing} Duration ${j.duration_sec} seconds, aspect ${j.aspect_ratio}.`
      )
    case 'runway':
      return (
        `${j.camera_movement}; ${j.shot_size}; ${j.lens}; ${j.camera_height}. ` +
        `${j.scene}, ${j.time_of_day} — ${subjects}.${action}${camNotes}${dressing}`
      )
  }
}

export function allShotsPromptExport(project: Project): string {
  const lines: string[] = [`# ${project.name} — AI生成プロンプト一覧`, '']
  const starts = shotStarts(project.shots)
  project.shots.forEach((shot, i) => {
    const tc = `IN ${secondsToTC(starts[i])} → OUT ${secondsToTC(starts[i] + shot.durationSec)} / 尺 ${secondsToFC(shot.durationSec)}`
    lines.push(`## Shot ${shotNumber(i)} (${shot.cameraName}, ${shot.moveType} / ${MOVE_LABELS_JA[shot.moveType]}, ${tc})`)
    lines.push('')
    lines.push(`- **Seedance**: ${shotToPromptText(shot, project, i, 'seedance')}`)
    lines.push(`- **Veo**: ${shotToPromptText(shot, project, i, 'veo')}`)
    lines.push(`- **Runway**: ${shotToPromptText(shot, project, i, 'runway')}`)
    lines.push('')
    lines.push('```json')
    lines.push(JSON.stringify(shotToPromptJson(shot, project, i), null, 2))
    lines.push('```')
    lines.push('')
  })
  return lines.join('\n')
}
