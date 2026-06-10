import { useShallow } from 'zustand/react/shallow'
import { useStore, selectAxisStatus } from '../state/store'
import { PROP_CATALOG } from '../model/defaults'
import type { PropKind } from '../model/types'

const PROP_BUTTONS: PropKind[] = [
  'cube', 'table', 'chair', 'sofa', 'bed', 'counter', 'sink', 'desk',
  'shelf', 'lamp', 'light', 'door', 'window', 'wall', 'plant', 'tv', 'rug',
]

export function LeftPanel() {
  const st = useStore()
  const statuses = useStore(useShallow(selectAxisStatus))
  const { characters, props, cameras } = st.project.scene
  const axis = st.project.axis
  const anyCrossed = Object.values(statuses).includes('crossed')

  return (
    <div className="left-panel">
      <div className="section-title">追加</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <button style={{ flex: 1 }} onClick={st.addCharacter} data-testid="add-character">＋ キャラクター</button>
        <button style={{ flex: 1 }} onClick={st.addCamera} data-testid="add-camera">＋ カメラ</button>
      </div>
      <div className="prop-grid">
        {PROP_BUTTONS.map((k) => (
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
