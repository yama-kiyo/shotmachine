import { useEffect, useRef, useState } from 'react'
import { useStore, totalAnimaticDuration } from '../state/store'
import { aspectToNumber } from '../model/types'
import type { CameraPose } from '../model/types'
import { lerpPose } from '../core/interpolate'
import { secondsToTimecode } from '../core/timecode'
import { shotNumber } from '../core/promptGen'
import { CameraView, FrameOverlay } from '../three/CameraView'
import { SceneChat } from './SceneChat'

function ShotsTab() {
  const shots = useStore((s) => s.project.shots)
  const selectedShotId = useStore((s) => s.selectedShotId)
  const selectShot = useStore((s) => s.selectShot)
  if (!shots.length) {
    return (
      <div className="hint" data-testid="shots-empty">
        まだショットがありません — カメラプレビューでフレームを決めて「● ショットをキャプチャ」を押してください。
      </div>
    )
  }
  return (
    <div className="shots-strip" data-testid="shots-strip">
      {shots.map((s, i) => (
        <div
          key={s.id}
          className={`shot-card ${selectedShotId === s.id ? 'selected' : ''}`}
          onClick={() => selectShot(s.id)}
          data-testid={`shot-card-${i}`}
        >
          <img src={s.thumbnail} />
          <div className="meta">
            <span className="num">{shotNumber(i)}</span>
            <span>{s.shotSize ?? '—'} · {Math.round(s.focalLength)}mm</span>
            <span>{s.moveType !== 'Static' ? '⇢' : ''} {s.durationSec}s</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function BoardTab() {
  const shots = useStore((s) => s.project.shots)
  const slugline = useStore((s) => s.project.slugline)
  if (!shots.length) return <div className="hint">ショットをキャプチャするとストーリーボードが表示されます。</div>
  const MOVE_GLYPHS: Record<string, string> = {
    Pan: 'PAN →', Tilt: 'TILT ↑', 'Push-in': '', 'Pull-out': '', Zoom: '',
    'Truck L': '← TRUCK', 'Truck R': 'TRUCK →', 'Pedestal Up': 'PED ↑', 'Pedestal Down': 'PED ↓',
    Arc: 'ARC ⟳', Compound: 'A → B',
  }
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>{slugline}</div>
      <div className="board-grid" data-testid="board-grid">
        {shots.map((s, i) => (
          <div className="board-panel" key={s.id}>
            <div className="frame">
              <img src={s.thumbnail} />
              {(s.moveType === 'Push-in' || s.moveType === 'Pull-out' || s.moveType === 'Zoom') && (
                <div className="start-frame" style={{ inset: '15%' }} />
              )}
              {s.moveType !== 'Static' && (
                <div className="move-arrow" style={{ alignItems: 'flex-start', justifyContent: 'flex-start', padding: 8, fontSize: 14 }}>
                  {MOVE_GLYPHS[s.moveType] || s.moveType.toUpperCase()}
                </div>
              )}
            </div>
            <div className="info">
              <div className="head">
                <span>{shotNumber(i)}</span>
                <span>{s.shotSize ?? '—'}</span>
                <span>{Math.round(s.focalLength)}mm</span>
                <span>{s.moveType}</span>
                <span>{s.durationSec}s</span>
              </div>
              <div className="notes">
                {s.notes.action && <>ACTION: {s.notes.action}{'\n'}</>}
                {s.notes.camera && <>NOTES: {s.notes.camera}</>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// 再生時間からアニマティックのカメラポーズを解決
function animaticPoseAt(): CameraPose | null {
  const st = useStore.getState()
  const shots = st.project.shots
  if (!shots.length) return null
  let t = st.playTime
  for (const s of shots) {
    if (t <= s.durationSec) {
      const { a, b } = s.poseSnapshot
      return b ? lerpPose(a, b, t / Math.max(s.durationSec, 0.001)) : a
    }
    t -= s.durationSec
  }
  const last = shots[shots.length - 1]
  return last.poseSnapshot.b ?? last.poseSnapshot.a
}

function AnimaticTab() {
  const shots = useStore((s) => s.project.shots)
  const aspect = aspectToNumber(useStore((s) => s.project.aspect))
  const playTime = useStore((s) => s.playTime)
  const overlays = useStore((s) => s.overlays)
  if (!shots.length) return <div className="hint">ショットをキャプチャするとアニマティックを再生できます。</div>
  // 現在のショット番号
  let t = playTime, idx = 0
  for (let i = 0; i < shots.length; i++) {
    if (t <= shots[i].durationSec) { idx = i; break }
    t -= shots[i].durationSec
    idx = i
  }
  const height = 158
  const width = Math.round(height * aspect)
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }} data-testid="animatic-view">
      <div style={{ position: 'relative' }}>
        <CameraView getPose={animaticPoseAt} aspect={aspect} width={width} />
        <FrameOverlay thirds={overlays.thirds} safe={overlays.safe} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 700 }}>
          Shot {shotNumber(idx)} / {shots.length}ショット
        </div>
        <div>{shots[idx].cameraName} · {shots[idx].shotSize ?? '—'} · {Math.round(shots[idx].focalLength)}mm · {shots[idx].moveType}</div>
        {shots[idx].notes.action && <div style={{ marginTop: 4 }}>ACTION: {shots[idx].notes.action}</div>}
        <div style={{ marginTop: 8 }}>下の再生バーで再生・シークできます。</div>
      </div>
    </div>
  )
}

export function PlaybackBar() {
  const playing = useStore((s) => s.playing)
  const setPlaying = useStore((s) => s.setPlaying)
  const playTime = useStore((s) => s.playTime)
  const setPlayTime = useStore((s) => s.setPlayTime)
  const total = useStore(totalAnimaticDuration)
  const setBottomTab = useStore((s) => s.setBottomTab)
  const raf = useRef<number>(0)
  const lastTs = useRef<number>(0)

  useEffect(() => {
    if (!playing) return
    lastTs.current = performance.now()
    const tick = (ts: number) => {
      const dt = (ts - lastTs.current) / 1000
      lastTs.current = ts
      const st = useStore.getState()
      const next = st.playTime + dt
      const tot = totalAnimaticDuration(st)
      if (next >= tot) {
        st.setPlayTime(tot)
        st.setPlaying(false)
        return
      }
      st.setPlayTime(next)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing])

  return (
    <div className="playback-bar">
      <button
        onClick={() => {
          if (!playing && playTime >= total) setPlayTime(0)
          setPlaying(!playing)
          setBottomTab('animatic')
        }}
        disabled={total === 0}
        data-testid="play-button"
        title="アニマティック再生"
      >{playing ? '❚❚' : '▶'}</button>
      <input
        type="range" min={0} max={Math.max(total, 0.001)} step={0.05}
        value={Math.min(playTime, total)}
        onChange={(e) => { setPlaying(false); setPlayTime(parseFloat(e.target.value)) }}
      />
      <span className="time" data-testid="timecode">
        {secondsToTimecode(playTime)} / {secondsToTimecode(total)}
      </span>
    </div>
  )
}

export function BottomPanel() {
  const tab = useStore((s) => s.bottomTab)
  const setTab = useStore((s) => s.setBottomTab)
  const shotsCount = useStore((s) => s.project.shots.length)
  return (
    <div className="bottom-panel">
      <div className="bottom-tabs">
        <button className={tab === 'shots' ? 'active' : ''} onClick={() => setTab('shots')} data-testid="tab-shots">
          ショット{shotsCount ? `（${shotsCount}）` : ''}
        </button>
        <button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')} data-testid="tab-board">ボード</button>
        <button className={tab === 'animatic' ? 'active' : ''} onClick={() => setTab('animatic')} data-testid="tab-animatic">アニマティック</button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')} data-testid="tab-chat">✨ シーンチャット</button>
      </div>
      <div className="bottom-content">
        {tab === 'shots' && <ShotsTab />}
        {tab === 'board' && <BoardTab />}
        {tab === 'animatic' && <AnimaticTab />}
        {tab === 'chat' && <SceneChat />}
      </div>
      <PlaybackBar />
    </div>
  )
}
