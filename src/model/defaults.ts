import { v3 } from '../core/math'
import type { Project, Prop, PropKind, Character, CameraRig, CameraPose } from './types'

let counter = 0
export const genId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`

export interface PropDef {
  label: string // 日本語UIラベル
  size: { w: number; h: number; d: number } // m
  color: string
  yOffset?: number // 床から浮かせる量（windowなど）
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
}

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
