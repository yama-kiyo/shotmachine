// 部屋・プロップ・キャラクターの3D表現。メインビューポート/PIP/アニマティックで共用
import { useStore } from '../state/store'
import { PROP_CATALOG } from '../model/defaults'
import type { Character, Prop } from '../model/types'

function Mannequin({ char, interactive }: { char: Character; interactive: boolean }) {
  const select = useStore((s) => s.select)
  const h = char.height
  return (
    <group
      name={char.id}
      position={[char.position.x, char.position.y, char.position.z]}
      rotation={[0, char.rotationY, 0]}
      userData={{ entityType: 'character', id: char.id }}
      onPointerDown={
        interactive
          ? (e) => { e.stopPropagation(); select({ type: 'character', id: char.id }) }
          : undefined
      }
    >
      {/* 胴体（カプセル）: 足元から肩まで */}
      <mesh position={[0, 0.45 * h, 0]} castShadow>
        <capsuleGeometry args={[0.16 * h, 0.55 * h, 6, 12]} />
        <meshStandardMaterial color={char.color} roughness={0.7} />
      </mesh>
      {/* 頭 */}
      <mesh position={[0, 0.93 * h, 0]} castShadow>
        <sphereGeometry args={[0.105 * h, 16, 12]} />
        <meshStandardMaterial color={char.color} roughness={0.6} />
      </mesh>
      {/* 鼻先（向きの手がかり） */}
      <mesh position={[0, 0.93 * h, 0.1 * h]}>
        <coneGeometry args={[0.03 * h, 0.06 * h, 8]} />
        <meshStandardMaterial color={char.color} roughness={0.5} />
      </mesh>
    </group>
  )
}

function PropMesh({ prop, interactive }: { prop: Prop; interactive: boolean }) {
  const select = useStore((s) => s.select)
  const def = PROP_CATALOG[prop.kind]
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
      <mesh position={[0, y, 0]} scale={[prop.scale.x, prop.scale.y, prop.scale.z]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={def.color}
          roughness={0.85}
          emissive={prop.kind === 'lamp' || prop.kind === 'light' ? def.color : '#000000'}
          emissiveIntensity={prop.kind === 'lamp' || prop.kind === 'light' ? 0.6 : 0}
        />
      </mesh>
      {(prop.kind === 'lamp' || prop.kind === 'light') && (
        <pointLight position={[0, h * 0.9, 0]} intensity={4} distance={6} color="#ffe3b0" />
      )}
    </group>
  )
}

export function SceneContent({ interactive = false }: { interactive?: boolean }) {
  const room = useStore((s) => s.project.scene.room)
  const characters = useStore((s) => s.project.scene.characters)
  const props = useStore((s) => s.project.scene.props)
  const halfW = room.width / 2
  const halfD = room.depth / 2

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 8, 5]} intensity={1.1} castShadow />
      {/* 床 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[room.width, room.depth]} />
        <meshStandardMaterial color="#23262d" roughness={0.95} />
      </mesh>
      {/* 奥壁（-Z） */}
      {room.showBackWall && (
        <mesh position={[0, room.wallHeight / 2, -halfD]} receiveShadow>
          <boxGeometry args={[room.width, room.wallHeight, 0.08]} />
          <meshStandardMaterial color="#33373f" roughness={0.9} />
        </mesh>
      )}
      {/* 横壁（-X） */}
      {room.showSideWall && (
        <mesh position={[-halfW, room.wallHeight / 2, 0]} receiveShadow>
          <boxGeometry args={[0.08, room.wallHeight, room.depth]} />
          <meshStandardMaterial color="#2e323a" roughness={0.9} />
        </mesh>
      )}
      {props.map((p) => <PropMesh key={p.id} prop={p} interactive={interactive} />)}
      {characters.map((c) => <Mannequin key={c.id} char={c} interactive={interactive} />)}
    </>
  )
}
