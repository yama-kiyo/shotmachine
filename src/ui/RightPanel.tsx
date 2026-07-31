import { useStore } from '../state/store'
import { FOCAL_PRESETS, focalToHFovDeg } from '../core/lens'
import { aspectToNumber } from '../model/types'
import type { ShotSize, BodyType, Character, Shot } from '../model/types'
import { shotStarts } from '../core/cutTrack'
import { PROP_CATALOG, isLightProp } from '../model/defaults'
import { classifyMove, MOVE_LABELS_JA } from '../core/moveClassifier'
import { cameraHeightLabel, formatHeightLabel } from '../core/heightLabel'
import { SHOT_SIZE_DEFS } from '../core/framing'
import { POSE_METRICS, eyeY } from '../core/poseMetrics'
import { setVrmBuffer, clearVrmBuffer } from '../three/VRMAvatar'
import {
  VrmEntry, pickVrmFolder, restoreVrmFolder, readVrmEntry, isFsApiAvailable,
} from '../services/vrmLibrary'
import { useState, useEffect } from 'react'
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

const ARM_LABELS: Record<string, string> = {
  natural: '自然体', hands_on_hips: '腰に手', crossed: '腕組み',
  wave: '手を振る', point: '指差し', tpose: 'Tポーズ',
}

// キャラクターのキーフレーム編集（再生バーの時間に状態を記録→再生で補間）
function KeyframeSection({ char }: { char: Character }) {
  const st = useStore()
  const kfs = char.keyframes ?? []
  return (
    <>
      <div className="section-title">キーフレーム</div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
        再生バーの時間に位置・向き・姿勢・腕を記録。2点以上で再生時に移動します
      </div>
      <div className="field-row">
        <button
          style={{ flex: 1 }}
          onClick={() => st.addCharKeyframe(char.id)}
          data-testid="add-keyframe"
        >＋ {st.playTime.toFixed(1)}秒 に現在の状態を記録</button>
      </div>
      {kfs.map((k, i) => (
        <div key={`${k.time}-${i}`} className="field-row" style={{ fontSize: 11, gap: 4 }}>
          <button
            style={{ width: 64 }}
            onClick={() => st.scrubTo(k.time)}
            title="この時間へジャンプ（キーフレーム状態をプレビュー）"
            data-testid={`kf-jump-${i}`}
          >⏱ {k.time.toFixed(1)}s</button>
          <span style={{ flex: 1, color: 'var(--text-dim)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            ({k.position.x.toFixed(1)}, {k.position.z.toFixed(1)}) {POSE_METRICS[k.poseState].label}・{ARM_LABELS[k.armPose]}
          </span>
          <button onClick={() => st.removeCharKeyframe(char.id, i)} data-testid={`kf-remove-${i}`}>✕</button>
        </div>
      ))}
      {kfs.length > 0 && (
        <div className="field-row">
          <button style={{ flex: 1 }} onClick={() => st.clearCharKeyframes(char.id)}>キーフレーム全消去</button>
        </div>
      )}
    </>
  )
}

// VRMライブラリの一覧はタブ切替をまたいで保持
let vrmLibCache: VrmEntry[] = []

// VRMライブラリ行: フォルダを一度選べば.vrm一覧からワンクリック割当
function VrmLibraryRow({ charId, charName }: { charId: string; charName: string }) {
  const st = useStore()
  const [lib, setLib] = useState<VrmEntry[]>(vrmLibCache)
  useEffect(() => {
    // 前回のフォルダ権限が残っていれば自動復元（失敗は無視）
    if (!vrmLibCache.length && isFsApiAvailable()) {
      restoreVrmFolder().then((entries) => {
        if (entries?.length) { vrmLibCache = entries; setLib(entries) }
      }).catch(() => {})
    }
  }, [])
  if (!isFsApiAvailable()) return null
  const choose = async () => {
    try {
      const entries = await pickVrmFolder()
      vrmLibCache = entries
      setLib(entries)
      st.setToast(entries.length ? `VRMを${entries.length}体見つけました` : 'フォルダに.vrmがありません')
    } catch { /* キャンセル */ }
  }
  const assign = async (name: string) => {
    const entry = lib.find((e) => e.name === name)
    if (!entry) return
    const buf = await readVrmEntry(entry)
    setVrmBuffer(charId, buf)
    st.updateCharacter(charId, { vrmFileName: entry.name })
    st.setToast(`${charName} に「${entry.name}」を適用しました`)
  }
  return (
    <div className="field-row"><label>ライブラリ</label>
      <select
        style={{ flex: 1, minWidth: 0 }}
        value=""
        onChange={(e) => { if (e.target.value) void assign(e.target.value) }}
        data-testid="vrm-library-select"
      >
        <option value="">{lib.length ? `モデルを選択…（${lib.length}体）` : '（フォルダ未選択）'}</option>
        {lib.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
      </select>
      <button title="vrmフォルダを選ぶ（例: shotmachine-studio/vrm）" onClick={() => void choose()} data-testid="vrm-folder-pick">📁</button>
    </div>
  )
}

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
        <div className="field-row"><label>位置 Y</label>
          <Num value={c.position.y} onChange={(v) => st.updateCharacter(c.id, { position: { ...c.position, y: v } })} testid="char-pos-y" />
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
        {c.vrmFileName && (
          <div className="field-row" style={{ alignItems: 'flex-start' }}><label>腕ポーズ</label>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {([
                ['natural', '自然体'], ['hands_on_hips', '腰に手'], ['crossed', '腕組み'],
                ['wave', '手を振る'], ['point', '指差し'], ['tpose', 'Tポーズ'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  className={(c.armPose ?? 'natural') === key ? 'active' : ''}
                  onClick={() => st.updateCharacter(c.id, { armPose: key })}
                  data-testid={`arm-${key}`}
                >{label}</button>
              ))}
            </div>
          </div>
        )}
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
        <VrmLibraryRow charId={c.id} charName={c.name} />
        <div className="field-row"><label>VRM</label>
          <button
            style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}
            onClick={() => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = '.vrm'
              input.onchange = async () => {
                const file = input.files?.[0]
                if (!file) return
                const buf = await file.arrayBuffer()
                setVrmBuffer(c.id, buf)
                st.updateCharacter(c.id, { vrmFileName: file.name })
                st.setToast(`${c.name} にVRMモデル「${file.name}」を適用しました`)
              }
              input.click()
            }}
            data-testid="vrm-load"
            title="VRoid等で作成した.vrmファイルを読み込んでマネキンを差し替え"
          >{c.vrmFileName ?? '.vrmモデルを読込…'}</button>
          {c.vrmFileName && (
            <button onClick={() => {
              clearVrmBuffer(c.id)
              st.updateCharacter(c.id, { vrmFileName: undefined })
            }}>✕</button>
          )}
        </div>
        <div className="field-row">
          <button
            style={{ flex: 1 }}
            onClick={() => st.updateCharacter(c.id, { pathB: v3(c.position.x, 0, c.position.z) })}
            title="現在位置を移動開始点として記録し、その後キャラを動かすと移動パスが表示されます"
          >移動パス: A地点を記録</button>
          {c.pathB && <button onClick={() => st.updateCharacter(c.id, { pathB: undefined })}>消去</button>}
        </div>
        <KeyframeSection char={c} />
        <div className="field-row">
          <button className="danger" style={{ flex: 1 }} onClick={st.removeSelected}>削除</button>
        </div>
      </div>
    )
  }
  const p = st.project.scene.props.find((p) => p.id === sel.id)
  if (!p) return null
  const lightCapable = isLightProp(p.kind)
  const screenCapable = p.kind === 'monitor' || p.kind === 'tv'
  return (
    <div>
      <div className="field-row"><label>名前</label>
        <input type="text" value={p.name} onChange={(e) => st.updateProp(p.id, { name: e.target.value })} />
      </div>
      <div className="field-row"><label>色</label>
        <input
          type="color"
          value={p.color ?? PROP_CATALOG[p.kind].color}
          onChange={(e) => st.updateProp(p.id, { color: e.target.value })}
          data-testid="prop-color"
        />
        {p.color && (
          <button onClick={() => st.updateProp(p.id, { color: undefined })} title="既定色に戻す">↺</button>
        )}
      </div>
      {(lightCapable || screenCapable) && (
        <div className="field-row"><label>{lightCapable ? '光量' : '画面'}</label>
          <input
            type="checkbox"
            checked={p.lightOn ?? true}
            onChange={(e) => st.updateProp(p.id, { lightOn: e.target.checked })}
            title="点灯 / 消灯"
            data-testid="prop-light-on"
          />
          {lightCapable && (
            <>
              <input
                type="range" min={0} max={10} step={0.5} style={{ flex: 1 }}
                value={p.lightIntensity ?? PROP_CATALOG[p.kind].lightDefault ?? 0}
                disabled={!(p.lightOn ?? true)}
                onChange={(e) => st.updateProp(p.id, { lightIntensity: parseFloat(e.target.value) })}
                data-testid="prop-light-intensity"
              />
              <span style={{ width: 24, fontSize: 11 }}>
                {(p.lightIntensity ?? PROP_CATALOG[p.kind].lightDefault ?? 0).toFixed(1)}
              </span>
            </>
          )}
        </div>
      )}
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
  // フレーミング対象はカメラ自身の設定（null/未設定＝フリー）。選択状態から推測しない
  const frameTarget = cam.frameTargetId ? chars.find((c) => c.id === cam.frameTargetId) : undefined
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

      <div className="section-title">フレーミング</div>
      <div className="field-row"><label>対象</label>
        <select
          style={{ flex: 1 }}
          value={cam.frameTargetId ?? ''}
          onChange={(e) => st.setCameraFrameTarget(cam.id, e.target.value || null)}
          title="フリー＝自動フレーミングを使わず、位置・注視点・レンズを完全手動で操作する"
          data-testid="frame-target"
        >
          <option value="">フリー（手動）</option>
          {chars.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      {!frameTarget && (
        <div style={{ fontSize: 11, color: 'var(--text-dim)', margin: '2px 0 4px' }}>
          {chars.length
            ? 'フリー: カメラは被写体に縛られません。サイズ合わせを使うには対象を選んでください'
            : 'フリー: キャラクターがいなくてもカメラは自由に動かせます'}
        </div>
      )}
      <div className="preset-grid">
        {FRAME_SIZES.map((s) => (
          <button
            key={s}
            onClick={() => st.frameAs(s)}
            disabled={!frameTarget}
            title={
              !frameTarget
                ? 'フリー中は使えません（対象を選ぶと有効になります）'
                : s in SHOT_SIZE_DEFS ? SHOT_SIZE_DEFS[s as keyof typeof SHOT_SIZE_DEFS].label : s
            }
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

// カメラKFの一覧・ジャンプ・削除。タイムラインの◇だけだと「消し方が分からない・
// Deleteキーはフォーカス次第」になるため、キーボードに依存しない削除導線をここに置く。
function CamKeySection({ shot, shotIndex }: { shot: Shot; shotIndex: number }) {
  const st = useStore()
  const keys = shot.camKeys ?? []
  const starts = shotStarts(st.project.shots)
  const shotStart = starts[shotIndex] ?? 0
  return (
    <>
      <div className="section-title">
        カメラKF{keys.length ? `（${keys.length}）` : ''}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
        {keys.length
          ? 'カット内のカメラワーク。2点以上で再生時にカメラが動きます'
          : 'このカットはA→Bムーブで動きます。KFを追加するとキーフレーム制御に切り替わります'}
      </div>
      <div className="field-row">
        <button
          style={{ flex: 1 }}
          onClick={() => st.addCamKeyframeAtPlayhead(shot.id)}
          data-testid="camkey-add"
          title="再生ヘッド位置に、このカットのカメラの現在位置でキーフレームを追加"
        >◇＋ 再生ヘッド位置に記録</button>
      </div>
      {keys.map((k, i) => {
        const inert = k.tSec > shot.durationSec + 1e-6
        return (
          <div key={i} className="field-row" style={{ fontSize: 11, gap: 4 }} data-testid={`camkey-row-${i}`}>
            <button
              style={{ width: 64 }}
              onClick={() => st.scrubTo(shotStart + Math.min(k.tSec, shot.durationSec))}
              title="この時刻へジャンプ"
              data-testid={`camkey-jump-${i}`}
            >⏱ {k.tSec.toFixed(2)}s</button>
            <span style={{ flex: 1, color: 'var(--text-dim)', overflow: 'hidden', whiteSpace: 'nowrap', opacity: inert ? 0.5 : 1 }}>
              {Math.round(k.pose.focalLength)}mm
              {inert && <span style={{ color: 'var(--warn)' }}> ⚠尺外</span>}
            </span>
            <button
              title={k.ease === 'linear' ? '等速（クリックで加減速へ）' : '加減速（クリックで等速へ）'}
              onClick={() => st.setCamKeyEase(shot.id, i, k.ease === 'linear' ? 'easeInOut' : 'linear')}
              data-testid={`camkey-ease-${i}`}
            >{k.ease === 'linear' ? '／' : 'Ｓ'}</button>
            <button
              onClick={() => st.removeCamKeyframe(shot.id, i)}
              title="このキーフレームを削除"
              data-testid={`camkey-del-${i}`}
            >✕</button>
          </div>
        )
      })}
      {keys.length > 0 && (
        <div className="field-row">
          <button
            style={{ flex: 1 }}
            onClick={() => st.clearCamKeyframes(shot.id)}
            data-testid="camkey-clear"
            title="全て削除してA→Bムーブ評価に戻す"
          >カメラKF全消去</button>
        </div>
      )}
    </>
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
      <div className="field-row"><label>カメラ</label>
        <select
          style={{ flex: 1 }}
          value={shot.cameraId}
          onChange={(e) => st.reassignShotCamera(shot.id, e.target.value)}
          data-testid="shot-camera-select"
          title="このカットのカメラを差し替え（構図・サムネイルを再撮影）"
        >
          {st.project.scene.cameras.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="field-row"><label>尺（秒）</label>
        <Num value={shot.durationSec} step={0.5} onChange={(v) => st.updateShot(shot.id, { durationSec: Math.max(0.5, v) })} testid="shot-duration" />
      </div>

      <CamKeySection shot={shot} shotIndex={idx} />

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
      <div className="field-row">
        <button
          style={{ flex: 1 }}
          onClick={() => st.syncShotToCamera(shot.id)}
          data-testid="sync-shot"
          title="カメラを手で動かした後、このカットの構図・サムネイルを更新"
        >📷 カメラの現在位置で更新</button>
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
