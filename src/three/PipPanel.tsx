// 右下PIPカメラプレビュー
import { useStore } from '../state/store'
import { aspectToNumber } from '../model/types'
import { CameraView, FrameOverlay } from './CameraView'
import { cameraHeightLabel, formatHeightLabel } from '../core/heightLabel'
import { eyeY } from '../core/poseMetrics'

export function PipPanel() {
  const cameras = useStore((s) => s.project.scene.cameras)
  const pipCameraId = useStore((s) => s.pipCameraId)
  const setPipCamera = useStore((s) => s.setPipCamera)
  const aspect = aspectToNumber(useStore((s) => s.project.aspect))
  const overlays = useStore((s) => s.overlays)
  const toggleOverlay = useStore((s) => s.toggleOverlay)
  const captureShot = useStore((s) => s.captureShot)
  const chars = useStore((s) => s.project.scene.characters)
  const cam = cameras.find((c) => c.id === pipCameraId) ?? cameras[0] ?? null

  const subjectEyeY = chars[0] ? eyeY(chars[0]) : undefined
  const label = cam ? formatHeightLabel(cameraHeightLabel(cam.pose, subjectEyeY)) : ''

  return (
    <div className="pip" data-testid="pip-panel">
      <div className="pip-header">
        <select
          value={cam?.id ?? ''}
          onChange={(e) => setPipCamera(e.target.value)}
          data-testid="pip-camera-select"
        >
          {cameras.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {cam ? `${Math.round(cam.pose.focalLength)}mm` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <button
          title="グリッド表示"
          className={overlays.thirds ? 'active' : ''}
          onClick={() => toggleOverlay('thirds')}
        >▦</button>
      </div>
      <div className="pip-frame">
        {cam ? (
          <>
            <CameraView
              getPose={() => {
                const st = useStore.getState()
                const c = st.project.scene.cameras.find((c) => c.id === (st.pipCameraId ?? ''))
                  ?? st.project.scene.cameras[0]
                return c ? c.pose : null
              }}
              aspect={aspect}
              width={382}
              registerCapture
              testid="pip-canvas"
            />
            <FrameOverlay thirds={overlays.thirds} safe={overlays.safe} />
          </>
        ) : (
          <div className="hint">カメラを追加するとプレビューが表示されます</div>
        )}
      </div>
      <div className="pip-footer">
        <span data-testid="height-label">{label}</span>
        <button className="capture-btn" onClick={captureShot} disabled={!cam} data-testid="capture-shot">
          ● ショットをキャプチャ
        </button>
      </div>
    </div>
  )
}
