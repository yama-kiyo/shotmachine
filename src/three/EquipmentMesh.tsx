// 撮影機材の3Dモデル（簡易モデリング）。照明機材は実際に発光し光量調整できる
// 各モデルは床原点・前方+Z。サイズはPROP_CATALOGのフットプリントに概ね合わせる
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Prop, PropKind } from '../model/types'
import { PROP_CATALOG } from '../model/defaults'

const METAL = '#3a3f47'
const METAL_LIGHT = '#5a616b'

function Metal({ color = METAL }: { color?: string }) {
  return <meshStandardMaterial color={color} roughness={0.5} metalness={0.6} />
}

// 三脚の脚（topYの一点から角度をつけて3本おろす）
function TripodLegs({ topY, spread, thickness = 0.018 }: { topY: number; spread: number; thickness?: number }) {
  const phi = Math.atan2(spread, topY)
  const legLen = Math.sqrt(topY * topY + spread * spread)
  return (
    <>
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a) => (
        <group key={a} position={[0, topY, 0]} rotation={[0, a, 0]}>
          <group rotation={[phi, 0, 0]}>
            <mesh position={[0, -legLen / 2, 0]} castShadow>
              <cylinderGeometry args={[thickness, thickness, legLen, 6]} />
              <Metal />
            </mesh>
          </group>
        </group>
      ))}
    </>
  )
}

// 前方(+Z)へ向けたスポットライト（targetを自前で管理）
function AimedSpot({ y, intensity, color, angle, penumbra = 0.5 }: {
  y: number; intensity: number; color: string; angle: number; penumbra?: number
}) {
  const light = useRef<THREE.SpotLight>(null)
  const target = useRef<THREE.Object3D>(null)
  // 消灯→点灯の再マウント後もtargetを結び直すため、intensityを依存に含める
  useEffect(() => {
    if (light.current && target.current) {
      light.current.target = target.current
    }
  }, [intensity, y])
  if (intensity <= 0) return null
  return (
    <>
      <spotLight
        ref={light} position={[0, y, 0.12]} intensity={intensity * 2}
        color={color} angle={angle} penumbra={penumbra} distance={10} decay={1.2}
      />
      <object3D ref={target} position={[0, Math.max(0.2, y - 0.9), 3]} />
    </>
  )
}

interface ModelProps {
  color: string // メインカラー（prop.color ?? カタログ色）
  lightColor: string
  li: number // 光量 0〜10（消灯時 0）
}

// ライト+スタンド（フレネル風ヘッド）
function LightStandModel({ color, lightColor, li }: ModelProps) {
  const glow = li > 0
  return (
    <>
      <TripodLegs topY={0.45} spread={0.3} />
      <mesh position={[0, 1.05, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 1.5, 8]} />
        <Metal />
      </mesh>
      {/* ヘッド本体（前方+Zへ向いた円筒） */}
      <group position={[0, 1.88, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.15, 0.3, 12]} />
          <Metal color={METAL_LIGHT} />
        </mesh>
        {/* 発光面（レンズ） */}
        <mesh position={[0, 0, 0.16]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.105, 0.105, 0.02, 12]} />
          <meshStandardMaterial
            color={color} emissive={glow ? lightColor : '#000000'}
            emissiveIntensity={glow ? 1.2 + li * 0.25 : 0}
          />
        </mesh>
        {/* バーンドア */}
        <mesh position={[0, 0.16, 0.1]} rotation={[-0.5, 0, 0]} castShadow>
          <boxGeometry args={[0.26, 0.14, 0.01]} />
          <Metal />
        </mesh>
        <mesh position={[0, -0.16, 0.1]} rotation={[0.5, 0, 0]} castShadow>
          <boxGeometry args={[0.26, 0.14, 0.01]} />
          <Metal />
        </mesh>
      </group>
      <AimedSpot y={1.88} intensity={li} color={lightColor} angle={0.55} penumbra={0.35} />
    </>
  )
}

