// 外部から読み込む値（プロジェクトファイル等の信頼できない入力）の検証ヘルパー。
// URL・パス・ヘッダ・img/audio の src に入る値は、ここの許可リストを通ったものだけを使う。
// 描画で文字列メソッドや表引きに使われる列挙値もここで正規化し、壊れたファイルで画面が落ちないようにする。

// プロジェクトファイルの上限サイズ（サムネイル・音声 dataURL 込みでも通常は数十MB未満）
export const MAX_PROJECT_FILE_BYTES = 64 * 1024 * 1024
// dataURL 1本あたりの上限文字数（メモリ保護）
export const MAX_DATA_URL_CHARS = 5_000_000

// 配列の件数上限（実用より十分大きく、UI が固まらない範囲。超過分は切り捨てて利用者に通知する）
// 3D 表示はキャラ・カメラ・プロップ1つごとにメッシュ（VRM なら数MB級）を持つため、件数を厳しめにする
export const LIMITS = {
  characters: 100,
  cameras: 50,
  props: 300,
  shots: 1000,
  audioClips: 1000,
  charKeyframes: 1000, // キャラ1人あたり
  camKeys: 200, // カット1つあたり
  subjectIds: 100, // カット1つあたり
  voiceMap: 200,
  alignmentChars: 20_000, // クリップ1つあたり
} as const

// 文字列の長さ上限（描画・ファイル名・プロンプト出力に使われるもの）
export const STR_LIMITS = {
  id: 200,
  name: 200, // プロジェクト名（ファイル名にも使う）
  slugline: 500,
  scriptRaw: 200_000,
  objName: 100, // キャラ・カメラ・プロップ名
  notes: 5_000,
  clipText: 5_000,
  speaker: 100,
  emotion: 50,
} as const

// 読込時に切り捨て・補正した内容の記録（利用者への通知用）
export interface SanitizeReport {
  warnings: string[]
}
export const newReport = (): SanitizeReport => ({ warnings: [] })

export function capArray<T>(arr: T[], max: number, label: string, report?: SanitizeReport): T[] {
  if (arr.length <= max) return arr
  report?.warnings.push(`${label}が多すぎるため先頭${max}件のみ読み込みました（${arr.length}件中）`)
  return arr.slice(0, max)
}

export const capStr = (v: unknown, max: number, fallback = ''): string =>
  typeof v === 'string' ? (v.length > max ? v.slice(0, max) : v) : fallback

// ElevenLabs の voice_id は英数字のみ（例: 9BWtsMINqrJLrRacOk9x）。URL パスに入るため厳格に絞る
const VOICE_ID_RE = /^[A-Za-z0-9]{1,64}$/
export const isValidVoiceId = (v: unknown): v is string => typeof v === 'string' && VOICE_ID_RE.test(v)

// サムネイルはアプリが canvas から作る base64 dataURL のみ許可（外部URL・SVG・blob: は不可）
const IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/
export const isSafeImageDataUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_DATA_URL_CHARS && IMAGE_DATA_URL_RE.test(v)

// セリフ音声は base64 の audio dataURL のみ許可
const AUDIO_DATA_URL_RE = /^data:audio\/[a-z0-9.+-]{1,32};base64,[A-Za-z0-9+/]*={0,2}$/
export const isSafeAudioDataUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= MAX_DATA_URL_CHARS && AUDIO_DATA_URL_RE.test(v)

// 色は #rgb / #rrggbb / #rrggbbaa のみ（CSS の url(...) 等を style に入れさせない）
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && HEX_COLOR_RE.test(v)

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// ---- 列挙値（types.ts と一致させる。描画で表引き・文字列メソッドに使われる） ----
export const MOVE_TYPES = [
  'Static', 'Pan', 'Tilt', 'Push-in', 'Pull-out', 'Truck L', 'Truck R',
  'Pedestal Up', 'Pedestal Down', 'Arc', 'Zoom', 'Compound',
] as const
export const SHOT_SIZES = ['EWS', 'WS', 'FS', 'MS', 'MCU', 'CU', 'ECU', 'OTS', '2-SHOT', 'POV', 'INS'] as const
export const POSE_STATES = ['stand', 'sit', 'crouch', 'lie'] as const
export const ARM_POSES = ['natural', 'hands_on_hips', 'crossed', 'wave', 'point', 'tpose'] as const
export const BODY_TYPES = ['average', 'broad', 'slim', 'child'] as const
export const TIMES_OF_DAY = ['morning', 'day', 'evening', 'night'] as const
const ASPECTS = ['16:9', '2.39:1', '4:3', '1:1', '9:16'] as const

