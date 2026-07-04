// 台本→自動カット割り（思想: 土台を一発で自動生成し、仕上げは人間が演出する）
// 会話配置・アクション軸・切り返し（OTS/CU）・定期的なマスター戻しを自動生成する
import { v3 } from './math'
import type { Vec3 } from './math'
import type { Character, CameraRig, CameraPose, ShotSize, RoomSpec } from '../model/types'
import { solveFraming, solveOTS, solveTwoShot } from './framing'
import { ScriptLine, uniqueSpeakers, estimateDurationSec } from './scriptParser'
import { CHARACTER_COLORS, DEFAULT_HEIGHT, genId } from '../model/defaults'

export interface PlannedShot {
  cameraName: string
  pose: CameraPose
  shotSize: ShotSize
  speakerName: string | null
  subjectNames: string[]
  text: string
  emotion?: string
  durationSec: number
}

export interface CutscenePlan {
  characters: Character[] // 新規作成分（既存名と一致するものは含まない）
  allSpeakerNames: string[]
  cameras: CameraRig[]
  shots: PlannedShot[]
  axis?: { aName: string; bName: string; lockedSide: 1 | -1 }
}

// 話者を会話陣形に配置（2人=対面1.8m、3人以上=弧）
export function arrangeSpeakers(names: string[], existing: Character[]): Character[] {
  const out: Character[] = []
  const n = names.length
  names.forEach((name, i) => {
    const found = existing.find((c) => c.name === name)
    if (found) return // 既存キャラはそのまま使う
    let pos: Vec3
    let rotY: number
    if (n <= 2) {
      pos = v3(i === 0 ? -0.9 : 0.9, 0, 0)
      rotY = i === 0 ? Math.PI / 2 : -Math.PI / 2 // 向かい合う
    } else {
      const angle = (i / n) * Math.PI * 2
      const r = 1.2 + n * 0.12
      pos = v3(Math.sin(angle) * r, 0, Math.cos(angle) * r)
      rotY = Math.atan2(-pos.x, -pos.z) // 中心を向く
    }
    out.push({
      id: genId('char'),
      name,
      color: CHARACTER_COLORS[(existing.length + out.length) % CHARACTER_COLORS.length],
      position: pos,
      rotationY: rotY,
      height: DEFAULT_HEIGHT,
    })
  })
  return out
}

const RE_ESTABLISH_EVERY = 6 // Nカットごとにマスターへ戻す

// カメラ位置の良さを採点: 部屋の中＞外、壁のない開放側（+Z / 横壁があれば+X寄り）を好む
// 壁が移動されている場合（backWallZ / sideWallX）は実際の壁位置の裏を強く減点する
export function scoreCameraPosition(p: Vec3, room?: RoomSpec): number {
  let s = 0
  if (room) {
    const inX = Math.abs(p.x) <= room.width / 2 - 0.2
    const inZ = Math.abs(p.z) <= room.depth / 2 - 0.2
    if (inX && inZ) s += 100 // 部屋の中にいることが最優先
    // 「壁の裏」は被写体（原点付近）から見て壁の向こう側。壁が+Z側へ動かされた場合も成立する
    if (room.showBackWall) {
      const backZ = room.backWallZ ?? -room.depth / 2
      const subjSide = Math.sign(-backZ || -1) // 被写体側の符号（壁がz=0なら-Z側を被写体側とみなす）
      if ((p.z - backZ) * subjSide < 0.2) s -= 60 // 壁の裏は不可
      s += p.z * subjSide * 2 // 壁から離れる開放側を好む
    }
    if (room.showSideWall) {
      const sideX = room.sideWallX ?? -room.width / 2
      const subjSide = Math.sign(-sideX || -1)
      if ((p.x - sideX) * subjSide < 0.2) s -= 60 // 壁の裏は不可
      s += p.x * subjSide // 壁から離れる開放側を好む
    }
  } else {
    s += p.z // 部屋情報がなければ手前(+Z)側
  }
  return s
}

