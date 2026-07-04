// カメラPOVレンダリングビュー（PIPプレビューとアニマティック再生で共用）
import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { CameraPose } from '../model/types'
import { applyPoseToCamera } from './poseUtils'
import { registerCaptureFn } from '../state/store'
import { SceneContent } from './SceneContent'

function PovRig({ getPose, aspect }: { getPose: () => CameraPose | null; aspect: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  useFrame(() => {
    const pose = getPose()
    if (pose) applyPoseToCamera(camera, pose, aspect)
  })
  return null
}

// ショットキャプチャ: 任意ポーズで同期レンダリングして dataURL を返す関数をstoreに登録。
// 既定はサムネイル用のJPEG 0.75（現行解像度）。opts で PNG・高解像度バッファを選べる
// （スタートフレーム書き出しは png/1920）。高解像度時は共有キャンバスを一時リサイズし、
// 撮影直後に元サイズへ復元する（R3Fの描画ループは次フレームで元解像度に戻る）。
function CaptureBridge({ enabled }: { enabled: boolean }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  useEffect(() => {
    if (!enabled) return
    registerCaptureFn((pose, ar, opts) => {
      const toUrl = () =>
        (opts?.format ?? 'jpeg') === 'png'
          ? gl.domElement.toDataURL('image/png')
          : gl.domElement.toDataURL('image/jpeg', 0.75)
      const bufW = opts?.bufferWidth
      if (bufW) {
        const prevSize = gl.getSize(new THREE.Vector2())
        const prevPr = gl.getPixelRatio()
        gl.setPixelRatio(1)
        gl.setSize(bufW, Math.round(bufW / ar), false)
        applyPoseToCamera(camera, pose, ar)
        gl.render(scene, camera)
        const url = toUrl()
        gl.setPixelRatio(prevPr)
        gl.setSize(prevSize.x, prevSize.y, false)
        return url
      }
      applyPoseToCamera(camera, pose, ar)
      gl.render(scene, camera)
      return toUrl()
    })
    return () => registerCaptureFn(null)
  }, [gl, scene, camera, enabled])
  return null
}

export interface CameraViewProps {
  getPose: () => CameraPose | null
  aspect: number
  width: number
  registerCapture?: boolean
  bufferWidth?: number // 内部解像度（動画書き出し用に高解像度化できる）
  testid?: string
}

export function CameraView({
  getPose, aspect, width, registerCapture = false, bufferWidth = 640, testid,
}: CameraViewProps) {
  const height = Math.round(width / aspect)
  const holder = useRef<HTMLDivElement>(null)
  return (
    <div ref={holder} style={{ width, height, position: 'relative' }} data-testid={testid}>
      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        dpr={Math.max(1, Math.min(4, bufferWidth / width))}
        camera={{ fov: 40, position: [0, 1.5, 4] }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <SceneContent />
        <PovRig getPose={getPose} aspect={aspect} />
        {registerCapture && <CaptureBridge enabled />}
      </Canvas>
    </div>
  )
}

// 三分割線・セーフエリアのSVGオーバーレイ（2D描画の方が確実）
export function FrameOverlay({ thirds, safe }: { thirds: boolean; safe: boolean }) {
  return (
    <svg className="grid-overlay" width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      {thirds && (
        <g stroke="rgba(255,255,255,0.28)" strokeWidth="0.3">
          <line x1="33.33" y1="0" x2="33.33" y2="100" />
          <line x1="66.67" y1="0" x2="66.67" y2="100" />
          <line x1="0" y1="33.33" x2="100" y2="33.33" />
          <line x1="0" y1="66.67" x2="100" y2="66.67" />
        </g>
      )}
      {safe && (
        <g stroke="rgba(255,210,77,0.5)" strokeWidth="0.35" fill="none">
          <rect x="5" y="5" width="90" height="90" />
          <rect x="10" y="10" width="80" height="80" strokeDasharray="2 1.5" />
        </g>
      )}
    </svg>
  )
}
