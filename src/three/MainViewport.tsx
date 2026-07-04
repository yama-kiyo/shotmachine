// メイン3Dビューポート: 編集用の俯瞰ビュー（3D/Top切替）＋ギズモ＋各種オーバーレイ
import { useRef, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, TransformControls, Line, Html, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useStore, selectAxisStatus } from '../state/store'
import { aspectToNumber } from '../model/types'
import type { CameraRig } from '../model/types'
import { frustumCorners } from './poseUtils'
import { SceneContent } from './SceneContent'
import { eyeY } from '../core/poseMetrics'
import { charStateAt } from '../core/charAnim'

function CameraGizmo({ cam, status }: { cam: CameraRig; status: 'ok' | 'crossed' | 'on-line' | undefined }) {
  const select = useStore((s) => s.select)
  const selection = useStore((s) => s.selection)
  const aspect = aspectToNumber(useStore((s) => s.project.aspect))
  const labels = useStore((s) => s.overlays.labels)
  const isSelected = selection?.type === 'camera' && selection.id === cam.id
  const color = status === 'crossed' ? '#ff4444' : isSelected ? '#4da3ff' : '#7f93ab'
  const dist = isSelected ? 2.2 : 1.2
  const corners = useMemo(
    () => frustumCorners(cam.pose, aspect, dist).map((v) => [v.x, v.y, v.z] as [number, number, number]),
    [cam.pose, aspect, dist],
  )
  const p: [number, number, number] = [cam.pose.position.x, cam.pose.position.y, cam.pose.position.z]
  const framePoints = [...corners, corners[0]]
  return (
    <group>
      {/* カメラ本体（ギズモのアタッチ対象。name=cam.id） */}
      <group name={cam.id} position={p} userData={{ entityType: 'camera', id: cam.id }}>
        <mesh
          onPointerDown={(e) => { e.stopPropagation(); select({ type: 'camera', id: cam.id }) }}
        >
          <boxGeometry args={[0.22, 0.18, 0.3]} />
          <meshStandardMaterial color={color} />
        </mesh>
        {labels && (
          <Html position={[0, 0.28, 0]} center style={{ pointerEvents: 'none' }}>
            <div style={{
              color: status === 'crossed' ? '#ff6666' : '#cfe3ff', fontSize: 11, fontWeight: 700,
              whiteSpace: 'nowrap', textShadow: '0 0 4px #000',
            }}>
              {status === 'crossed' ? '⚠ ' : ''}{cam.name} {Math.round(cam.pose.focalLength)}mm
            </div>
          </Html>
        )}
      </group>
      {/* フラスタム */}
      {corners.map((c, i) => (
        <Line key={i} points={[p, c]} color={color} lineWidth={1} transparent opacity={isSelected ? 0.9 : 0.4} />
      ))}
      <Line points={framePoints} color={color} lineWidth={1} transparent opacity={isSelected ? 0.9 : 0.4} />
      {/* 視線（注視点まで） */}
      <Line
        points={[p, [cam.pose.lookAt.x, cam.pose.lookAt.y, cam.pose.lookAt.z]]}
        color={color} lineWidth={1} dashed dashSize={0.12} gapSize={0.08} transparent opacity={0.5}
      />
    </group>
  )
}

function AxisOverlay() {
  const axis = useStore((s) => s.project.axis)
  const chars = useStore((s) => s.project.scene.characters)
  const show = useStore((s) => s.overlays.axis180)
  const statuses = useStore(useShallow(selectAxisStatus))
  if (!show || !axis) return null
  const a = chars.find((c) => c.id === axis.charAId)
  const b = chars.find((c) => c.id === axis.charBId)
  if (!a || !b) return null
  const anyCrossed = Object.values(statuses).includes('crossed')
  const color = anyCrossed ? '#ff4444' : '#46d1c8'
  // ラインをキャラ間の延長込みで描く
  const dir = new THREE.Vector3(b.position.x - a.position.x, 0, b.position.z - a.position.z).normalize()
  const ext = 1.5
  const p1: [number, number, number] = [a.position.x - dir.x * ext, 0.03, a.position.z - dir.z * ext]
  const p2: [number, number, number] = [b.position.x + dir.x * ext, 0.03, b.position.z + dir.z * ext]
  return (
    <Line points={[p1, p2]} color={color} lineWidth={2} dashed dashSize={0.25} gapSize={0.15} />
  )
}