// LEDパネル
function LedPanelModel({ color, lightColor, li }: ModelProps) {
  const glow = li > 0
  return (
    <>
      <TripodLegs topY={0.4} spread={0.28} />
      <mesh position={[0, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 1.1, 8]} />
        <Metal />
      </mesh>
      <group position={[0, 1.45, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.66, 0.42, 0.06]} />
          <Metal color={METAL_LIGHT} />
        </mesh>
        <mesh position={[0, 0, 0.035]}>
          <boxGeometry args={[0.6, 0.36, 0.01]} />
          <meshStandardMaterial
            color={color} emissive={glow ? lightColor : '#000000'}
            emissiveIntensity={glow ? 1.0 + li * 0.22 : 0}
          />
        </mesh>
      </group>
      <AimedSpot y={1.45} intensity={li * 0.8} color={lightColor} angle={0.85} penumbra={0.8} />
    </>
  )
}

// ソフトボックス（後方すぼまりの四角錐＋ディフューザー面）
function SoftboxModel({ color, lightColor, li }: ModelProps) {
  const glow = li > 0
  return (
    <>
      <TripodLegs topY={0.45} spread={0.32} />
      <mesh position={[0, 1.0, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 1.3, 8]} />
        <Metal />
      </mesh>
      <group position={[0, 1.6, 0]}>
        {/* 箱本体: 4角錐（前が広い）。coneを90°倒して45°ロール */}
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} position={[0, 0, -0.18]} castShadow>
          <coneGeometry args={[0.62, 0.55, 4]} />
          <meshStandardMaterial color="#1d1f24" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        {/* ディフューザー発光面 */}
        <mesh position={[0, 0, 0.1]}>
          <boxGeometry args={[0.82, 0.82, 0.015]} />
          <meshStandardMaterial
            color={color} emissive={glow ? lightColor : '#000000'}
            emissiveIntensity={glow ? 0.9 + li * 0.2 : 0}
          />
        </mesh>
      </group>
      <AimedSpot y={1.6} intensity={li} color={lightColor} angle={0.95} penumbra={0.9} />
    </>
  )
}

// Cスタンド（ポール＋水平アーム）
function CStandModel({ color }: ModelProps) {
  return (
    <>
      <TripodLegs topY={0.4} spread={0.3} thickness={0.02} />
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 1.5, 8]} />
        <Metal />
      </mesh>
      {/* グリップヘッド＋アーム */}
      <mesh position={[0, 1.68, 0]} castShadow>
        <sphereGeometry args={[0.04, 8, 8]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0.3, 1.68, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 0.7, 6]} />
        <Metal />
      </mesh>
    </>
  )
}

// フラッグ（旗布＝遮光板）
function FlagModel({ color }: ModelProps) {
  return (
    <>
      <TripodLegs topY={0.4} spread={0.28} thickness={0.018} />
      <mesh position={[0, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 1.2, 8]} />
        <Metal />
      </mesh>
      {/* 枠＋布 */}
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.74, 0.6, 0.015]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.25, 0]}>
        <boxGeometry args={[0.78, 0.64, 0.012]} />
        <Metal />
      </mesh>
    </>
  )
}

// レフ板
function ReflectorModel({ color }: ModelProps) {
  return (
    <>
      <TripodLegs topY={0.38} spread={0.26} thickness={0.016} />
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.015, 0.015, 0.85, 8]} />
        <Metal />
      </mesh>
      {/* 円形パネル（少し上向きに傾ける） */}
      <group position={[0, 1.1, 0]} rotation={[-0.25, 0, 0]}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.02, 24]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.15} />
        </mesh>
      </group>
    </>
  )
}

// ドリー（台車＋押し棒＋車輪）
function DollyModel({ color }: ModelProps) {
  const wheel = (x: number, z: number) => (
    <mesh key={`${x}${z}`} position={[x, 0.09, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[0.09, 0.09, 0.05, 12]} />
      <meshStandardMaterial color="#16181c" roughness={0.7} />
    </mesh>
  )
  return (
    <>
      {/* プラットフォーム */}
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[0.66, 0.08, 0.96]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.3} />
      </mesh>
      {wheel(0.28, 0.4)}{wheel(-0.28, 0.4)}{wheel(0.28, -0.4)}{wheel(-0.28, -0.4)}
      {/* カメラマウント柱 */}
      <mesh position={[0, 0.45, 0.15]} castShadow>
        <cylinderGeometry args={[0.045, 0.06, 0.4, 10]} />
        <Metal color={METAL_LIGHT} />
      </mesh>
      <mesh position={[0, 0.67, 0.15]} castShadow>
        <boxGeometry args={[0.16, 0.05, 0.16]} />
        <Metal />
      </mesh>
      {/* 押し棒（後方） */}
      <group position={[0, 0.26, -0.46]} rotation={[0.5, 0, 0]}>
        <mesh position={[0, 0.3, 0]} castShadow>
          <cylinderGeometry args={[0.015, 0.015, 0.6, 6]} />
          <Metal />
        </mesh>
        <mesh position={[0, 0.6, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.015, 0.015, 0.4, 6]} />
          <Metal />
        </mesh>
      </group>
    </>
  )
}

