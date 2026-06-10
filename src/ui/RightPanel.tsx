import { useStore } from '../state/store'
import { FOCAL_PRESETS, focalToHFovDeg } from '../core/lens'
import { aspectToNumber } from '../model/types'
import type { ShotSize, BodyType } from '../model/types'
import { classifyMove, MOVE_LABELS_JA } from '../core/moveClassifier'
import { cameraHeightLabel, formatHeightLabel } from '../core/heightLabel'
import { SHOT_SIZE_DEFS } from '../core/framing'
import { POSE_METRICS, eyeY } from '../core/poseMetrics'
import { deg, rad, v3 } from '../core/math'
import { secondsToTimecode } from '../core/timecode'

function Num({ value, onChange, step = 0.1, testid }: {
  value: number; onChange: (v: number) => void; step?: number; testid?: string
}) {
  return (
    <input
      type="number"
      value={Number(value.toFixed(2))}
      step={step}
      onChange={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) onChange(v) }}
      data-testid={testid}
    />
  )
}

const FRAME_SIZES: ShotSize[] = ['EWS', 'WS', 'FS', 'MS', 'MCU', 'CU', 'ECU', 'OTS', '2-SHOT', 'POV', 'INS']

function ObjectTab() {
  const st = useStore()
  const sel = st.selection
  if (!sel || sel.type === 'camera') return <div className="hint">キャラクターまたはプロップを選択してください</div>
  if (sel.type === 'character') {
    const c = st.project.scene.characters.find((c) => c.id === sel.id)
    if (!c) return null
    return (
      <div>
        <div className="field-row"><label>名前</label>
          <input type="text" value={c.name} onChange={(e) => st.updateCharacter(c.id, { name: e.target.value })} data-testid="char-name" />
        </div>
        <div className="field-row"><label>色</label>
          <input type="color" value={c.color} onChange={(e) => st.updateCharacter(c.id, { color: e.target.value })} />
        </div>
        <div className="field-row"><label>身長 m</label>
          <Num value={c.height} step={0.01} onChange={(v) => st.updateCharacter(c.id, { height: Math.min(2.5, Math.max(0.5, v)) })} />
        </div>
        <div className="field-row"><label>位置 X/Z</label>
          <Num value={c.position.x} onChange={(v) => st.updateCharacter(c.id, { position: { ...c.position, x: v } })} testid="char-pos-x" />
          <Num value={c.position.z} onChange={(v) => st.updateCharacter(c.id, { position: { ...c.position, z: v } })} testid="char-pos-z" />
        </div>
        <div className="field-row"><label>向き °</label>
          <Num value={deg(c.rotationY)} step={5} onChange={(v) => st.updateCharacter(c.id, { rotationY: rad(v) })} />
        </div>
        <div className="field-row"><label>姿勢</label>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {(['stand', 'sit', 'crouch', 'lie'] as const).map((p) => (
              <button
                key={p}
                className={(c.poseState ?? 'stand') === p ? 'active' : ''}
                onClick={() => st.updateCharacter(c.id, { poseState: p })}
                data-testid={`pose-${p}`}
              >{POSE_METRICS[p].label}</button>
            ))}
          </div>
        </div>
        <div className="field-row"><label>体型</label>
          <select
            value={c.bodyType ?? 'average'}
            onChange={(e) => st.updateCharacter(c.id, { bodyType: e.target.value as BodyType })}
            data-testid="body-type"
          >
            <option value="average">標準</option>
            <option value="broad">大柄</option>
            <option value="slim">細身</option>
            <option value="child">子供</option>
          </select>
        </div>
        <div className="field-row">
          <button
            style={{ flex: 1 }}
            onClick={() => st.updateCharacter(c.id, { pathB: v3(c.position.x, 0, c.position.z) })}
            title="現在位置を移動開始点として記録し、その後キャラを動かすと移動パスが表示されます"
          >移動パス: A地点を記録</button>
          {c.pathB && <button onClick={() => st.updateCharacter(c.id, { pathB: undefined })}>消去</button>}
        </div>
        <div className="field-row">
          <button className="danger" style={{ flex: 1 }} onClick={st.removeSelected}>削除</button>
        </div>
      </div>
    )
  }
  const p = st.project.scene.props.find((p) => p.id === sel.id)
  if (!p) return null
  return (
    <div>
      <div className="field-row"><label>名前</label>
        <input type="text" value={p.name} onChange={(e) => st.updateProp(p.id, { name: e.target.value })} />
      </div>
      <div className="field-row"><label>位置 X/Z</label>
        <Num value={p.position.x} onChange={(v) => st.updateProp(p.id, { position: { ...p.position, x: v } })} />
        <Num value={p.position.z} onChange={(v) => st.updateProp(p.id, { position: { ...p.position, z: v } })} />
      </div>
      <div className="field-row"><label>向き °</label>
        <Num value={deg(p.rotationY)} step={5} onChange={(v) => st.updateProp(p.id, { rotationY: rad(v) })} />
      </div>
      <div className="field-row"><label>スケール</label>
        <Num value={p.scale.x} onChange={(v) => st.updateProp(p.id, { scale: v3(v, p.scale.y, p.scale.z) })} />
        <Num value={p.scale.y} onChange={(v) => st.updateProp(p.id, { scale: v3(p.scale.x, v, p.scale.z) })} />
      </div>
      <div className="field-row">
        <button className="danger" style={{ flex: 1 }} onClick={st.removeSelected}>削除</button>
      </div>
    </div>
  )
}