export function buildCutscene(
  lines: ScriptLine[], existingChars: Character[], ar: number, room?: RoomSpec,
): CutscenePlan {
  const speakerNames = uniqueSpeakers(lines)
  const newChars = arrangeSpeakers(speakerNames, existingChars)
  const all = [...existingChars, ...newChars]
  const byName = (n: string) => all.find((c) => c.name === n)!

  const cameras: CameraRig[] = []
  const cameraByKey = new Map<string, CameraRig>()
  const ensureCamera = (key: string, name: string, pose: CameraPose): CameraRig => {
    let cam = cameraByKey.get(key)
    if (!cam) {
      cam = { id: genId('cam'), name, pose, moveDurationSec: 4 }
      cameraByKey.set(key, cam)
      cameras.push(cam)
    }
    return cam
  }

  // 軸: 最初の2話者。マスターの撮影サイドは「部屋の開いている側」を採点して選ぶ
  // （壁の裏にカメラが置かれてプレビューが壁面になる事故を防ぐ）
  const a = speakerNames[0] ? byName(speakerNames[0]) : undefined
  const b = speakerNames[1] ? byName(speakerNames[1]) : undefined
  let lockedSide: 1 | -1 = 1
  if (a && b) {
    const candPlus = solveTwoShot(a, b, 35, ar, 1)
    const candMinus = solveTwoShot(a, b, 35, ar, -1)
    lockedSide =
      scoreCameraPosition(candPlus.position, room) >= scoreCameraPosition(candMinus.position, room)
        ? 1
        : -1
  }
  // solveOTS/solveTwoShotのサイド規約: sideOf(第1引数, 第2引数)。軸はa→b
  const sideFor = (first: Character): 1 | -1 =>
    a && first.id === a.id ? lockedSide : (-lockedSide as 1 | -1)

  const shots: PlannedShot[] = []
  const spokenCount = new Map<string, number>()
  let sinceMaster = 0

  const masterShot = (text: string, durationSec: number): PlannedShot | null => {
    if (a && b) {
      const pose = solveTwoShot(a, b, 35, ar, lockedSide)
      const cam = ensureCamera('master', 'MASTER', pose)
      return {
        cameraName: cam.name, pose, shotSize: '2-SHOT', speakerName: null,
        subjectNames: [a.name, b.name], text, durationSec,
      }
    }
    if (a) {
      const pose = solveFraming(a, 'WS', 28, ar)
      const cam = ensureCamera('master', 'MASTER', pose)
      return {
        cameraName: cam.name, pose, shotSize: 'WS', speakerName: null,
        subjectNames: [a.name], text, durationSec,
      }
    }
    return null
  }

  lines.forEach((line, idx) => {
    const dur = estimateDurationSec(line.text)
    // ト書き or 冒頭 → マスター
    if (!line.speaker || idx === 0 || sinceMaster >= RE_ESTABLISH_EVERY) {
      const m = masterShot(line.text, dur)
      if (m) {
        shots.push({ ...m, speakerName: line.speaker, emotion: line.emotion })
        sinceMaster = 0
        if (line.speaker) spokenCount.set(line.speaker, (spokenCount.get(line.speaker) ?? 0) + 1)
        return
      }
    }
    if (!line.speaker) return // キャラ不在のト書きでマスターが作れない場合はスキップ
    const speaker = byName(line.speaker)
    const listener =
      (a && b && (speaker.id === a.id ? b : a)) ||
      all.find((c) => c.id !== speaker.id)
    const count = spokenCount.get(line.speaker) ?? 0
    spokenCount.set(line.speaker, count + 1)
    sinceMaster++

    // 切り返し: 初登場はOTS、以降はCU/MCUを交互
    if (listener && count === 0) {
      const pose = solveOTS(speaker, listener, 50, ar, sideFor(speaker))
      const cam = ensureCamera(`ots_${speaker.id}`, `OTS ${speaker.name}`, pose)
      shots.push({
        cameraName: cam.name, pose, shotSize: 'OTS', speakerName: speaker.name,
        subjectNames: [speaker.name, listener.name], text: line.text, emotion: line.emotion, durationSec: dur,
      })
    } else {
      const size: ShotSize = count % 2 === 1 ? 'CU' : 'MCU'
      // 正サイドからのフレーミング（リスナー方向の方位角を基準に既存カメラ位置を渡す）
      const refPos = listener
        ? v3(
            speaker.position.x + (listener.position.x - speaker.position.x) * 0.8,
            1.5,
            speaker.position.z + (listener.position.z - speaker.position.z) * 0.8,
          )
        : undefined
      const pose = solveFraming(speaker, size as 'CU' | 'MCU', 65, ar, refPos)
      const cam = ensureCamera(`${size}_${speaker.id}`, `${size} ${speaker.name}`, pose)
      shots.push({
        cameraName: cam.name, pose, shotSize: size, speakerName: speaker.name,
        subjectNames: [speaker.name], text: line.text, emotion: line.emotion, durationSec: dur,
      })
    }
  })

  return {
    characters: newChars,
    allSpeakerNames: speakerNames,
    cameras,
    shots,
    axis: a && b ? { aName: a.name, bName: b.name, lockedSide } : undefined,
  }
}
