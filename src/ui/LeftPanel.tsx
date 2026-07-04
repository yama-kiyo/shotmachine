import { useShallow } from 'zustand/react/shallow'
import { useStore, selectAxisStatus } from '../state/store'
import { PROP_CATALOG, SET_PROP_KINDS, EQUIPMENT_KINDS, LOCATION_TEMPLATES } from '../model/defaults'
import { TIME_OF_DAY_PRESETS, TIME_OF_DAY_ORDER } from '../core/lighting'

// 部屋（壁・床）コントロール
function RoomSection() {
  const st = useStore()
  const room = st.project.scene.room
  const backZ = room.backWallZ ?? -room.depth / 2
  const sideX = room.sideWallX ?? -room.width / 2
  return (
    <>
      <div className="section-title">部屋・壁</div>
      <div style={{ display: 'flex', gap: 10, fontSize: 12, marginBottom: 4 }}>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox" checked={room.showBackWall}
            onChange={(e) => st.updateRoom({ showBackWall: e.target.checked })}
            data-testid="wall-back-toggle"
          />奥壁
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox" checked={room.showSideWall}
            onChange={(e) => st.updateRoom({ showSideWall: e.target.checked })}
            data-testid="wall-side-toggle"
          />横壁
        </label>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
          壁<input
            type="color" value={room.wallColor ?? '#33373f'} style={{ width: 24, padding: 0 }}
            onChange={(e) => st.updateRoom({ wallColor: e.target.value })}
          />
          床<input
            type="color" value={room.floorColor ?? '#23262d'} style={{ width: 24, padding: 0 }}
            onChange={(e) => st.updateRoom({ floorColor: e.target.value })}
          />
        </label>
      </div>
      {room.showBackWall && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--text-dim)' }}>
          <span style={{ width: 52 }}>奥壁 Z</span>
          <input
            type="range" min={-room.depth / 2} max={room.depth / 2} step={0.1} style={{ flex: 1 }}
            value={backZ}
            onChange={(e) => st.updateRoom({ backWallZ: parseFloat(e.target.value) })}
            data-testid="wall-back-z"
          />
          <span style={{ width: 32 }}>{backZ.toFixed(1)}m</span>
        </div>
      )}
      {room.showSideWall && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'var(--text-dim)' }}>
          <span style={{ width: 52 }}>横壁 X</span>
          <input
            type="range" min={-room.width / 2} max={room.width / 2} step={0.1} style={{ flex: 1 }}
            value={sideX}
            onChange={(e) => st.updateRoom({ sideWallX: parseFloat(e.target.value) })}
            data-testid="wall-side-x"
          />
          <span style={{ width: 32 }}>{sideX.toFixed(1)}m</span>
        </div>
      )}
    </>
  )
}

