// ショット→AI動画生成用プロンプト変換（Seedance / Veo / Runway）
import type { Shot, Project, Character } from '../model/types'
import { focalToHFovDeg } from './lens'
import { aspectToNumber } from '../model/types'
import { cameraHeightLabel, formatHeightLabel } from './heightLabel'
import { SHOT_SIZE_LABELS_EN } from './framing'
import { eyeY, poseOf, POSE_METRICS } from './poseMetrics'
import { MOVE_LABELS_JA } from './moveClassifier'
import { sideOf } from './axis180'

export type PromptEngine = 'seedance' | 'veo' | 'runway'

export interface ShotPromptJson {
  shot_number: string
  shot_size: string
  lens: string
  camera_height: string
  camera_movement: string
  duration_sec: number
  subjects: Array<{ name: string; blocking: string }>
  scene: string
  aspect_ratio: string
  action_notes: string
  camera_notes: string
}

const POSE_EN: Record<string, string> = {
  stand: 'standing', sit: 'seated', crouch: 'crouching', lie: 'lying down',
}

function subjectBlocking(shot: Shot, char: Character): string {
  const pose = shot.poseSnapshot.a
  const s = sideOf(pose.position, pose.lookAt, char.position)
  const side = s === 0 ? 'center' : s === 1 ? 'frame left' : 'frame right'
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
  return {
    shot_number: shotNumber(index),
    shot_size: shot.shotSize ? SHOT_SIZE_LABELS_EN[shot.shotSize] : 'custom framing',
    lens: `${Math.round(pose.focalLength)}mm (${focalToHFovDeg(pose.focalLength, ar).toFixed(0)}° hFOV, full-frame)`,
    camera_height: formatHeightLabel(cameraHeightLabel(pose, subjectEyeY)),
    camera_movement: movementText(shot),
    duration_sec: shot.durationSec,
    subjects: chars.map((c) => ({ name: c.name, blocking: subjectBlocking(shot, c) })),
    scene: project.slugline || 'INT. SCENE',
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
  switch (engine) {
    case 'seedance':
      return (
        `${j.scene}. ${j.shot_size} of ${subjects}, shot on a ${j.lens} lens, ` +
        `${j.camera_height} camera. ${j.camera_movement}.${action}${camNotes} ` +
        `Cinematic lighting, photorealistic, ${j.aspect_ratio}.`
      )
    case 'veo':
      return (
        `Cinematic ${j.shot_size}. Scene: ${j.scene}. Subjects: ${subjects}. ` +
        `Lens: ${j.lens}. Camera: ${j.camera_height}, ${j.camera_movement}.` +
        `${action}${camNotes} Duration ${j.duration_sec} seconds, aspect ${j.aspect_ratio}.`
      )
    case 'runway':
      return (
        `${j.camera_movement}; ${j.shot_size}; ${j.lens}; ${j.camera_height}. ` +
        `${j.scene} — ${subjects}.${action}${camNotes}`
      )
  }
}

export function allShotsPromptExport(project: Project): string {
  const lines: string[] = [`# ${project.name} — AI生成プロンプト一覧`, '']
  project.shots.forEach((shot, i) => {
    lines.push(`## Shot ${shotNumber(i)} (${shot.cameraName}, ${shot.moveType} / ${MOVE_LABELS_JA[shot.moveType]})`)
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