const inEnum = (list: readonly string[], v: unknown): v is string => typeof v === 'string' && list.includes(v)
// 必須の列挙値: 不正なら既定値へ
export const normEnum = <T extends string>(list: readonly T[], v: unknown, fallback: T): T =>
  inEnum(list, v) ? (v as T) : fallback
// 任意の列挙値: 不正なら undefined
export const optEnum = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  inEnum(list, v) ? (v as T) : undefined

// プロトタイプ汚染対策: JSON 由来のオブジェクトからこれらのキーを落とす
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const isUnsafeKey = (k: string): boolean => UNSAFE_KEYS.has(k)

// JSON.parse の reviver で危険キーを全階層から除去する
export function safeJsonParse(json: string): unknown {
  return JSON.parse(json, (key, value) => (UNSAFE_KEYS.has(key) ? undefined : value))
}

// 話者名→voice_id の表。危険キーと不正な voice_id は捨てる
export function sanitizeVoiceMap(raw: unknown, report?: SanitizeReport): Record<string, string> | undefined {
  if (!isPlainObject(raw)) return undefined
  const entries = capArray(Object.entries(raw), LIMITS.voiceMap, 'ボイス割当', report)
  const out: Record<string, string> = {}
  for (const [k, v] of entries) {
    if (isUnsafeKey(k) || !isValidVoiceId(v)) continue
    out[capStr(k, STR_LIMITS.speaker)] = v
  }
  return out
}

const isVec3 = (v: unknown): v is Record<string, number> =>
  isPlainObject(v) && isNum(v.x) && isNum(v.y) && isNum(v.z)

// カメラポーズ: position/lookAt は必須、roll/focalLength は不正なら既定へ。成立しなければ undefined
export function sanitizePose(raw: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(raw) || !isVec3(raw.position) || !isVec3(raw.lookAt)) return undefined
  return {
    ...raw,
    position: { x: raw.position.x, y: raw.position.y, z: raw.position.z },
    lookAt: { x: raw.lookAt.x, y: raw.lookAt.y, z: raw.lookAt.z },
    roll: isNum(raw.roll) ? raw.roll : 0,
    focalLength: isNum(raw.focalLength) && raw.focalLength >= 5 ? raw.focalLength : 35,
  }
}

// 文字タイミング（リップシンク用）: 文字は文字列、時刻は数値、長さを揃える。成立しなければ undefined
export function sanitizeAlignment(raw: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(raw) || !Array.isArray(raw.chars) || !Array.isArray(raw.starts) || !Array.isArray(raw.ends)) {
    return undefined
  }
  const n = Math.min(raw.chars.length, raw.starts.length, raw.ends.length, LIMITS.alignmentChars)
  const chars: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  for (let i = 0; i < n; i++) {
    const c = raw.chars[i]
    const s = raw.starts[i]
    const e = raw.ends[i]
    if (typeof c !== 'string' || !isNum(s) || !isNum(e)) return undefined
    chars.push(c.slice(0, 8))
    starts.push(s)
    ends.push(e)
  }
  return { chars, starts, ends }
}