export function LeftPanel() {
  const st = useStore()
  const statuses = useStore(useShallow(selectAxisStatus))
  const { characters, props, cameras } = st.project.scene
  const tod = st.project.scene.timeOfDay ?? 'day'
  const axis = st.project.axis
  const anyCrossed = Object.values(statuses).includes('crossed')

  return (
    <div className="left-panel">
      <div className="section-title">ロケテンプレート</div>
      <select
        style={{ width: '100%' }}
        value=""
        onChange={(e) => { if (e.target.value) st.applyTemplate(e.target.value) }}
        data-testid="template-select"
      >
        <option value="">セットを選んで適用…</option>
        {LOCATION_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>

      <div className="section-title">時間帯</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {TIME_OF_DAY_ORDER.map((k) => (
          <button
            key={k}
            style={{ flex: 1 }}
            className={tod === k ? 'active' : ''}
            onClick={() => st.setTimeOfDay(k)}
            data-testid={`tod-${k}`}
          >{TIME_OF_DAY_PRESETS[k].label}</button>
        ))}
      </div>

      <RoomSection />

      <div className="section-title">追加</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <button style={{ flex: 1 }} onClick={st.addCharacter} data-testid="add-character">＋ キャラクター</button>
        <button style={{ flex: 1 }} onClick={st.addCamera} data-testid="add-camera">＋ カメラ</button>
      </div>
      <div className="prop-grid">
        {SET_PROP_KINDS.map((k) => (
          <button key={k} onClick={() => st.addProp(k)} data-testid={`add-prop-${k}`}>
            {PROP_CATALOG[k].label}
          </button>
        ))}
      </div>
      <div className="section-title">撮影機材</div>
      <div className="prop-grid">
        {EQUIPMENT_KINDS.map((k) => (
          <button key={k} onClick={() => st.addProp(k)} data-testid={`add-prop-${k}`}>
            {PROP_CATALOG[k].label}
          </button>
        ))}
      </div>

      <div className="section-title">シーン</div>
      <div className="section-title" style={{ marginTop: 4 }}>キャラクター</div>
      <div data-testid="outliner-characters">
        {characters.map((c) => (
          <div
            key={c.id}
            className={`outliner-item ${st.selection?.id === c.id ? 'selected' : ''}`}
            onClick={() => st.select({ type: 'character', id: c.id })}
          >
            <span className="dot" style={{ background: c.color }} />
            {c.name}
          </div>
        ))}
        {!characters.length && <div className="hint" style={{ padding: 4 }}>＋ キャラクターで追加</div>}
      </div>
      <div className="section-title">プロップ・セット</div>
      <div>
        {props.map((p) => (
          <div
            key={p.id}
            className={`outliner-item ${st.selection?.id === p.id ? 'selected' : ''}`}
            onClick={() => st.select({ type: 'prop', id: p.id })}
          >
            <span className="dot" style={{ background: '#8b93a1' }} />
            {p.name}
          </div>
        ))}
      </div>
      <div className="section-title">カメラ</div>
      <div data-testid="outliner-cameras">
        {cameras.map((c) => (
          <div
            key={c.id}
            className={`outliner-item ${st.selection?.id === c.id ? 'selected' : ''}`}
            onClick={() => st.select({ type: 'camera', id: c.id })}
            data-testid={`outliner-cam-${c.name.replace(/\s/g, '-')}`}
          >
            <span className="dot" style={{ background: statuses[c.id] === 'crossed' ? 'var(--warn)' : '#4da3ff' }} />
            {c.name} {Math.round(c.pose.focalLength)}mm
            {statuses[c.id] === 'crossed' && <span className="warn-icon" title="180°ライン違反">⚠</span>}
          </div>
        ))}
      </div>

      <div className="section-title">アクション軸（180°）</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <select
          style={{ flex: 1, minWidth: 0 }}
          value={axis?.charAId ?? ''}
          onChange={(e) => {
            const bId = axis?.charBId ?? characters.find((c) => c.id !== e.target.value)?.id
            if (e.target.value && bId) st.setAxisChars(e.target.value, bId)
            else st.clearAxis()
          }}
          data-testid="axis-char-a"
        >
          <option value="">（なし）</option>
          {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          style={{ flex: 1, minWidth: 0 }}
          value={axis?.charBId ?? ''}
          onChange={(e) => {
            if (axis && e.target.value) st.setAxisChars(axis.charAId, e.target.value)
          }}
          data-testid="axis-char-b"
        >
          <option value="">（なし）</option>
          {characters.filter((c) => c.id !== axis?.charAId).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button style={{ flex: 1 }} disabled={!axis} onClick={st.reestablishSide} data-testid="reestablish-side">
          ↻ サイド再設定
        </button>
        <button style={{ flex: 1 }} disabled={!axis} onClick={st.addCoverage} data-testid="add-coverage">
          ＋ カバレッジ
        </button>
      </div>
      {axis && (
        anyCrossed
          ? <div className="axis-warning" data-testid="axis-warning">⚠ ラインを越えているカメラがあります</div>
          : <div className="axis-ok" data-testid="axis-ok">サイド固定中 — ラインを越えたカメラは警告されます</div>
      )}
    </div>
  )
}
