import { describe, it, expect } from 'vitest'
import { secondsToTimecode } from '../timecode'
import { cameraHeightLabel, formatHeightLabel } from '../heightLabel'
import { lerpPose } from '../interpolate'
import { serializeProject, deserializeProject } from '../../model/serialization'
import { sampleProject } from '../../model/defaults'
import { shotToPromptText, shotToPromptJson, shotNumber } from '../promptGen'
import { v3 } from '../math'
import type { CameraPose, Shot } from '../../model/types'

describe('タイムコード', () => {
  it('14秒 → 0:14、75秒 → 1:15、0秒 → 0:00', () => {
    expect(secondsToTimecode(14)).toBe('0:14')
    expect(secondsToTimecode(75)).toBe('1:15')
    expect(secondsToTimecode(0)).toBe('0:00')
  })
})

describe('高さラベル', () => {
  const eyeY = 1.56
  it('目線高さ・水平 → eye-level · level', () => {
    const pose: CameraPose = { position: v3(0, 1.56, 3), lookAt: v3(0, 1.56, 0), roll: 0, focalLength: 50 }
    expect(formatHeightLabel(cameraHeightLabel(pose, eyeY))).toBe('eye-level · level')
  })
  it('低位置から見上げ → low-angle · tilt up', () => {
    const pose: CameraPose = { position: v3(0, 0.6, 3), lookAt: v3(0, 1.56, 0), roll: 0, focalLength: 50 }
    expect(formatHeightLabel(cameraHeightLabel(pose, eyeY))).toBe('low-angle · tilt up')
  })
  it('高位置から見下ろし → high-angle · tilt down', () => {
    const pose: CameraPose = { position: v3(0, 2.4, 3), lookAt: v3(0, 1.2, 0), roll: 0, focalLength: 50 }
    expect(formatHeightLabel(cameraHeightLabel(pose, eyeY))).toBe('high-angle · tilt down')
  })
})

describe('ポーズ補間', () => {
  const a: CameraPose = { position: v3(0, 1, 4), lookAt: v3(0, 1, 0), roll: 0, focalLength: 35 }
  const b: CameraPose = { position: v3(2, 2, 2), lookAt: v3(1, 1, 0), roll: 10, focalLength: 85 }
  it('t=0でA、t=1でB', () => {
    expect(lerpPose(a, b, 0)).toEqual(a)
    expect(lerpPose(a, b, 1).position).toEqual(b.position)
    expect(lerpPose(a, b, 1).focalLength).toBe(85)
  })
  it('t=0.5は中間（イージングでも対称点）', () => {
    const m = lerpPose(a, b, 0.5)
    expect(m.position.x).toBeCloseTo(1, 5)
    expect(m.focalLength).toBeCloseTo(60, 5)
  })
})

describe('シリアライズ', () => {
  it('save→loadラウンドトリップで一致', () => {
    const p = sampleProject()
    const json = serializeProject(p)
    expect(deserializeProject(json)).toEqual(p)
  })
  it('不正JSONはエラー', () => {
    expect(() => deserializeProject('{oops')).toThrow()
  })
  it('未対応バージョンはエラー', () => {
    expect(() => deserializeProject('{"version":99}')).toThrow(/バージョン/)
  })
})

describe('プロンプト生成', () => {
  const project = sampleProject()
  const shot: Shot = {
    id: 's1', cameraId: 'cam_c', cameraName: 'CAM C',
    thumbnail: '', shotSize: 'CU', focalLength: 65, moveType: 'Push-in',
    subjectIds: ['char_maya'], durationSec: 4,
    notes: { action: 'Maya slams the table', camera: 'handheld feel' },
    poseSnapshot: {
      a: { position: v3(-2.4, 1.45, 1.9), lookAt: v3(-0.9, 1.56, -0.6), roll: 0, focalLength: 65 },
      b: { position: v3(-1.8, 1.45, 1.2), lookAt: v3(-0.9, 1.56, -0.6), roll: 0, focalLength: 65 },
    },
  }

  it('ショット番号: 0→1A, 1→1B, 25→1Z, 26→1AA', () => {
    expect(shotNumber(0)).toBe('1A')
    expect(shotNumber(1)).toBe('1B')
    expect(shotNumber(25)).toBe('1Z')
    expect(shotNumber(26)).toBe('1AA')
  })

  it('JSONにレンズ・サイズ・ムーブ・シーンが入る', () => {
    const j = shotToPromptJson(shot, project, 0)
    expect(j.shot_number).toBe('1A')
    expect(j.shot_size).toBe('close-up')
    expect(j.lens).toContain('65mm')
    expect(j.lens).toContain('31°')
    expect(j.camera_movement).toContain('push-in')
    expect(j.scene).toBe('INT. KITCHEN — NIGHT')
    expect(j.subjects[0].name).toBe('Maya')
  })

  it('3エンジンのテキストテンプレ（スナップショット）', () => {
    expect(shotToPromptText(shot, project, 0, 'seedance')).toMatchSnapshot()
    expect(shotToPromptText(shot, project, 0, 'veo')).toMatchSnapshot()
    expect(shotToPromptText(shot, project, 0, 'runway')).toMatchSnapshot()
  })
})
