import type { Vec3 } from '../core/math'

export type AspectRatio = '16:9' | '2.39:1' | '4:3' | '1:1' | '9:16'

export type ShotSize =
  | 'EWS' | 'WS' | 'FS' | 'MS' | 'MCU' | 'CU' | 'ECU'
  | 'OTS' | '2-SHOT' | 'POV' | 'INS'

export type MoveType =
  | 'Static' | 'Pan' | 'Tilt' | 'Push-in' | 'Pull-out'
  | 'Truck L' | 'Truck R' | 'Pedestal Up' | 'Pedestal Down'
  | 'Arc' | 'Zoom' | 'Compound'

export interface CameraPose {
  position: Vec3
  lookAt: Vec3
  roll: number // 度
  focalLength: number // mm（フルフレーム換算）
}

export interface CameraRig {
  id: string
  name: string // "CAM A"
  pose: CameraPose
  poseA?: CameraPose // ムーブ開始
  poseB?: CameraPose // ムーブ終了
  moveDurationSec: number
}

export type PoseState = 'stand' | 'sit' | 'crouch' | 'lie'
export type BodyType = 'average' | 'broad' | 'slim' | 'child'

export interface Character {
  id: string
  name: string
  color: string
  position: Vec3
  rotationY: number // ラジアン。視線方向 forward = (sin, 0, cos)
  height: number // m。目の高さは姿勢依存（core/poseMetrics）
  poseState?: PoseState // 省略時 'stand'
  bodyType?: BodyType // 省略時 'average'
  pathB?: Vec3 // 移動パス終点（pathsオーバーレイ）
}

export type PropKind =
  // セット・美術
  | 'cube' | 'table' | 'chair' | 'sofa' | 'bed' | 'counter' | 'sink'
  | 'desk' | 'shelf' | 'lamp' | 'light' | 'door' | 'window' | 'wall'
  | 'plant' | 'tv' | 'rug'
  // 撮影機材（V2: 配置図エクスポート対象）
  | 'lightstand' | 'ledpanel' | 'softbox' | 'cstand' | 'flag'
  | 'dolly' | 'dollyrail' | 'tripod' | 'monitor' | 'reflector'

export interface Prop {
  id: string
  kind: PropKind
  name: string
  position: Vec3
  rotationY: number
  scale: Vec3
}

export interface AxisOfAction {
  charAId: string
  charBId: string
  lockedSide: 1 | -1
}

export interface ShotNotes {
  action: string
  camera: string
}

export interface Shot {
  id: string
  cameraId: string
  cameraName: string
  thumbnail: string // JPEG dataURL 640x360
  thumbnailB?: string // ムーブ終了フレーム
  shotSize?: ShotSize
  focalLength: number
  moveType: MoveType
  subjectIds: string[]
  durationSec: number
  notes: ShotNotes
  poseSnapshot: { a: CameraPose; b?: CameraPose } // 凍結ポーズ
}

export interface RoomSpec {
  width: number // X方向
  depth: number // Z方向
  wallHeight: number
  showBackWall: boolean
  showSideWall: boolean
}

export interface SceneData {
  room: RoomSpec
  characters: Character[]
  props: Prop[]
  cameras: CameraRig[]
}

export interface Project {
  version: 1
  name: string
  slugline: string
  aspect: AspectRatio
  scene: SceneData
  axis?: AxisOfAction
  shots: Shot[]
}

export const aspectToNumber = (a: AspectRatio): number => {
  switch (a) {
    case '16:9': return 16 / 9
    case '2.39:1': return 2.39
    case '4:3': return 4 / 3
    case '1:1': return 1
    case '9:16': return 9 / 16
  }
}
