import { useEffect } from 'react'
import { useStore } from './state/store'
import { TopBar } from './ui/TopBar'
import { LeftPanel } from './ui/LeftPanel'
import { RightPanel } from './ui/RightPanel'
import { BottomPanel } from './ui/BottomPanel'
import { MainViewport } from './three/MainViewport'
import { PipPanel } from './three/PipPanel'

function MoveSlider() {
  const st = useStore()
  const camId = st.selection?.type === 'camera' ? st.selection.id : st.pipCameraId
  const cam = st.project.scene.cameras.find((c) => c.id === camId)
  if (!cam?.poseA || !cam.poseB) return null
  return (
    <div className="move-slider-wrap" data-testid="move-slider">
      <span className="ab a">A</span>
      <input
        type="range" min={0} max={1} step={0.01}
        value={st.moveSlider}
        onChange={(e) => st.setMoveSlider(parseFloat(e.target.value))}
      />
      <span className="ab b">B</span>
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Math.round(st.moveSlider * 100)}%</span>
    </div>
  )
}

function Toast() {
  const toast = useStore((s) => s.toast)
  const setToast = useStore((s) => s.setToast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast, setToast])
  if (!toast) return null
  return <div className="toast" data-testid="toast">{toast}</div>
}

export default function App() {
  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <LeftPanel />
        <div className="viewport-wrap">
          <MainViewport />
          <MoveSlider />
          <PipPanel />
          <Toast />
        </div>
        <RightPanel />
      </div>
      <BottomPanel />
    </div>
  )
}
