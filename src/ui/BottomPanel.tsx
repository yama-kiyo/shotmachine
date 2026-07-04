import { useEffect, useRef, useState } from 'react'
import { useStore, totalAnimaticDuration } from '../state/store'
import { aspectToNumber } from '../model/types'
import type { CameraPose } from '../model/types'
import { animaticPoseAt as resolveAnimaticPose } from '../core/shotPose'
import { shotAtTime } from '../core/cutTrack'
import { activeClipsAt } from '../core/audioTrack'
import { secondsToTimecode } from '../core/timecode'
import { shotNumber } from '../core/promptGen'
import { CameraView, FrameOverlay } from '../three/CameraView'
import { SceneChat } from './SceneChat'
import { ScriptTab } from './ScriptTab'
import { TimelineTab } from './TimelineTab'
import { getDialogueAudio } from '../services/audioBus'
import { exportAnimaticVideo } from '../services/videoExport'

function ShotsTab() {
  const shots = useStore((s) => s.project.shots)
  const selectedShotId = useStore((s) => s.selectedShotId)
  const selectShot = useStore((s) => s.selectShot)
  const syncAll = useStore((s) => s.syncAllShotsToCameras)
  if (!shots.length) {
    return (
      <div className="hint" data-testid="shots-empty">
        まだショットがありません — 📜スクリプトタブで台本から生成するか、カメラプレビューで「● ショットをキャプチャ」してください。
      </div>
    )
  }
  return (
    <div>
      <div style={{ marginBottom: 6 }}>
        <button onClick={syncAll} data-testid="sync-shots" title="手で動かしたカメラの現在位置でサムネイル・ボードを更新">
          ↻ 全カットをカメラに同期
        </button>
      </div>
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

// 再生時間からアニマティックのカメラポーズを解決（実装は core/shotPose に集約）。
// script カット（source==='script'）はカメラと連動: カメラを手で直すと即反映される。
function animaticPoseAt(): CameraPose | null {
  const st = useStore.getState()
  return resolveAnimaticPose(st.project.shots, st.project.scene.cameras, st.playTime)
}

function AnimaticTab() {
  const shots = useStore((s) => s.project.shots)
  const audioTrack = useStore((s) => s.project.audioTrack)
  const aspect = aspectToNumber(useStore((s) => s.project.aspect))
  const playTime = useStore((s) => s.playTime)
  const overlays = useStore((s) => s.overlays)
  const setToast = useStore((s) => s.setToast)
  const viewRef = useRef<HTMLDivElement>(null)
  const [recState, setRecState] = useState<{ recording: boolean; message: string }>({ recording: false, message: '' })
  if (!shots.length) return <div className="hint">ショットをキャプチャするとアニマティックを再生できます。</div>
  // 現在のショット番号（cutTrack 半開区間で解決）
  const idx = shotAtTime(shots, playTime)?.idx ?? 0
  const height = 158
  const width = Math.round(height * aspect)
  // 字幕は音声トラックのクリップから解決（speaker:null=ト書き / speaker あり=台詞）
  const activeClip = activeClipsAt(audioTrack, playTime)[0]?.clip
  const subtitleText = activeClip?.text
    ? (activeClip.speaker ? `${activeClip.speaker}「${activeClip.text}」` : activeClip.text)
    : ''
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }} data-testid="animatic-view">
      <div style={{ position: 'relative' }} ref={viewRef}>
        <CameraView getPose={animaticPoseAt} aspect={aspect} width={width} bufferWidth={1280} />
        <FrameOverlay thirds={overlays.thirds} safe={overlays.safe} />
        {/* 字幕 */}
        {subtitleText && (
          <div
            data-testid="subtitle"
            style={{
              position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
              maxWidth: '92%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 12,
              padding: '3px 10px', borderRadius: 4, pointerEvents: 'none',
            }}
          >
            {subtitleText}
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
        <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 700 }}>
          Shot {shotNumber(idx)} / {shots.length}ショット
        </div>
        <div>{shots[idx].cameraName} · {shots[idx].shotSize ?? '—'} · {Math.round(shots[idx].focalLength)}mm · {shots[idx].moveType}</div>
        {shots[idx].notes.action && <div style={{ marginTop: 4 }}>ACTION: {shots[idx].notes.action}</div>}
        <div style={{ marginTop: 8 }}>下の再生バーで再生・シークできます。</div>
        <div style={{ marginTop: 10 }}>
          <button
            className="capture-btn"
            disabled={recState.recording}
            data-testid="export-video"
            onClick={() => {
              const canvas = viewRef.current?.querySelector('canvas')
              if (!canvas) { setToast('プレビューの初期化を待ってください'); return }
              void exportAnimaticVideo(canvas, (s) => {
                setRecState(s)
                if (!s.recording && s.message) setToast(s.message)
              })
            }}
          >
            {recState.recording ? '⏺ 録画中…' : '🎬 動画として書き出し'}
          </button>
          {recState.recording && (
            <div style={{ marginTop: 4, color: 'var(--warn)' }}>{recState.message}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// セリフ音声の再生同期（クリップ切替で該当audioを再生）。要素はaudioBus共有（動画書き出しの録音経路と兼用）
let audioClipId: string | null = null
function syncDialogueAudio(playing: boolean) {
  const dialogueAudio = getDialogueAudio()
  if (!playing) {
    dialogueAudio.pause()
    audioClipId = null
    return
  }
  const st = useStore.getState()
  const hit = activeClipsAt(st.project.audioTrack, st.playTime).find((a) => a.clip.audio)
  if (!hit) {
    if (audioClipId !== null) { dialogueAudio.pause(); audioClipId = null }
    return
  }
  if (audioClipId !== hit.clip.id) {
    audioClipId = hit.clip.id
    dialogueAudio.src = hit.clip.audio!
    dialogueAudio.currentTime = Math.max(0, hit.tInClip)
    void dialogueAudio.play().catch(() => {})
  }
}

export function PlaybackBar() {
  const playing = useStore((s) => s.playing)
  const setPlaying = useStore((s) => s.setPlaying)
  const playTime = useStore((s) => s.playTime)
  const setPlayTime = useStore((s) => s.setPlayTime)
  const scrubTo = useStore((s) => s.scrubTo)
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
      syncDialogueAudio(true)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf.current)
      syncDialogueAudio(false)
    }
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
        onChange={(e) => scrubTo(parseFloat(e.target.value))}
        disabled={total === 0}
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
        <button className={tab === 'script' ? 'active' : ''} onClick={() => setTab('script')} data-testid="tab-script">
          📜 スクリプト
        </button>
        <button className={tab === 'shots' ? 'active' : ''} onClick={() => setTab('shots')} data-testid="tab-shots">
          ショット{shotsCount ? `（${shotsCount}）` : ''}
        </button>
        <button className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')} data-testid="tab-timeline">タイムライン</button>
        <button className={tab === 'board' ? 'active' : ''} onClick={() => setTab('board')} data-testid="tab-board">ボード</button>
        <button className={tab === 'animatic' ? 'active' : ''} onClick={() => setTab('animatic')} data-testid="tab-animatic">アニマティック</button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')} data-testid="tab-chat">✨ シーンチャット</button>
      </div>
      <div className="bottom-content">
        {tab === 'script' && <ScriptTab />}
        {tab === 'shots' && <ShotsTab />}
        {tab === 'timeline' && <TimelineTab />}
        {tab === 'board' && <BoardTab />}
        {tab === 'animatic' && <AnimaticTab />}
        {tab === 'chat' && <SceneChat />}
      </div>
      <PlaybackBar />
    </div>
  )
}
