// 外部から読み込む値（プロジェクトファイル等の信頼できない入力）の検証ヘルパー。
// URL・パス・ヘッダ・img/audio の src に入る値は、ここの許可リストを通ったものだけを使う。

// プロジェクトファイルの上限サイズ（サムネイル・音声 dataURL 込みでも通常は数十MB未満）
export const MAX_PROJECT_FILE_BYTES = 64 * 1024 * 1024
// dataURL 1本あたりの上限文字数（メモリ保護）
export const MAX_DATA_URL_CHARS = 5_000_000

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

// プロトタイプ汚染対策: JSON 由来のオブジェクトからこれらのキーを落とす
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export const isUnsafeKey = (k: string): boolean => UNSAFE_KEYS.has(k)

// JSON.parse の reviver で危険キーを全階層から除去する
export function safeJsonParse(json: string): unknown {
  return JSON.parse(json, (key, value) => (UNSAFE_KEYS.has(key) ? undefined : value))
}

// 話者名→voice_id の表。危険キーと不正な voice_id は捨てる
export function sanitizeVoiceMap(raw: unknown): Record<string, string> | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (isUnsafeKey(k) || !isValidVoiceId(v)) continue
    out[k] = v
  }
  return out
}

const ASPECTS = new Set(['16:9', '2.39:1', '4:3', '1:1', '9:16'])
const isVec3 = (v: unknown): boolean =>
  isPlainObject(v) && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number'

// シーン（キャラ・カメラ・プロップ・部屋）の型検証。壊れた要素は捨て、色は16進以外を既定へ戻す。
// 返り値は新しいオブジェクト（入力をそのまま深くマージしない）
export function sanitizeScene(
  scene: Record<string, unknown>,
  baseRoom: Record<string, unknown>,
  propKinds: ReadonlySet<string>,
): Record<string, unknown> {
  const characters = (scene.characters as unknown[])
    .filter(isPlainObject)
    .filter((c) => typeof c.id === 'string' && isVec3(c.position))
    .map((c) => {
      const o = { ...c }
      if (typeof o.name !== 'string') o.name = String(o.id)
      if (!isHexColor(o.color)) o.color = '#888888'
      if (typeof o.rotationY !== 'number') o.rotationY = 0
      if (typeof o.height !== 'number' || !(o.height > 0)) o.height = 1.75
      if (o.keyframes !== undefined && !Array.isArray(o.keyframes)) delete o.keyframes
      return o
    })
  const cameras = (scene.cameras as unknown[])
    .filter(isPlainObject)
    .filter((c) => typeof c.id === 'string' && isPlainObject(c.pose) && isVec3(c.pose.position) && isVec3(c.pose.lookAt))
    .map((c) => {
      const o = { ...c }
      if (typeof o.name !== 'string') o.name = String(o.id)
      return o
    })
  const props = (Array.isArray(scene.props) ? scene.props : [])
    .filter(isPlainObject)
    .filter((p) => typeof p.id === 'string' && typeof p.kind === 'string' && propKinds.has(p.kind) && isVec3(p.position))
    .map((p) => {
      const o = { ...p }
      if (typeof o.name !== 'string') o.name = String(o.id)
      if (o.color !== undefined && !isHexColor(o.color)) delete o.color
      if (!isVec3(o.scale)) o.scale = { x: 1, y: 1, z: 1 }
      if (typeof o.rotationY !== 'number') o.rotationY = 0
      return o
    })
  const room = isPlainObject(scene.room) ? { ...scene.room } : { ...baseRoom }
  for (const k of ['floorColor', 'wallColor']) {
    if (room[k] !== undefined && !isHexColor(room[k])) delete room[k]
  }
  return { ...scene, room, characters, cameras, props }
}

// プロジェクト最上位の単純フィールドの型検証（名前はファイル名にも使われる）
export function sanitizeTopLevel(obj: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
  const o = { ...obj }
  if (typeof o.name !== 'string') o.name = base.name
  if (typeof o.slugline !== 'string') o.slugline = base.slugline
  if (typeof o.aspect !== 'string' || !ASPECTS.has(o.aspect)) o.aspect = base.aspect
  if (o.scriptRaw !== undefined && typeof o.scriptRaw !== 'string') delete o.scriptRaw
  if (o.axis !== undefined && !isPlainObject(o.axis)) delete o.axis
  if (o.voiceMap !== undefined) {
    const vm = sanitizeVoiceMap(o.voiceMap)
    if (vm) o.voiceMap = vm
    else delete o.voiceMap
  }
  return o
}