function CameraTab() {
  const st = useStore()
  const camId = st.selection?.type === 'camera' ? st.selection.id : st.pipCameraId
  const cam = st.project.scene.cameras.find((c) => c.id === camId)
  if (!cam) return <div className="hint">カメラを追加・選択してください</div>
  const ar = aspectToNumber(st.project.aspect)
  const hfov = focalToHFovDeg(cam.pose.focalLength, ar)
  const chars = st.project.scene.characters
  const frameTarget =
    (st.selection?.type === 'character' && chars.find((c) => c.id === st.selection!.id)) ||
    (st.project.axis && chars.find((c) => c.id === st.project.axis!.charAId)) ||
    chars[0]
  const subjectEyeY = frameTarget ? eyeY(frameTarget) : undefined
  const moveType = cam.poseA && cam.poseB ? classifyMove(cam.poseA, cam.poseB) : null

  const setPose = (patch: Parameters<typeof st.updateCameraPose>[1]) => {
    // 焦点距離はゼロ除算防止のためクランプ
    if (patch.focalLength !== undefined) {
      patch.focalLength = Math.min(300, Math.max(5, patch.focalLength))
    }
    st.updateCameraPose(cam.id, patch)
  }

  return (
    <div>
      <div className="field-row"><label>名前</label>
        <input type="text" value={cam.name} onChange={(e) => st.updateCamera(cam.id, { name: e.target.value })} data-testid="camera-name" />
      </div>
      <div className="field-row"><label>レンズ</label>
        <input
          type="range" min={12} max={150} step={1} style={{ flex: 1 }}
          value={cam.pose.focalLength}
          onChange={(e) => setPose({ focalLength: parseFloat(e.target.value) })}
          data-testid="lens-slider"
        />
      </div>
      <div style={{ textAlign: 'center', fontSize: 13, margin: '2px 0 4px' }} data-testid="lens-readout">
        <b>{Math.round(cam.pose.focalLength)}mm</b> · {hfov.toFixed(0)}°
      </div>
      <div className="preset-grid">
        {FOCAL_PRESETS.map((f) => (
          <button
            key={f}
            className={Math.round(cam.pose.focalLength) === f ? 'active' : ''}
            onClick={() => setPose({ focalLength: f })}
            data-testid={`lens-${f}`}
          >{f}</button>
        ))}
      </div>
      <div className="field-row"><label>位置</label>
        <Num value={cam.pose.position.x} onChange={(v) => setPose({ position: { ...cam.pose.position, x: v } })} testid="cam-pos-x" />
        <Num value={cam.pose.position.y} onChange={(v) => setPose({ position: { ...cam.pose.position, y: v } })} testid="cam-pos-y" />
        <Num value={cam.pose.position.z} onChange={(v) => setPose({ position: { ...cam.pose.position, z: v } })} testid="cam-pos-z" />
      </div>
      <div className="field-row"><label>注視点</label>
        <Num value={cam.pose.lookAt.x} onChange={(v) => setPose({ lookAt: { ...cam.pose.lookAt, x: v } })} />
        <Num value={cam.pose.lookAt.y} onChange={(v) => setPose({ lookAt: { ...cam.pose.lookAt, y: v } })} />
        <Num value={cam.pose.lookAt.z} onChange={(v) => setPose({ lookAt: { ...cam.pose.lookAt, z: v } })} />
      </div>
      <div className="field-row"><label>ロール °</label>
        <input
          type="range" min={-45} max={45} step={1} style={{ flex: 1 }}
          value={cam.pose.roll}
          onChange={(e) => setPose({ roll: parseFloat(e.target.value) })}
        />
        <span style={{ width: 30, fontSize: 11 }}>{cam.pose.roll}°</span>
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: 11, margin: '4px 0' }}>
        {formatHeightLabel(cameraHeightLabel(cam.pose, subjectEyeY))}
      </div>

      <div className="section-title">
        フレーミング{frameTarget ? `: ${frameTarget.name}` : ''}
      </div>
      <div className="preset-grid">
        {FRAME_SIZES.map((s) => (
          <button
            key={s}
            onClick={() => st.frameAs(s)}
            disabled={!frameTarget}
            title={s in SHOT_SIZE_DEFS ? SHOT_SIZE_DEFS[s as keyof typeof SHOT_SIZE_DEFS].label : s}
            data-testid={`frame-${s}`}
          >{s}</button>
        ))}
      </div>

      <div className="section-title">カメラムーブ（A → B）</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
        開始位置でA、動かしてBを記録。自動分類:{' '}
        <b style={{ color: 'var(--text)' }} data-testid="move-type">
          {moveType ? `${moveType}（${MOVE_LABELS_JA[moveType]}）` : '—'}
        </b>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button style={{ flex: 1 }} className={cam.poseA ? 'active' : ''} onClick={st.setPoseA} data-testid="set-pose-a">
          ● A（開始）
        </button>
        <button style={{ flex: 1 }} className={cam.poseB ? 'active' : ''} onClick={st.setPoseB} data-testid="set-pose-b">
          ■ B（終了）
        </button>
        {(cam.poseA || cam.poseB) && <button onClick={st.clearMove}>✕</button>}
      </div>
      <div className="field-row" style={{ marginTop: 6 }}><label>ムーブ秒</label>
        <Num value={cam.moveDurationSec} step={0.5} onChange={(v) => st.updateCamera(cam.id, { moveDurationSec: Math.max(0.5, v) })} />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{secondsToTimecode(cam.moveDurationSec)}</span>
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
        <button style={{ flex: 1 }} onClick={() => st.duplicateCamera(cam.id)}>⧉ 複製</button>
        <button style={{ flex: 1 }} className="danger" onClick={() => st.deleteCamera(cam.id)}>✕ 削除</button>
      </div>
    </div>
  )
}