// シーン（キャラ・カメラ・プロップ・部屋）の型検証。壊れた要素は捨て、色は16進以外を既定へ戻す。
// 返り値は新しいオブジェクト（入力をそのまま深くマージしない）
export function sanitizeScene(
  scene: Record<string, unknown>,
  baseRoom: Record<string, unknown>,
  propKinds: ReadonlySet<string>,
  report?: SanitizeReport,
): Record<string, unknown> {
  const characters = capArray(
    (scene.characters as unknown[]).filter(isPlainObject).filter((c) => typeof c.id === 'string' && isVec3(c.position)),
    LIMITS.characters, 'キャラクター', report,
  ).map((c) => {
    const o = { ...c }
    o.id = capStr(o.id, STR_LIMITS.id)
    o.name = capStr(o.name, STR_LIMITS.objName, String(o.id))
    if (!isHexColor(o.color)) o.color = '#888888'
    if (!isNum(o.rotationY)) o.rotationY = 0
    if (!isNum(o.height) || !(o.height > 0)) o.height = 1.75
    if (o.poseState !== undefined) o.poseState = optEnum(POSE_STATES, o.poseState)
    if (o.armPose !== undefined) o.armPose = optEnum(ARM_POSES, o.armPose)
    if (o.bodyType !== undefined) o.bodyType = optEnum(BODY_TYPES, o.bodyType)
    if (o.pathB !== undefined && !isVec3(o.pathB)) o.pathB = undefined
    if (o.vrmFileName !== undefined) o.vrmFileName = typeof o.vrmFileName === 'string' ? capStr(o.vrmFileName, STR_LIMITS.objName) : undefined
    if (o.keyframes !== undefined) {
      const kfs = Array.isArray(o.keyframes)
        ? o.keyframes.filter(isPlainObject).filter((k) => isNum(k.time) && isVec3(k.position)).map((k) => ({
          ...k,
          rotationY: isNum(k.rotationY) ? k.rotationY : 0,
          poseState: normEnum(POSE_STATES, k.poseState, 'stand'),
          armPose: normEnum(ARM_POSES, k.armPose, 'natural'),
        }))
        : []
      o.keyframes = kfs.length ? capArray(kfs, LIMITS.charKeyframes, `「${String(o.name)}」のキーフレーム`, report) : undefined
    }
    return o
  })
  const cameras = capArray(
    (scene.cameras as unknown[]).filter(isPlainObject).filter((c) => typeof c.id === 'string' && sanitizePose(c.pose)),
    LIMITS.cameras, 'カメラ', report,
  ).map((c) => {
    const o = { ...c }
    o.id = capStr(o.id, STR_LIMITS.id)
    o.name = capStr(o.name, STR_LIMITS.objName, String(o.id))
    o.pose = sanitizePose(o.pose)
    if (o.poseA !== undefined) o.poseA = sanitizePose(o.poseA)
    if (o.poseB !== undefined) o.poseB = sanitizePose(o.poseB)
    if (!isNum(o.moveDurationSec) || !(o.moveDurationSec > 0)) o.moveDurationSec = 4
    if (o.frameTargetId !== undefined && o.frameTargetId !== null && typeof o.frameTargetId !== 'string') o.frameTargetId = null
    return o
  })
  const props = capArray(
    (Array.isArray(scene.props) ? scene.props : [])
      .filter(isPlainObject)
      .filter((p) => typeof p.id === 'string' && typeof p.kind === 'string' && propKinds.has(p.kind) && isVec3(p.position)),
    LIMITS.props, 'プロップ・機材', report,
  ).map((p) => {
    const o = { ...p }
    o.id = capStr(o.id, STR_LIMITS.id)
    o.name = capStr(o.name, STR_LIMITS.objName, String(o.id))
    if (o.color !== undefined && !isHexColor(o.color)) delete o.color
    if (!isVec3(o.scale)) o.scale = { x: 1, y: 1, z: 1 }
    if (!isNum(o.rotationY)) o.rotationY = 0
    if (o.lightOn !== undefined && typeof o.lightOn !== 'boolean') delete o.lightOn
    if (o.lightIntensity !== undefined && !isNum(o.lightIntensity)) delete o.lightIntensity
    return o
  })
  const room = isPlainObject(scene.room) ? { ...scene.room } : { ...baseRoom }
  for (const k of ['width', 'depth', 'wallHeight']) {
    if (!isNum(room[k]) || !((room[k] as number) > 0)) room[k] = baseRoom[k]
  }
  for (const k of ['showBackWall', 'showSideWall']) {
    if (typeof room[k] !== 'boolean') room[k] = baseRoom[k]
  }
  for (const k of ['backWallZ', 'sideWallX']) {
    if (room[k] !== undefined && !isNum(room[k])) delete room[k]
  }
  for (const k of ['floorColor', 'wallColor']) {
    if (room[k] !== undefined && !isHexColor(room[k])) delete room[k]
  }
  const out: Record<string, unknown> = { ...scene, room, characters, cameras, props }
  if (out.timeOfDay !== undefined) out.timeOfDay = optEnum(TIMES_OF_DAY, out.timeOfDay)
  return out
}

