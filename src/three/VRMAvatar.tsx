// VRMキャラクター表示＋リップシンク＋まばたき＋呼吸イドル
// VRMファイルの実体はランタイムのArrayBufferキャッシュに保持（プロジェクトJSONには含めない）
import { useEffect, useState, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import type { VRMHumanBoneName } from '@pixiv/three-vrm'
import type { Character, PoseState } from '../model/types'
import { useStore } from '../state/store'
import { activeClipsAt } from '../core/audioTrack'
import { visemeAt, visemeWeights } from '../core/lipsync'
import { useCharAnimState } from './useCharAnimState'

// VRM0モデルは VRMUtils.rotateVRM0() で vrm.scene.rotation.y = π が立つ。
// 一方 VRMHumanoidRig は rotateVRM0 前に raw bone から構築される。
// normalizedHumanBonesRoot は vrm.scene の子として attach されるため、bone の世界回転には
// scene.rotation.y = π が掛かる。よって X/Z の Euler 入力はワールドで符号が反転する（Yは可換）。
// この差を吸収するための符号: VRM0 → -1、VRM1 → +1。
function vrmSignX(vrm: VRM): number {
  return vrm.meta?.metaVersion === '0' ? -1 : 1
}

// charId → VRMバイナリ（読み込んだ.vrmファイル）
const vrmBuffers = new Map<string, ArrayBuffer>()
export const setVrmBuffer = (charId: string, buf: ArrayBuffer): void => { vrmBuffers.set(charId, buf) }
export const hasVrmBuffer = (charId: string): boolean => vrmBuffers.has(charId)
export const clearVrmBuffer = (charId: string): void => { vrmBuffers.delete(charId) }

// 姿勢ごとのボーン回転（脚・胴のみ。腕は方向計測ベースのapplyArmPoseが担当）
const POSE_BONES: Record<PoseState, Partial<Record<VRMHumanBoneName, [number, number, number]>>> = {
  stand: {},
  sit: {
    leftUpperLeg: [-1.5, 0, 0], rightUpperLeg: [-1.5, 0, 0], // 腿を前へ
    leftLowerLeg: [1.5, 0, 0], rightLowerLeg: [1.5, 0, 0], // 膝から下げる
  },
  crouch: {
    leftUpperLeg: [-2.1, 0.15, 0], rightUpperLeg: [-2.1, -0.15, 0],
    leftLowerLeg: [2.3, 0, 0], rightLowerLeg: [2.3, 0, 0],
    spine: [0.35, 0, 0], // 前かがみ
  },
  lie: {},
}

// 姿勢ごとのモデル全体の補正（hips基準の沈み込み係数とX回転）
const POSE_TRANSFORM: Record<PoseState, { hipDropFactor: number; rotX: number; baseY: number }> = {
  stand:  { hipDropFactor: 0, rotX: 0, baseY: 0 },
  sit:    { hipDropFactor: 1, rotX: 0, baseY: 0.47 }, // 座面≈0.47mへ
  crouch: { hipDropFactor: 1, rotX: 0, baseY: 0.32 },
  lie:    { hipDropFactor: 1, rotX: -Math.PI / 2, baseY: 0.12 }, // 仰向け（顔が上）
}

// ===== 腕ポーズ（方向計測ベース＝モデルのボーン軸規約に依存しない） =====
// 各腕の「実際の休め方向」を計測し、目標方向への回転をクォータニオンで解く。
// 係数は { out: 腕の外側, up: 上, fwd: 前方 } の合成（モデルごとに out を実測するため左右・規約差に強い）
interface ArmTarget { upper: [number, number, number]; fore: [number, number, number] }
const NATURAL_ARM: ArmTarget = { upper: [0.25, -0.97, 0.02], fore: [0.18, -0.92, 0.22] }
const ARM_PRESETS: Record<Exclude<ArmPoseT, 'tpose'>, { left: ArmTarget; right: ArmTarget }> = {
  natural: { left: NATURAL_ARM, right: NATURAL_ARM },
  hands_on_hips: {
    left: { upper: [0.78, -0.62, 0.05], fore: [-0.82, -0.4, 0.42] },
    right: { upper: [0.78, -0.62, 0.05], fore: [-0.82, -0.4, 0.42] },
  },
  crossed: {
    left: { upper: [0.5, -0.84, 0.2], fore: [-0.93, 0.08, 0.35] },
    right: { upper: [0.5, -0.84, 0.2], fore: [-0.93, 0.08, 0.35] },
  },
  wave: {
    left: NATURAL_ARM,
    right: { upper: [0.6, 0.78, 0.15], fore: [0.05, 0.97, 0.1] }, // 右手を上げる
  },
  point: {
    left: NATURAL_ARM,
    right: { upper: [0.12, -0.1, 0.98], fore: [0.02, 0.02, 1.0] }, // 右腕で前方を指す
  },
}
type ArmPoseT = NonNullable<Character['armPose']>

function aimBoneWorld(
  node: THREE.Object3D, restDirWorld: THREE.Vector3, targetDirWorld: THREE.Vector3,
): void {
  const parentQ = node.parent!.getWorldQuaternion(new THREE.Quaternion())
  const qDelta = new THREE.Quaternion().setFromUnitVectors(
    restDirWorld.clone().normalize(), targetDirWorld.clone().normalize(),
  )
  // ローカル回転へ変換: local = parentQ⁻¹ · ΔQ · parentQ（正規化リグの休めローカル回転=単位を前提）
  const inv = parentQ.clone().invert()
  node.quaternion.copy(inv.multiply(qDelta).multiply(parentQ))
}

function applyArmPose(vrm: VRM, armPose: ArmPoseT): void {
  const h = vrm.humanoid
  if (!h) return
  for (const name of ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'] as VRMHumanBoneName[]) {
    h.getNormalizedBoneNode(name)?.rotation.set(0, 0, 0)
  }
  if (armPose === 'tpose') return
  const preset = ARM_PRESETS[armPose]
  // 体の基準軸を「ボーン実測」で求める（モデル規約・rotateVRM0の有無に依存しない）。
  // 旧実装はシーンの+Zを前方と仮定していたが、VRM0モデルはrotateVRM0で
  // シーンルートが180°回転しており前後が反転していた（腕が背中側に回るバグの原因）
  vrm.scene.updateMatrixWorld(true)
  const lUpper = h.getNormalizedBoneNode('leftUpperArm')
  const rUpper = h.getNormalizedBoneNode('rightUpperArm')
  const hips = h.getNormalizedBoneNode('hips')
  const headBone = h.getNormalizedBoneNode('head') ?? h.getNormalizedBoneNode('neck') ?? h.getNormalizedBoneNode('chest')
  if (!lUpper || !rUpper || !hips || !headBone) return
  const lShoulderW = lUpper.getWorldPosition(new THREE.Vector3())
  const rShoulderW = rUpper.getWorldPosition(new THREE.Vector3())
  const LEFT = lShoulderW.clone().sub(rShoulderW).normalize() // 体の左方向（実測）
  const UP = headBone.getWorldPosition(new THREE.Vector3())
    .sub(hips.getWorldPosition(new THREE.Vector3())).normalize() // 体の上方向（実測）
  // 前方 = 左 × 上（右手系: LEFT × UP = +Z前方）。
  // UP × LEFT = (0,1,0)×(1,0,0) = (0,0,-1) = 後方になるため腕が背中側へ振れていた。
  // LEFT × UP = (1,0,0)×(0,1,0) = (0,0,+1) = 前方（+Z）が正しい。
  const FWD = new THREE.Vector3().crossVectors(LEFT, UP).normalize()
  if (FWD.lengthSq() < 0.5) FWD.set(0, 0, 1) // 退避（肩が縮退したモデル）

  for (const side of ['left', 'right'] as const) {
    const upper = h.getNormalizedBoneNode(`${side}UpperArm` as VRMHumanBoneName)
    const lower = h.getNormalizedBoneNode(`${side}LowerArm` as VRMHumanBoneName)
    const hand = h.getNormalizedBoneNode(`${side}Hand` as VRMHumanBoneName)
    if (!upper || !lower) continue
    const t = preset[side]
    const OUT = side === 'left' ? LEFT : LEFT.clone().negate() // その腕の外側
    const mix = (c: [number, number, number]) =>
      new THREE.Vector3()
        .addScaledVector(OUT, c[0])
        .addScaledVector(UP, c[1])
        .addScaledVector(FWD, c[2])
        .normalize()
    // 1) 上腕: 休め方向（肩→肘）を実測し、目標方向へ
    vrm.scene.updateMatrixWorld(true)
    const shoulderW = upper.getWorldPosition(new THREE.Vector3())
    const elbowW = lower.getWorldPosition(new THREE.Vector3())
    let restUpper = elbowW.clone().sub(shoulderW)
    if (restUpper.lengthSq() < 1e-6) restUpper = OUT.clone()
    aimBoneWorld(upper, restUpper, mix(t.upper))
    // 2) 前腕: 上腕適用後の休め方向（肘→手首）を再計測して目標へ
    vrm.scene.updateMatrixWorld(true)
    const elbowW2 = lower.getWorldPosition(new THREE.Vector3())
    const wristW = (hand ?? lower).getWorldPosition(new THREE.Vector3())
    let restFore = wristW.clone().sub(elbowW2)
    if (restFore.lengthSq() < 1e-6) restFore = elbowW2.clone().sub(upper.getWorldPosition(new THREE.Vector3()))
    aimBoneWorld(lower, restFore, mix(t.fore))
  }
}

function applyVrmPose(vrm: VRM, pose: PoseState): { yOffset: number; zOffset: number; rotX: number } {
  const h = vrm.humanoid
  if (!h) return { yOffset: 0, zOffset: 0, rotX: 0 }
  const ALL: VRMHumanBoneName[] = [
    'spine', 'chest', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
    'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
  ]
  for (const name of ALL) h.getNormalizedBoneNode(name)?.rotation.set(0, 0, 0)
  const bones = POSE_BONES[pose]
  const sx = vrmSignX(vrm)
  // VRM0 では scene.rotation.y=π が bone の世界回転に乗るため X/Z Euler を反転（Y は π回転と可換）
  for (const [name, [x, y, z]] of Object.entries(bones) as Array<[VRMHumanBoneName, [number, number, number]]>) {
    h.getNormalizedBoneNode(name)?.rotation.set(x * sx, y, z * sx)
  }
  // 沈み込み量: 立位の腰の高さと目標座面の差
  // 内側group の transform は M = T(0, yOffset, zOffset) * R_x(rotX) なので、hipsローカル(0, hipRestY, 0)は
  // 先に R_x(rotX) で (0, hipRestY*cos(rotX), hipRestY*sin(rotX)) へ回り、その後 (yOffset, zOffset) が足される。
  // 目標(0, baseY, 0)に hips を合わせるには yOffset = baseY - hipRestY*cos(rotX)、zOffset = -hipRestY*sin(rotX)。
  // lie (rotX=-π/2) で cos=0, sin=-1 → yOffset=baseY、zOffset=+hipRestY。床面かつキャラ位置上でhipsが見える
  const t = POSE_TRANSFORM[pose]
  // bones の rotation 反映を world に伝搬してから hips world Y を測る
  vrm.scene.updateMatrixWorld(true)
  let yOffset = 0
  let zOffset = 0
  if (t.hipDropFactor > 0) {
    const hips = h.getNormalizedBoneNode('hips')
    const hipRestY = hips ? hips.getWorldPosition(new THREE.Vector3()).y : 0.8
    yOffset = (t.baseY - hipRestY * Math.cos(t.rotX)) * t.hipDropFactor
    zOffset = (-hipRestY * Math.sin(t.rotX)) * t.hipDropFactor
  }
  return { yOffset, zOffset, rotX: t.rotX }
}

export function VRMAvatar({ char, interactive }: { char: Character; interactive: boolean }) {
  const select = useStore((s) => s.select)
  const anim = useCharAnimState(char) // キーフレーム評価（再生・スクラブ中）
  const [vrm, setVrm] = useState<VRM | null>(null)
  const [poseFix, setPoseFix] = useState({ yOffset: 0, zOffset: 0, rotX: 0 })
  const blinkRef = useRef({ next: 2 + Math.random() * 3, phase: 0 })
  const signXRef = useRef(1)

  useEffect(() => {
    const buf = vrmBuffers.get(char.id)
    if (!buf) return
    let disposed = false
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    loader.parse(buf.slice(0), '', (gltf) => {
      if (disposed) return
      const v = gltf.userData.vrm as VRM
      if (!v) return
      VRMUtils.removeUnnecessaryVertices(gltf.scene)
      // NOTE: combineSkeletons は three-vrm 3.x で normalized rig 参照を壊す可能性があるため除外
      // （bone のスケルトン統合が rig 構築後に走ると getNormalizedBoneNode のキャッシュと不整合になる）
      // VRMUtils.combineSkeletons(gltf.scene)
      // VRM0モデルの向きをVRM1基準（+Z前方）に揃える
      VRMUtils.rotateVRM0(v)
      v.scene.traverse((o) => { o.castShadow = true })
      // モデルの実身長を計測してキャラ設定に反映（フレーミング数学と一致させる）
      v.scene.updateMatrixWorld(true)
      const bbox = new THREE.Box3().setFromObject(v.scene)
      const modelHeight = Math.round((bbox.max.y - bbox.min.y) * 100) / 100
      const st = useStore.getState()
      const current = st.project.scene.characters.find((c) => c.id === char.id)
      if (current && modelHeight > 0.5 && Math.abs(current.height - modelHeight) > 0.02) {
        st.updateCharacter(char.id, { height: modelHeight })
      }
      signXRef.current = vrmSignX(v)
      // Tポーズ解除（初期姿勢＋腕ポーズを適用）
      setPoseFix(applyVrmPose(v, char.poseState ?? 'stand'))
      applyArmPose(v, char.armPose ?? 'natural')
      setVrm(v)
    }, (e) => console.error('VRM読込失敗', e))
    return () => {
      disposed = true
      setVrm((prev) => {
        if (prev) VRMUtils.deepDispose(prev.scene)
        return null
      })
    }
  }, [char.id, char.vrmFileName])

  // 姿勢・腕ポーズ変更時に適用し直す（キーフレーム評価値に追従）
  useEffect(() => {
    if (!vrm) return
    setPoseFix(applyVrmPose(vrm, anim.poseState))
    applyArmPose(vrm, anim.armPose as ArmPoseT)
  }, [vrm, anim.poseState, anim.armPose])

  useFrame((state, delta) => {
    if (!vrm) return
    const t = state.clock.elapsedTime
    const em = vrm.expressionManager
    // 呼吸イドル（胸をわずかに。ポーズ既定値に加算）
    // VRM0 では X 回転がワールドで反転するため sx を掛ける
    const pose = anim.poseState
    const chest = vrm.humanoid?.getNormalizedBoneNode('chest') ?? vrm.humanoid?.getNormalizedBoneNode('spine')
    const sx = signXRef.current
    const chestBase = (pose === 'crouch' ? 0.35 : 0) * sx
    if (chest) chest.rotation.x = chestBase + Math.sin(t * 1.4) * 0.015 * sx
    // まばたき
    const b = blinkRef.current
    if (t > b.next) { b.phase = 0.18; b.next = t + 2 + Math.random() * 3.5 }
    if (b.phase > 0) {
      b.phase = Math.max(0, b.phase - delta)
      em?.setValue('blink', b.phase > 0.09 ? 1 : b.phase / 0.09)
    } else {
      em?.setValue('blink', 0)
    }
    // リップシンク: 再生中＆このキャラが話者のクリップがあれば口を動かす（alignmentは音声先頭基準）
    const st = useStore.getState()
    let v: ReturnType<typeof visemeAt> = null
    if (st.playing) {
      const hit = activeClipsAt(st.project.audioTrack, st.playTime)
        .find((a) => a.clip.speaker === char.name && a.clip.alignment)
      if (hit) v = visemeAt(hit.clip.alignment!, hit.tInClip)
    }
    const w = visemeWeights(v)
    em?.setValue('aa', w.aa)
    em?.setValue('ih', w.ih)
    em?.setValue('ou', w.ou)
    em?.setValue('ee', w.ee)
    em?.setValue('oh', w.oh)
    vrm.update(delta)
  })

  if (!vrm) return null
  return (
    <group
      name={char.id}
      position={[anim.position.x, anim.position.y, anim.position.z]}
      rotation={[0, anim.rotationY, 0]}
      userData={{ entityType: 'character', id: char.id }}
      onPointerDown={
        interactive
          ? (e) => { e.stopPropagation(); select({ type: 'character', id: char.id }) }
          : undefined
      }
    >
      {/* 姿勢補正（座りの沈み込み・横臥の回転）はキャラ本体の内側で行う */}
      <group position={[0, poseFix.yOffset, poseFix.zOffset]} rotation={[poseFix.rotX, 0, 0]}>
        <primitive object={vrm.scene} />
      </group>
    </group>
  )
}