function EyelinesOverlay() {
  const chars = useStore((s) => s.project.scene.characters)
  const show = useStore((s) => s.overlays.eyelines)
  if (!show) return null
  return (
    <>
      {chars.map((c) => {
        const ey = eyeY(c)
        const fx = Math.sin(c.rotationY)
        const fz = Math.cos(c.rotationY)
        return (
          <Line
            key={c.id}
            points={[
              [c.position.x, ey, c.position.z],
              [c.position.x + fx * 1.6, ey, c.position.z + fz * 1.6],
            ]}
            color={c.color} lineWidth={1.5} dashed dashSize={0.1} gapSize={0.07}
          />
        )
      })}
    </>
  )
}

// キーフレームを持つキャラのモーションパス（KF位置を順に結ぶ折れ線＋各KFマーカー
// ＋再生ヘッド時刻に最も近いKFの強調＋現在の内挿位置ヘッド）
function CharKfPath({ char, playTime }: { char: import('../model/types').Character; playTime: number }) {
  const kfs = char.keyframes
  if (!kfs?.length) return null
  const pts = kfs.map((k) => [k.position.x, 0.05, k.position.z] as [number, number, number])
  // 再生ヘッドに最も近いKF
  let nearest = 0
  let best = Infinity
  kfs.forEach((k, i) => { const d = Math.abs(k.time - playTime); if (d < best) { best = d; nearest = i } })
  const head = charStateAt(char, playTime).position
  return (
    <group>
      {pts.length >= 2 && <Line points={pts} color={char.color} lineWidth={2} />}
      {kfs.map((k, i) => (
        <mesh key={i} position={[k.position.x, 0.06, k.position.z]}>
          <sphereGeometry args={[i === nearest ? 0.09 : 0.06, 12, 8]} />
          <meshBasicMaterial color={char.color} transparent opacity={i === nearest ? 1 : 0.6} />
        </mesh>
      ))}
      {/* 現在時刻の内挿位置ヘッド */}
      <mesh position={[head.x, 0.08, head.z]}>
        <sphereGeometry args={[0.07, 12, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}

function PathsOverlay() {
  const chars = useStore((s) => s.project.scene.characters)
  const cams = useStore((s) => s.project.scene.cameras)
  const show = useStore((s) => s.overlays.paths)
  const playTime = useStore((s) => s.playTime)
  if (!show) return null
  return (
    <>
      {/* KFありは折れ線パス、KFなしで pathB ありは従来の2点直線 */}
      {chars.map((c) =>
        (c.keyframes?.length ?? 0) > 0
          ? <CharKfPath key={c.id} char={c} playTime={playTime} />
          : c.pathB
            ? (
              <Line
                key={c.id}
                points={[
                  [c.pathB.x, 0.05, c.pathB.z],
                  [c.position.x, 0.05, c.position.z],
                ]}
                color={c.color} lineWidth={2}
              />
            )
            : null,
      )}
      {cams.filter((c) => c.poseA && c.poseB).map((c) => (
        <Line
          key={c.id}
          points={[
            [c.poseA!.position.x, c.poseA!.position.y, c.poseA!.position.z],
            [c.poseB!.position.x, c.poseB!.position.y, c.poseB!.position.z],
          ]}
          color="#ffd24d" lineWidth={2} dashed dashSize={0.15} gapSize={0.1}
        />
      ))}
    </>
  )
}

// 選択エンティティへのTransformControlsアタッチと書き戻し。
// キャラ移動は「KF書き込みモード」判定付き: autokey ON、または再生ヘッドが既存KF上(±0.05s)なら
// 静的position更新ではなくその時刻のKFへ書き込む。ドラッグ全体を1 Undo にまとめる。
function SelectionGizmo() {
  const selection = useStore((s) => s.selection)
  const gizmoMode = useStore((s) => s.gizmoMode)
  const scene = useThree((s) => s.scene)
  const objRef = useRef<THREE.Object3D | null>(null)
  const kfModeRef = useRef(false) // ドラッグ開始時に確定するKF書き込みモード
  const target = selection ? scene.getObjectByName(selection.id) ?? null : null
  objRef.current = target
  if (!target || !selection) return null
  const isCamera = selection.type === 'camera'
  const mode = isCamera ? 'translate' : gizmoMode
  return (
    <TransformControls
      object={target}
      mode={mode}
      size={0.7}
      showX={mode === 'rotate' ? false : true}
      showZ={mode === 'rotate' ? false : true}
      showY={mode === 'rotate' ? true : true}
      onMouseDown={() => {
        const st = useStore.getState()
        if (selection.type === 'character') {
          const c = st.project.scene.characters.find((c) => c.id === selection.id)
          const t = Math.round(st.playTime * 100) / 100
          const onKf = c?.keyframes?.some((k) => Math.abs(k.time - t) <= 0.05) ?? false
          kfModeRef.current = st.autokey || onKf
        } else {
          kfModeRef.current = false
        }
        // KF書き込みモードのみ1ドラッグ=1 Undo にまとめる。通常のposition更新は従来どおり
        if (kfModeRef.current) st.beginTimelineDrag()
      }}
      onMouseUp={() => { if (kfModeRef.current) useStore.getState().endTimelineDrag() }}
      onObjectChange={() => {
        const o = objRef.current
        if (!o) return
        const st = useStore.getState()
        if (selection.type === 'character') {
          const patch = { position: { x: o.position.x, y: o.position.y, z: o.position.z }, rotationY: o.rotation.y }
          if (kfModeRef.current) st.writeCharKeyframeFromGizmo(selection.id, patch)
          else st.updateCharacter(selection.id, patch)
        } else if (selection.type === 'prop') {
          st.updateProp(selection.id, {
            position: { x: o.position.x, y: o.position.y, z: o.position.z },
            rotationY: o.rotation.y,
          })
        } else {
          st.updateCameraPose(selection.id, {
            position: { x: o.position.x, y: o.position.y, z: o.position.z },
          })
        }
      }}
    />
  )
}

// 3D/Top切替: カメラ位置とコントロール制約を切り替え
function ViewControls() {
  const viewMode = useStore((s) => s.viewMode)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    if (viewMode === 'top') {
      camera.position.set(0, 14, 0.01)
      camera.lookAt(0, 0, 0)
    } else {
      camera.position.set(5.5, 4.5, 6.5)
      camera.lookAt(0, 0.8, 0)
    }
  }, [viewMode, camera])
  return (
    <OrbitControls
      makeDefault
      enableRotate={viewMode === '3d'}
      enableDamping={false}
      maxPolarAngle={Math.PI / 2 - 0.02}
      target={[0, 0.8, 0]}
    />
  )
}

export function MainViewport() {
  const cameras = useStore((s) => s.project.scene.cameras)
  const statuses = useStore(useShallow(selectAxisStatus))
  const select = useStore((s) => s.select)
  return (
    <Canvas
      shadows
      camera={{ position: [5.5, 4.5, 6.5], fov: 50 }}
      onPointerMissed={() => select(null)}
      style={{ position: 'absolute', inset: 0 }}
      data-testid="main-viewport"
    >
      <Grid
        args={[30, 30]} position={[0, 0.01, 0]} cellSize={0.5} cellColor="#262a31"
        sectionSize={2} sectionColor="#343a44" fadeDistance={28} infiniteGrid
      />
      <SceneContent interactive />
      {cameras.map((c) => <CameraGizmo key={c.id} cam={c} status={statuses[c.id]} />)}
      <AxisOverlay />
      <EyelinesOverlay />
      <PathsOverlay />
      <SelectionGizmo />
      <ViewControls />
    </Canvas>
  )
}
