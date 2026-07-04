// 部屋・プロップ・キャラクターの3D表現。メインビューポート/PIP/アニマティックで共用
import React from 'react'
import { useStore } from '../state/store'
import { PROP_CATALOG } from '../model/defaults'
import type { Character, Prop } from '../model/types'
import { VRMAvatar, hasVrmBuffer } from './VRMAvatar'
import { EquipmentModel, hasEquipmentModel } from './EquipmentMesh'
import { TIME_OF_DAY_PRESETS } from '../core/lighting'
import { useCharAnimState } from './useCharAnimState'

// 体型ごとの横幅係数（V2: マネキンバリエーション）
const BODY_WIDTH: Record<string, number> = {
  average: 1.0, broad: 1.3, slim: 0.8, child: 0.9,
}

function Mannequin({ char, interactive }: { char: Character; interactive: boolean }) {
  const select = useStore((s) => s.select)
  const anim = useCharAnimState(char)
  const h = char.height
  const w = BODY_WIDTH[char.bodyType ?? 'average']
  const pose = anim.poseState
  const mat = <meshStandardMaterial color={char.color} roughness={0.7} />
  const headMat = <meshStandardMaterial color={char.color} roughness={0.6} />

  // 姿勢別の身体（poseMetricsの頭頂/目の高さと整合させる）
  let body: React.ReactNode
  if (pose === 'sit') {
    body = (
      <>
        {/* 胴体: 腰0.42h→肩0.65h */}
        <mesh position={[0, 0.53 * h, 0]} castShadow>
          <capsuleGeometry args={[0.15 * h * w, 0.22 * h, 6, 12]} />
          {mat}
        </mesh>
        {/* 太もも（前方へ） */}
        <mesh position={[0, 0.40 * h, 0.16 * h]} castShadow>
          <boxGeometry args={[0.26 * h * w, 0.09 * h, 0.36 * h]} />
          {mat}
        </mesh>
        {/* すね（垂直） */}
        <mesh position={[0, 0.2 * h, 0.3 * h]} castShadow>
          <boxGeometry args={[0.22 * h * w, 0.4 * h, 0.08 * h]} />
          {mat}
        </mesh>
        <mesh position={[0, 0.7 * h, 0]} castShadow>
          <sphereGeometry args={[0.1 * h, 16, 12]} />
          {headMat}
        </mesh>
        <mesh position={[0, 0.7 * h, 0.095 * h]}>
          <coneGeometry args={[0.03 * h, 0.06 * h, 8]} />
          {mat}
        </mesh>
      </>
    )
  } else if (pose === 'crouch') {
    body = (
      <>
        <mesh position={[0, 0.26 * h, 0.04 * h]} castShadow>
          <capsuleGeometry args={[0.17 * h * w, 0.2 * h, 6, 12]} />
          {mat}
        </mesh>
        <mesh position={[0, 0.48 * h, 0.06 * h]} castShadow>
          <sphereGeometry args={[0.1 * h, 16, 12]} />
          {headMat}
        </mesh>
        <mesh position={[0, 0.48 * h, 0.155 * h]}>
          <coneGeometry args={[0.03 * h, 0.06 * h, 8]} />
          {mat}
        </mesh>
      </>
    )
  } else if (pose === 'lie') {
    body = (
      <>
        {/* 仰向け: 体は前方(+Z)に伸びる。頭頂y≈0.17h相当の薄さ */}
        <mesh position={[0, 0.09 * h, -0.1 * h]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <capsuleGeometry args={[0.13 * h * w, 0.55 * h, 6, 12]} />
          {mat}
        </mesh>
        <mesh position={[0, 0.1 * h, 0.36 * h]} castShadow>
          <sphereGeometry args={[0.1 * h, 16, 12]} />
          {headMat}
        </mesh>
        {/* 鼻は上向き（仰向けの手がかり） */}
        <mesh position={[0, 0.19 * h, 0.36 * h]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.03 * h, 0.06 * h, 8]} />
          {mat}
        </mesh>
      </>
    )
  } else {
    body = (
      <>
        <mesh position={[0, 0.45 * h, 0]} castShadow>
          <capsuleGeometry args={[0.16 * h * w, 0.55 * h, 6, 12]} />
          {mat}
        </mesh>
        <mesh position={[0, 0.93 * h, 0]} castShadow>
          <sphereGeometry args={[0.105 * h, 16, 12]} />
          {headMat}
        </mesh>
        <mesh position={[0, 0.93 * h, 0.1 * h]}>
          <coneGeometry args={[0.03 * h, 0.06 * h, 8]} />
          {mat}
        </mesh>
      </>
    )
  }

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
      {body}
    </group>
  )
}

