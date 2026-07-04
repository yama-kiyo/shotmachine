// Scene Chat 用のtool定義と実行器。ツールはZustandストアのアクションを呼ぶ
import { useStore } from '../state/store'
import type { ShotSize } from '../model/types'
import { focalToHFovDeg } from '../core/lens'
import { aspectToNumber } from '../model/types'

export interface ToolDef {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export const SCENE_TOOLS: ToolDef[] = [
  {
    name: 'get_scene_state',
    description: 'シーンの現在状態（キャラクター、カメラ、軸、ショット数）をJSONで取得する',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_camera',
    description: 'カメラの位置・注視点・焦点距離・ロールを設定する。camera_name省略時は現在のプレビューカメラ',
    input_schema: {
      type: 'object',
      properties: {
        camera_name: { type: 'string', description: '例 "CAM A"' },
        position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
        look_at: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } } },
        focal_length: { type: 'number', description: 'mm（フルフレーム換算）' },
        roll: { type: 'number', description: '度' },
      },
    },
  },
  {
    name: 'adjust_camera',
    description: 'カメラを相対的に動かす（例: もっと低く dy=-0.4）。位置のみ動き注視点は保たれるため、下げると見上げるアングルになる',
    input_schema: {
      type: 'object',
      properties: {
        camera_name: { type: 'string' },
        dx: { type: 'number' }, dy: { type: 'number' }, dz: { type: 'number' },
      },
    },
  },
  {
    name: 'frame_character',
    description: '指定キャラクターを指定ショットサイズで自動フレーミングする',
    input_schema: {
      type: 'object',
      properties: {
        character_name: { type: 'string' },
        shot_size: { type: 'string', enum: ['EWS', 'WS', 'FS', 'MS', 'MCU', 'CU', 'ECU', 'OTS', '2-SHOT', 'POV', 'INS'] },
      },
      required: ['character_name', 'shot_size'],
    },
  },
  {
    name: 'move_character',
    description: 'キャラクターの位置・向きを変更する',
    input_schema: {
      type: 'object',
      properties: {
        character_name: { type: 'string' },
        x: { type: 'number' }, z: { type: 'number' },
        rotation_deg: { type: 'number', description: '視線方向（度）' },
      },
      required: ['character_name'],
    },
  },
  {
    name: 'add_camera',
    description: '新しいカメラを追加する',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_time_of_day',
    description: 'シーンの時間帯（ライティング）を設定する',
    input_schema: {
      type: 'object',
      properties: {
        time: { type: 'string', enum: ['morning', 'day', 'evening', 'night'], description: '朝/昼/夕/夜' },
      },
      required: ['time'],
    },
  },
  {
    name: 'capture_shot',
    description: '現在のプレビューカメラのフレームをショットとしてキャプチャする',
    input_schema: { type: 'object', properties: {} },
  },
]

type ToolInput = Record<string, any>

export function executeTool(name: string, input: ToolInput): string {
  const st = useStore.getState()
  const findCam = (n?: string) =>
    n
      ? st.project.scene.cameras.find((c) => c.name.toLowerCase() === n.toLowerCase())
      : st.project.scene.cameras.find((c) => c.id === st.pipCameraId)
  const findChar = (n: string) =>
    st.project.scene.characters.find((c) => c.name.toLowerCase() === n.toLowerCase())

  switch (name) {
    case 'get_scene_state': {
      const ar = aspectToNumber(st.project.aspect)
      return JSON.stringify({
        project: st.project.name,
        slugline: st.project.slugline,
        aspect: st.project.aspect,
        characters: st.project.scene.characters.map((c) => ({
          name: c.name, position: c.position, rotation_deg: Math.round((c.rotationY * 180) / Math.PI), height: c.height,
        })),
        cameras: st.project.scene.cameras.map((c) => ({
          name: c.name,
          position: c.pose.position,
          look_at: c.pose.lookAt,
          focal_length: c.pose.focalLength,
          hfov_deg: Math.round(focalToHFovDeg(c.pose.focalLength, ar)),
          has_move: !!(c.poseA && c.poseB),
        })),
        axis_of_action: st.project.axis ?? null,
        shots_count: st.project.shots.length,
        preview_camera: st.project.scene.cameras.find((c) => c.id === st.pipCameraId)?.name ?? null,
      })
    }
    case 'set_camera': {
      const cam = findCam(input.camera_name)
      if (!cam) return 'エラー: カメラが見つかりません'
      const patch: any = {}
      if (input.position) patch.position = { ...cam.pose.position, ...input.position }
      if (input.look_at) patch.lookAt = { ...cam.pose.lookAt, ...input.look_at }
      if (typeof input.focal_length === 'number') patch.focalLength = input.focal_length
      if (typeof input.roll === 'number') patch.roll = input.roll
      st.updateCameraPose(cam.id, patch)
      return `${cam.name} を更新しました`
    }
    case 'adjust_camera': {
      const cam = findCam(input.camera_name)
      if (!cam) return 'エラー: カメラが見つかりません'
      st.updateCameraPose(cam.id, {
        position: {
          x: cam.pose.position.x + (input.dx ?? 0),
          y: cam.pose.position.y + (input.dy ?? 0),
          z: cam.pose.position.z + (input.dz ?? 0),
        },
      })
      return `${cam.name} を相対移動しました（新しい高さ ${(cam.pose.position.y + (input.dy ?? 0)).toFixed(2)}m）`
    }
    case 'frame_character': {
      const c = findChar(input.character_name)
      if (!c) return 'エラー: キャラクターが見つかりません'
      st.select({ type: 'character', id: c.id })
      st.frameAs(input.shot_size as ShotSize)
      return `${c.name} を ${input.shot_size} でフレーミングしました`
    }
    case 'move_character': {
      const c = findChar(input.character_name)
      if (!c) return 'エラー: キャラクターが見つかりません'
      const patch: any = {}
      if (typeof input.x === 'number' || typeof input.z === 'number') {
        patch.position = { x: input.x ?? c.position.x, y: 0, z: input.z ?? c.position.z }
      }
      if (typeof input.rotation_deg === 'number') patch.rotationY = (input.rotation_deg * Math.PI) / 180
      st.updateCharacter(c.id, patch)
      return `${c.name} を移動しました`
    }
    case 'add_camera': {
      const cam = st.addCamera()
      return `${cam.name} を追加しました`
    }
    case 'set_time_of_day': {
      const t = input.time as string
      if (!['morning', 'day', 'evening', 'night'].includes(t)) return 'エラー: 不正な時間帯です'
      st.setTimeOfDay(t as 'morning' | 'day' | 'evening' | 'night')
      const label = { morning: '朝', day: '昼', evening: '夕', night: '夜' }[t]
      return `時間帯を「${label}」に設定しました`
    }
    case 'capture_shot': {
      st.captureShot()
      return `ショットをキャプチャしました（合計 ${useStore.getState().project.shots.length} ショット）`
    }
    default:
      return `エラー: 未知のツール ${name}`
  }
}