function ShotTab() {
  const st = useStore()
  const shot = st.project.shots.find((s) => s.id === st.selectedShotId)
  if (!shot) return <div className="hint">下部の「ショット」タブでショットを選択してください</div>
  const idx = st.project.shots.indexOf(shot)
  return (
    <div>
      <img src={shot.thumbnail} style={{ width: '100%', borderRadius: 4 }} />
      <div style={{ fontSize: 12, margin: '6px 0' }}>
        <b>{shot.cameraName}</b> · {shot.shotSize ?? '—'} · {Math.round(shot.focalLength)}mm · {shot.moveType}
      </div>
      <div className="field-row"><label>尺（秒）</label>
        <Num value={shot.durationSec} step={0.5} onChange={(v) => st.updateShot(shot.id, { durationSec: Math.max(0.5, v) })} testid="shot-duration" />
      </div>
      <div className="field-row" style={{ alignItems: 'flex-start' }}><label>ACTION</label>
        <textarea
          rows={2} style={{ flex: 1 }}
          value={shot.notes.action}
          onChange={(e) => st.updateShot(shot.id, { notes: { ...shot.notes, action: e.target.value } })}
          placeholder="芝居・被写体の動き"
          data-testid="shot-action"
        />
      </div>
      <div className="field-row" style={{ alignItems: 'flex-start' }}><label>NOTES</label>
        <textarea
          rows={2} style={{ flex: 1 }}
          value={shot.notes.camera}
          onChange={(e) => st.updateShot(shot.id, { notes: { ...shot.notes, camera: e.target.value } })}
          placeholder="カメラ注記・台詞"
        />
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button onClick={() => st.moveShot(shot.id, -1)} disabled={idx === 0}>← 前へ</button>
        <button onClick={() => st.moveShot(shot.id, 1)} disabled={idx === st.project.shots.length - 1}>後へ →</button>
        <button className="danger" style={{ marginLeft: 'auto' }} onClick={() => st.removeShot(shot.id)}>削除</button>
      </div>
    </div>
  )
}

export function RightPanel() {
  const tab = useStore((s) => s.rightTab)
  const setTab = useStore((s) => s.setRightTab)
  return (
    <div className="right-panel">
      <div className="tab-row">
        <button className={tab === 'object' ? 'active' : ''} onClick={() => setTab('object')}>オブジェクト</button>
        <button className={tab === 'camera' ? 'active' : ''} onClick={() => setTab('camera')} data-testid="tab-camera">カメラ</button>
        <button className={tab === 'shot' ? 'active' : ''} onClick={() => setTab('shot')}>ショット</button>
      </div>
      {tab === 'object' && <ObjectTab />}
      {tab === 'camera' && <CameraTab />}
      {tab === 'shot' && <ShotTab />}
    </div>
  )
}