// ドリーレール（2本のレール＋枕木）
function DollyRailModel({ color }: ModelProps) {
  return (
    <>
      {[-0.17, 0.17].map((x) => (
        <mesh key={x} position={[x, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 2.95, 10]} />
          <meshStandardMaterial color={color} roughness={0.45} metalness={0.5} />
        </mesh>
      ))}
      {[-1.3, -0.65, 0, 0.65, 1.3].map((z) => (
        <mesh key={z} position={[0, 0.045, z]} castShadow>
          <boxGeometry args={[0.46, 0.05, 0.09]} />
          <meshStandardMaterial color="#2c3038" roughness={0.85} />
        </mesh>
      ))}
    </>
  )
}

// 三脚（カメラ用）
function TripodModel({ color }: ModelProps) {
  return (
    <>
      <TripodLegs topY={1.3} spread={0.42} thickness={0.02} />
      {/* 雲台 */}
      <mesh position={[0, 1.35, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 0.1, 10]} />
        <Metal color={color} />
      </mesh>
      <mesh position={[0, 1.43, 0]} castShadow>
        <boxGeometry args={[0.14, 0.05, 0.18]} />
        <Metal color={METAL_LIGHT} />
      </mesh>
      {/* パン棒 */}
      <group position={[0.05, 1.4, -0.08]} rotation={[-0.7, 0, 0]}>
        <mesh position={[0, -0.18, 0]} castShadow>
          <cylinderGeometry args={[0.01, 0.01, 0.36, 6]} />
          <Metal />
        </mesh>
      </group>
    </>
  )
}

// モニター（スタンド付き・画面が淡く発光）
function MonitorModel({ color, li }: ModelProps) {
  const glow = li > 0
  return (
    <>
      <TripodLegs topY={0.4} spread={0.3} thickness={0.018} />
      <mesh position={[0, 0.75, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.018, 0.9, 8]} />
        <Metal />
      </mesh>
      <group position={[0, 1.18, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.6, 0.4, 0.06]} />
          <meshStandardMaterial color={color} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, 0.035]}>
          <boxGeometry args={[0.54, 0.34, 0.01]} />
          <meshStandardMaterial
            color="#0e1420" emissive={glow ? '#3a5a8c' : '#000000'}
            emissiveIntensity={glow ? 0.8 : 0}
          />
        </mesh>
      </group>
    </>
  )
}

const MODELS: Partial<Record<PropKind, (p: ModelProps) => JSX.Element>> = {
  lightstand: LightStandModel,
  ledpanel: LedPanelModel,
  softbox: SoftboxModel,
  cstand: CStandModel,
  flag: FlagModel,
  reflector: ReflectorModel,
  dolly: DollyModel,
  dollyrail: DollyRailModel,
  tripod: TripodModel,
  monitor: MonitorModel,
}

export const hasEquipmentModel = (kind: PropKind): boolean => kind in MODELS

// 機材モデル本体。グループの位置・回転・選択ハンドラは呼び出し側（SceneContent）が持つ
export function EquipmentModel({ prop }: { prop: Prop }) {
  const def = PROP_CATALOG[prop.kind]
  const Model = MODELS[prop.kind]
  if (!Model) return null
  const color = prop.color ?? def.color
  const on = prop.lightOn ?? true
  const li = on && def.lightDefault !== undefined ? (prop.lightIntensity ?? def.lightDefault) : 0
  // モニターは消灯設定がない限り常時点灯扱い（光は放たない）
  const liEff = prop.kind === 'monitor' ? ((prop.lightOn ?? true) ? 5 : 0) : li
  return (
    <group scale={[prop.scale.x, prop.scale.y, prop.scale.z]}>
      <Model color={color} lightColor={color} li={liEff} />
    </group>
  )
}