function PropMesh({ prop, interactive }: { prop: Prop; interactive: boolean }) {
  const select = useStore((s) => s.select)
  const def = PROP_CATALOG[prop.kind]
  const color = prop.color ?? def.color
  const isLight = def.lightDefault !== undefined && !hasEquipmentModel(prop.kind)
  const lightOn = (prop.lightOn ?? true) && isLight
  const li = lightOn ? (prop.lightIntensity ?? def.lightDefault ?? 0) : 0
  const { w, h, d } = def.size
  const y = (def.yOffset ?? 0) + (h * prop.scale.y) / 2
  return (
    <group
      name={prop.id}
      position={[prop.position.x, prop.position.y, prop.position.z]}
      rotation={[0, prop.rotationY, 0]}
      userData={{ entityType: 'prop', id: prop.id }}
      onPointerDown={
        interactive
          ? (e) => { e.stopPropagation(); select({ type: 'prop', id: prop.id }) }
          : undefined
      }
    >
      {hasEquipmentModel(prop.kind) ? (
        <EquipmentModel prop={prop} />
      ) : (
        <>
          <mesh position={[0, y, 0]} scale={[prop.scale.x, prop.scale.y, prop.scale.z]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial
              color={color}
              roughness={0.85}
              emissive={li > 0 ? color : prop.kind === 'tv' && (prop.lightOn ?? true) ? '#3a5a8c' : '#000000'}
              emissiveIntensity={li > 0 ? 0.3 + li * 0.12 : prop.kind === 'tv' && (prop.lightOn ?? true) ? 0.5 : 0}
            />
          </mesh>
          {li > 0 && (
            <pointLight position={[0, h * 0.9, 0]} intensity={li} distance={7} color={color} />
          )}
        </>
      )}
    </group>
  )
}

export function SceneContent({ interactive = false }: { interactive?: boolean }) {
  const room = useStore((s) => s.project.scene.room)
  const characters = useStore((s) => s.project.scene.characters)
  const props = useStore((s) => s.project.scene.props)
  const tod = useStore((s) => s.project.scene.timeOfDay ?? 'day')
  const preset = TIME_OF_DAY_PRESETS[tod]
  const halfW = room.width / 2
  const halfD = room.depth / 2
  const backZ = room.backWallZ ?? -halfD
  const sideX = room.sideWallX ?? -halfW

  return (
    <>
      <color attach="background" args={[preset.background]} />
      <ambientLight intensity={preset.ambient.intensity} color={preset.ambient.color} />
      <directionalLight
        position={preset.sun.position}
        intensity={preset.sun.intensity}
        color={preset.sun.color}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-camera-far={30}
      />
      {/* 床 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[room.width, room.depth]} />
        <meshStandardMaterial color={room.floorColor ?? '#23262d'} roughness={0.95} />
      </mesh>
      {/* 奥壁（Z位置可変） */}
      {room.showBackWall && (
        <mesh position={[0, room.wallHeight / 2, backZ]} receiveShadow>
          <boxGeometry args={[room.width, room.wallHeight, 0.08]} />
          <meshStandardMaterial color={room.wallColor ?? '#33373f'} roughness={0.9} />
        </mesh>
      )}
      {/* 横壁（X位置可変） */}
      {room.showSideWall && (
        <mesh position={[sideX, room.wallHeight / 2, 0]} receiveShadow>
          <boxGeometry args={[0.08, room.wallHeight, room.depth]} />
          <meshStandardMaterial color={room.wallColor ?? '#2e323a'} roughness={0.9} />
        </mesh>
      )}
      {props.map((p) => <PropMesh key={p.id} prop={p} interactive={interactive} />)}
      {characters.map((c) =>
        c.vrmFileName && hasVrmBuffer(c.id)
          ? <VRMAvatar key={c.id} char={c} interactive={interactive} />
          : <Mannequin key={c.id} char={c} interactive={interactive} />,
      )}
    </>
  )
}
