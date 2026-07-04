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
// 腕のポーズプリセット（VRMモデル時に有効）
export type ArmPose = 'natural' | 'hands_on_hips' | 'crossed' | 'wave' | 'point' | 'tpose'

// キャラクターのキーフレーム（アニマティック時間軸上）。位置・向きは補間、姿勢・腕はステップ切替
export interface CharKeyframe {
  time: number // アニマティック先頭からの秒
  position: Vec3
  rotationY: number
  poseState: PoseState
  armPose: ArmPose
}

export interface Character {
  id: string
  name: string
  color: string
  position: Vec3
  rotationY: number // ラジアン。視線方向 forward = (sin, 0, cos)
  height: number // m。目の高さは姿勢依存（core/poseMetrics）
  poseState?: PoseState // 省略時 'stand'
  armPose?: ArmPose // 省略時 'natural'（VRM時のみ有効）
  bodyType?: BodyType // 省略時 'average'
  pathB?: Vec3 // 移動パス終点（pathsオーバーレイ）
  vrmFileName?: string // VRM読込済み表示用（実体はランタイム保持・保存対象外）
  keyframes?: CharKeyframe[] // time昇順。再生・スクラブ時に評価される
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
  color?: string // 省略時はカタログ既定色
  lightOn?: boolean // 発光プロップのみ（省略時 true）
  lightIntensity?: number // 発光プロップのみ 0〜10（省略時はカタログ既定）
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

// 文字タイミング（リップシンク・焼き込み字幕用）。秒は音声先頭基準
export interface Alignment {
  chars: string[]
  starts: number[]
  ends: number[]
}

// V2: 台詞をカットから分離した音声トラック上のクリップ。タイムライン絶対時刻を持つ
export interface DialogueClip {
  id: string
  speaker: string | null // null はト書き（音声なしテキストクリップ）
  text: string
  emotion?: string
  voiceId?: string
  audio?: string // mp3 dataURL（TTS生成後）
  alignment?: Alignment // 秒（音声先頭=0基準。startSec で平行移動しても壊れない）
  startSec: number // タイムライン絶対時刻
  durationSec: number
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
  source?: 'script' | 'capture' // script=ライブカメラ連動 / capture=凍結ポーズ。旧 dialogue 有無判定の移設先
  moveRange?: [number, number] // A→Bムーブの正規化窓（既定[0,1]）。分割時に比率分割
  clipId?: string // このカットを生成した DialogueClip の id（script カットのみ）。一括TTS時の尺追従に使う
}

export interface RoomSpec {
  width: number // X方向
  depth: number // Z方向
  wallHeight: number
  showBackWall: boolean
  showSideWall: boolean
  backWallZ?: number // 奥壁のZ位置（省略時 -depth/2）
  sideWallX?: number // 横壁のX位置（省略時 -width/2）
  floorColor?: string
  wallColor?: string
}

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night'

export interface SceneData {
  room: RoomSpec
  characters: Character[]
  props: Prop[]
  cameras: CameraRig[]
  timeOfDay?: TimeOfDay // 省略時 'day'
}

export interface Project {
  version: 2
  name: string
  slugline: string
  aspect: AspectRatio
  scene: SceneData
  axis?: AxisOfAction
  shots: Shot[]
  audioTrack: DialogueClip[] // V2: 台詞をカットから分離した音声トラック（1本・重なり禁止）
  scriptRaw?: string // スクリプトモードの台本原文
  voiceMap?: Record<string, string> // 話者名→ElevenLabs voice_id
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