// カット1つの型検証（v1/v2 共通）。poseSnapshot.a が成立しないものは null（捨てる）
export function sanitizeShotFields(s: Record<string, unknown>): Record<string, unknown> | null {
  const snap = s.poseSnapshot
  if (!isPlainObject(snap)) return null
  const a = sanitizePose(snap.a)
  if (!a) return null
  const shot = { ...s }
  const b = snap.b !== undefined ? sanitizePose(snap.b) : undefined
  shot.poseSnapshot = b ? { a, b } : { a }
  if (typeof shot.id !== 'string') shot.id = `shot_${Math.random().toString(36).slice(2, 10)}`
  shot.id = capStr(shot.id, STR_LIMITS.id)
  shot.cameraId = capStr(shot.cameraId, STR_LIMITS.id)
  shot.cameraName = capStr(shot.cameraName, STR_LIMITS.objName)
  // moveType は描画で toUpperCase される（BottomPanel）。未知・欠落は Static
  shot.moveType = normEnum(MOVE_TYPES, shot.moveType, 'Static')
  if (shot.shotSize !== undefined) shot.shotSize = optEnum(SHOT_SIZES, shot.shotSize)
  if (shot.source !== undefined) shot.source = optEnum(['script', 'capture'] as const, shot.source)
  if (!isNum(shot.durationSec) || !(shot.durationSec > 0)) shot.durationSec = 3
  if (!isNum(shot.focalLength) || !(shot.focalLength >= 5)) shot.focalLength = 35
  const notes = isPlainObject(shot.notes) ? shot.notes : {}
  shot.notes = { action: capStr(notes.action, STR_LIMITS.notes), camera: capStr(notes.camera, STR_LIMITS.notes) }
  shot.subjectIds = Array.isArray(shot.subjectIds)
    ? shot.subjectIds.filter((x): x is string => typeof x === 'string').slice(0, LIMITS.subjectIds)
    : []
  if (shot.moveRange !== undefined) {
    const r = shot.moveRange
    shot.moveRange = Array.isArray(r) && r.length === 2 && isNum(r[0]) && isNum(r[1]) ? [r[0], r[1]] : undefined
  }
  if (Array.isArray(shot.camKeys) && shot.camKeys.length > LIMITS.camKeys) {
    shot.camKeys = shot.camKeys.slice(0, LIMITS.camKeys)
  }
  if (shot.clipId !== undefined && typeof shot.clipId !== 'string') shot.clipId = undefined
  return shot
}

// プロジェクト最上位の単純フィールドの型検証（名前はファイル名にも使われる）
export function sanitizeTopLevel(
  obj: Record<string, unknown>,
  base: Record<string, unknown>,
  report?: SanitizeReport,
): Record<string, unknown> {
  const o = { ...obj }
  o.name = capStr(o.name, STR_LIMITS.name, String(base.name))
  o.slugline = capStr(o.slugline, STR_LIMITS.slugline, String(base.slugline))
  o.aspect = normEnum(ASPECTS, o.aspect, base.aspect as (typeof ASPECTS)[number])
  if (o.scriptRaw !== undefined) {
    if (typeof o.scriptRaw !== 'string') delete o.scriptRaw
    else if (o.scriptRaw.length > STR_LIMITS.scriptRaw) {
      o.scriptRaw = o.scriptRaw.slice(0, STR_LIMITS.scriptRaw)
      report?.warnings.push(`台本テキストが長すぎるため先頭${STR_LIMITS.scriptRaw}文字のみ読み込みました`)
    }
  }
  if (o.axis !== undefined) {
    const ax = o.axis
    const ok = isPlainObject(ax) && typeof ax.charAId === 'string' && typeof ax.charBId === 'string' &&
      (ax.lockedSide === 1 || ax.lockedSide === -1)
    if (!ok) delete o.axis
  }
  if (o.voiceMap !== undefined) {
    const vm = sanitizeVoiceMap(o.voiceMap, report)
    if (vm) o.voiceMap = vm
    else delete o.voiceMap
  }
  return o
}
