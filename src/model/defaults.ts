import { v3 } from '../core/math'
import type { Project, Prop, PropKind, Character, CameraRig, CameraPose, RoomSpec } from './types'

let counter = 0
export const genId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`

export interface PropDef {
  label: string // 日本語UIラベル
  size: { w: number; h: number; d: number } // m
  color: string
  yOffset?: number // 床から浮かせる量（windowなど）
  category?: 'set' | 'equipment' // 省略時 'set'。equipmentは機材配置図の対象
  planCode?: string // 配置図上の記号（機材用）
}

export const PROP_CATALOG: Record<PropKind, PropDef> = {
  cube:    { label: 'キューブ', size: { w: 0.5, h: 0.5, d: 0.5 }, color: '#8a8f98' },
  table:   { label: 'テーブル', size: { w: 1.6, h: 0.74, d: 0.9 }, color: '#a07a4f' },
  chair:   { label: '椅子', size: { w: 0.45, h: 0.9, d: 0.45 }, color: '#b08c5a' },
  sofa:    { label: 'ソファ', size: { w: 2.0, h: 0.8, d: 0.9 }, color: '#6b7a8f' },
  bed:     { label: 'ベッド', size: { w: 1.6, h: 0.5, d: 2.0 }, color: '#9aa5b1' },
  counter: { label: 'カウンター', size: { w: 2.2, h: 0.9, d: 0.65 }, color: '#c2c8cf' },
  sink:    { label: 'シンク', size: { w: 0.8, h: 0.9, d: 0.6 }, color: '#d4d9de' },
  desk:    { label: 'デスク', size: { w: 1.4, h: 0.74, d: 0.7 }, color: '#8c6f4e' },
  shelf:   { label: '棚', size: { w: 0.9, h: 1.8, d: 0.35 }, color: '#7d6448' },
  lamp:    { label: 'ランプ', size: { w: 0.4, h: 1.6, d: 0.4 }, color: '#e8d9a8' },
  light:   { label: '照明', size: { w: 0.3, h: 0.3, d: 0.3 }, color: '#ffe9b0' },
  door:    { label: 'ドア', size: { w: 0.9, h: 2.1, d: 0.06 }, color: '#7a5c3e' },
  window:  { label: '窓', size: { w: 1.2, h: 1.0, d: 0.06 }, color: '#aac6d8', yOffset: 0.9 },
  wall:    { label: '壁', size: { w: 3.0, h: 2.6, d: 0.1 }, color: '#3a3f47' },
  plant:   { label: '観葉植物', size: { w: 0.45, h: 1.2, d: 0.45 }, color: '#4f7a4f' },
  tv:      { label: 'テレビ', size: { w: 1.2, h: 0.7, d: 0.08 }, color: '#22262c', yOffset: 0.7 },
  rug:     { label: 'ラグ', size: { w: 2.0, h: 0.02, d: 1.4 }, color: '#5a4f6b' },
  // ---- 撮影機材（V2） ----
  lightstand: { label: 'ライト+スタンド', size: { w: 0.5, h: 2.1, d: 0.5 }, color: '#ffd9a0', category: 'equipment', planCode: 'L' },
  ledpanel:   { label: 'LEDパネル', size: { w: 0.7, h: 1.9, d: 0.18 }, color: '#cfe2ff', category: 'equipment', planCode: 'LED' },
  softbox:    { label: 'ソフトボックス', size: { w: 0.95, h: 2.0, d: 0.95 }, color: '#efe8d8', category: 'equipment', planCode: 'SB' },
  cstand:     { label: 'Cスタンド', size: { w: 0.5, h: 1.8, d: 0.5 }, color: '#9aa0a8', category: 'equipment', planCode: 'C' },
  flag:       { label: 'フラッグ', size: { w: 0.9, h: 1.7, d: 0.06 }, color: '#23252b', category: 'equipment', planCode: 'FL' },
  dolly:      { label: 'ドリー', size: { w: 0.75, h: 0.55, d: 1.05 }, color: '#6a7078', category: 'equipment', planCode: 'D' },
  dollyrail:  { label: 'ドリーレール', size: { w: 0.42, h: 0.12, d: 3.0 }, color: '#8a8f98', category: 'equipment', planCode: 'R' },
  tripod:     { label: '三脚', size: { w: 0.6, h: 1.5, d: 0.6 }, color: '#3c424c', category: 'equipment', planCode: 'T' },
  monitor:    { label: 'モニター', size: { w: 0.65, h: 1.4, d: 0.45 }, color: '#22262c', category: 'equipment', planCode: 'M' },
  reflector:  { label: 'レフ板', size: { w: 0.85, h: 1.5, d: 0.05 }, color: '#f4f0e0', category: 'equipment', planCode: 'RF' },
}

export const SET_PROP_KINDS = (Object.keys(PROP_CATALOG) as PropKind[])
  .filter((k) => (PROP_CATALOG[k].category ?? 'set') === 'set')
export const EQUIPMENT_KINDS = (Object.keys(PROP_CATALOG) as PropKind[])
  .filter((k) => PROP_CATALOG[k].category === 'equipment')

// ---- ロケセットテンプレート（V2） ----
type TemplateProp = { kind: PropKind; name?: string; x: number; z: number; ry?: number; sx?: number; sz?: number }
export interface LocationTemplate {
  key: string
  label: string
  slugline: string
  room: RoomSpec
  props: TemplateProp[]
}

const T = (kind: PropKind, x: number, z: number, ry = 0, extra: Partial<TemplateProp> = {}): TemplateProp =>
  ({ kind, x, z, ry, ...extra })

export const LOCATION_TEMPLATES: LocationTemplate[] = [
  {
    key: 'kitchen', label: 'キッチン', slugline: 'INT. KITCHEN — DAY',
    room: { width: 8, depth: 6, wallHeight: 2.6, showBackWall: true, showSideWall: true },
    props: [
      T('counter', -1.2, -2.4), T('sink', 0.6, -2.4), T('shelf', -3.4, -2.0),
      T('table', 0.2, 0.6), T('chair', -0.5, 1.2, Math.PI), T('chair', 0.9, 1.2, Math.PI),
      T('chair', 0.2, 0.0), T('lamp', 2.8, -1.4), T('window', -3.9, -0.5, Math.PI / 2),
      T('door', 3.2, -2.4), T('plant', 3.2, 1.8),
    ],
  },
  {
    key: 'living', label: 'リビング', slugline: 'INT. LIVING ROOM — DAY',
    room: { width: 9, depth: 7, wallHeight: 2.6, showBackWall: true, showSideWall: true },
    props: [
      T('sofa', 0, 1.2, Math.PI), T('rug', 0, -0.2), T('table', 0, -0.3, 0, { sx: 0.7, sz: 0.7 }),
      T('tv', 0, -3.2), T('shelf', -3.8, -2.5), T('lamp', 2.8, 1.8), T('plant', -3.8, 1.5),
      T('window', -4.4, 0, Math.PI / 2), T('door', 3.8, -3.2),
    ],
  },
  {
    key: 'bedroom', label: '寝室', slugline: 'INT. BEDROOM — NIGHT',
    room: { width: 6, depth: 5.5, wallHeight: 2.5, showBackWall: true, showSideWall: true },
    props: [
      T('bed', -0.8, -1.0), T('lamp', -2.4, -2.2), T('shelf', 2.2, -2.3),
      T('chair', 2.2, 0.5, -Math.PI / 2), T('window', -2.9, 0.5, Math.PI / 2),
      T('door', 2.6, 2.2, Math.PI), T('rug', 0.6, 1.0),
    ],
  },
  {
    key: 'office', label: 'オフィス', slugline: 'INT. OFFICE — DAY',
    room: { width: 10, depth: 7, wallHeight: 2.7, showBackWall: true, showSideWall: true },
    props: [
      T('desk', -2.0, -1.5), T('chair', -2.0, -0.7, Math.PI), T('monitor', -2.0, -1.9, 0, { name: 'PCモニター' }),
      T('desk', 1.0, -1.5), T('chair', 1.0, -0.7, Math.PI),
      T('table', 2.8, 1.8, 0, { name: '会議テーブル', sx: 1.3 }), T('chair', 2.0, 2.6, Math.PI), T('chair', 3.6, 2.6, Math.PI),
      T('shelf', -4.6, -2.8), T('plant', 4.4, -2.8), T('window', -4.9, 0, Math.PI / 2), T('door', 4.4, 3.1, Math.PI),
    ],
  },
  {
    key: 'cafe', label: 'カフェ', slugline: 'INT. CAFE — DAY',
    room: { width: 9, depth: 7, wallHeight: 2.8, showBackWall: true, showSideWall: true },
    props: [
      T('counter', -2.0, -2.8, 0, { sx: 1.4 }), T('shelf', -4.2, -3.0),
      T('table', -1.5, 0.5, 0, { sx: 0.55, sz: 0.8 }), T('chair', -2.1, 0.5, Math.PI / 2), T('chair', -0.9, 0.5, -Math.PI / 2),
      T('table', 1.5, 0.0, 0, { sx: 0.55, sz: 0.8 }), T('chair', 0.9, 0.0, Math.PI / 2), T('chair', 2.1, 0.0, -Math.PI / 2),
      T('table', 1.0, 2.3, 0, { sx: 0.55, sz: 0.8 }), T('chair', 1.6, 2.3, -Math.PI / 2),
      T('plant', 3.8, -2.6), T('plant', -4.0, 2.6), T('window', -4.4, 0.5, Math.PI / 2), T('door', 3.8, 3.1, Math.PI),
      T('lamp', 3.6, 1.0),
    ],
  },
  {
    key: 'alley', label: '路地（夜）', slugline: 'EXT. BACK ALLEY — NIGHT',
    room: { width: 5, depth: 12, wallHeight: 3.5, showBackWall: false, showSideWall: true },
    props: [
      T('wall', 2.45, -2, Math.PI / 2, { name: '右の壁', sz: 4 }),
      T('cube', -1.6, -3.0, 0.3, { name: 'ゴミ箱', sx: 0.8 }), T('cube', -1.2, -2.2, -0.2, { name: 'ゴミ箱2', sx: 0.6 }),
      T('cube', 1.6, 1.5, 0.15, { name: '木箱' }), T('light', -1.8, 0.5, 0, { name: '街灯' }),
      T('door', -2.4, -1.0, Math.PI / 2, { name: '裏口' }), T('light', 1.9, -4.0, 0, { name: '看板灯' }),
    ],
  },
]

export const CHARACTER_COLORS = ['#e8743b', '#3b6fe8', '#3be874', '#e83bd4', '#e8d23b', '#3bd4e8']
export const DEFAULT_HEIGHT = 1.75

export function makeCharacter(name: string, index: number): Character {
  return {
    id: genId('char'),
    name,
    color: CHARACTER_COLORS[index % CHARACTER_COLORS.length],
    position: v3(index * 1.2 - 0.6, 0, 0),
    rotationY: index % 2 === 0 ? Math.PI / 2 : -Math.PI / 2,
    height: DEFAULT_HEIGHT,
  }
}

export function makeProp(kind: PropKind): Prop {
  return {
    id: genId('prop'),
    kind,
    name: PROP_CATALOG[kind].label,
    position: v3(0, 0, 0),
    rotationY: 0,
    scale: v3(1, 1, 1),
  }
}

export const defaultPose = (): CameraPose => ({
  position: v3(0, 1.5, 3.5),
  lookAt: v3(0, 1.2, 0),
  roll: 0,
  focalLength: 35,
})

export function makeCamera(index: number): CameraRig {
  const letter = String.fromCharCode(65 + (index % 26))
  const angle = (index * Math.PI) / 3
  return {
    id: genId('cam'),
    name: `CAM ${letter}`,
    pose: {
      position: v3(Math.sin(angle) * 3.5, 1.5, Math.cos(angle) * 3.5),
      lookAt: v3(0, 1.2, 0),
      roll: 0,
      focalLength: 35,
    },
    moveDurationSec: 4,
  }
}

export function emptyProject(): Project {
  return {
    version: 1,
    name: '新規プロジェクト',
    slugline: 'INT. SCENE — DAY',
    aspect: '16:9',
    scene: {
      room: { width: 8, depth: 6, wallHeight: 2.6, showBackWall: true, showSideWall: true },
      characters: [],
      props: [],
      cameras: [],
    },
    shots: [],
  }
}

// スクリーンショット相当のサンプルシーン「キッチンの口論」
export function sampleProject(): Project {
  const maya: Character = { id: 'char_maya', name: 'Maya', color: '#e8743b', position: v3(-0.9, 0, -0.6), rotationY: Math.PI * 0.4, height: 1.68 }
  const dan: Character = { id: 'char_dan', name: 'Dan', color: '#3b6fe8', position: v3(0.9, 0, 0.2), rotationY: -Math.PI * 0.55, height: 1.8 }
  const props: Prop[] = [
    { id: 'prop_table', kind: 'table', name: 'キッチンテーブル', position: v3(0.2, 0, 0.6), rotationY: 0, scale: v3(1, 1, 1) },
    { id: 'prop_chair1', kind: 'chair', name: '椅子 1', position: v3(-0.5, 0, 1.1), rotationY: Math.PI, scale: v3(1, 1, 1) },
    { id: 'prop_chair2', kind: 'chair', name: '椅子 2', position: v3(0.9, 0, 1.1), rotationY: Math.PI, scale: v3(1, 1, 1) },
    { id: 'prop_counter', kind: 'counter', name: 'カウンター', position: v3(-1.2, 0, -1.8), rotationY: 0, scale: v3(1, 1, 1) },
    { id: 'prop_sink', kind: 'sink', name: 'シンク', position: v3(0.6, 0, -1.8), rotationY: 0, scale: v3(1, 1, 1) },
    { id: 'prop_lamp', kind: 'lamp', name: 'フロアランプ', position: v3(2.6, 0, -1.2), rotationY: 0, scale: v3(1, 1, 1) },
    { id: 'prop_door', kind: 'door', name: 'ドア', position: v3(3.2, 0, -2.2), rotationY: 0, scale: v3(1, 1, 1) },
  ]
  const cameras: CameraRig[] = [
    { id: 'cam_a', name: 'CAM A', pose: { position: v3(-0.4, 1.45, 2.8), lookAt: v3(0, 1.2, 0), roll: 0, focalLength: 28 }, moveDurationSec: 4 },
    { id: 'cam_b', name: 'CAM B', pose: { position: v3(2.4, 1.5, 1.4), lookAt: v3(-0.6, 1.3, -0.5), roll: 0, focalLength: 50 }, moveDurationSec: 4 },
    { id: 'cam_c', name: 'CAM C', pose: { position: v3(-2.4, 1.45, 1.9), lookAt: v3(1.3, 1.15, -0.1), roll: 0, focalLength: 65 }, moveDurationSec: 4 },
  ]
  return {
    version: 1,
    name: 'Kitchen Argument (Sample)',
    slugline: 'INT. KITCHEN — NIGHT',
    aspect: '16:9',
    scene: {
      room: { width: 8, depth: 6, wallHeight: 2.6, showBackWall: true, showSideWall: true },
      characters: [maya, dan],
      props,
      cameras,
    },
    axis: { charAId: maya.id, charBId: dan.id, lockedSide: 1 },
    shots: [],
  }
}
