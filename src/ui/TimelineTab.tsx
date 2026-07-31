// タイムライン: 編集ソフト風トラック型UI（DOMベース・絶対配置）。
// 上から: ツールバー / ルーラー / カメラ(カット)トラック / 音声トラック / キャラごとのKF行。
// 左は固定ラベル列、右はスクロールするレーン域。カット境界ドラッグ=ロール、Alt=リップル、
// クリップドラッグ=startSec変更、ダイヤドラッグ=KF時刻変更（再生ヘッド追従スクラブ）。
import { useRef, useState, useMemo } from 'react'
import { useStore, totalAnimaticDuration } from '../state/store'
import { shotStarts } from '../core/cutTrack'
import { snapTime, nearestGrid } from '../core/snap'
import { shotNumber } from '../core/promptGen'
import type { Vec3 } from '../core/math'

const LABEL_W = 110
const RULER_H = 22
const CUT_H = 48
const AUDIO_H = 40
const CHAR_H = 30
const PAD_RIGHT = 48 // 末尾リップルハンドルの余白

// ルーラーの目盛り間隔（px間隔が最低50pxになる最小の秒ステップを選ぶ）
function tickStep(pxPerSec: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 30, 60]) if (s * pxPerSec >= 50) return s
  return 60
}

interface Focus {
  kind: 'boundary' | 'clip' | 'diamond' | 'camkey'
  index?: number
  id?: string
  charId?: string
  shotId?: string
}

export function TimelineTab() {
  const shots = useStore((s) => s.project.shots)
  const audioTrack = useStore((s) => s.project.audioTrack)
  const characters = useStore((s) => s.project.scene.characters)
  const cameras = useStore((s) => s.project.scene.cameras)
  const playTime = useStore((s) => s.playTime)
  const selectedShotId = useStore((s) => s.selectedShotId)
  const autokey = useStore((s) => s.autokey)
  const total = useStore(totalAnimaticDuration)

  const [pxPerSec, setPxPerSec] = useState(40)
  const [snap, setSnap] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [focus, setFocus] = useState<Focus | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; shotId: string; camSub: boolean } | null>(null)

  // ドラッグ中の deltaSec 計算・スナップ判定に最新値を参照するための ref
  const pxRef = useRef(pxPerSec); pxRef.current = pxPerSec
  const snapRef = useRef(snap); snapRef.current = snap
  const scrollRef = useRef<HTMLDivElement>(null)

  const starts = useMemo(() => shotStarts(shots), [shots])
  const contentW = Math.max(total * pxPerSec + PAD_RIGHT, 240)
  const laneRowsH = CUT_H + AUDIO_H + characters.length * CHAR_H
  const innerH = RULER_H + laneRowsH

  if (!shots.length) {
    return (
      <div className="tl-empty" data-testid="timeline-empty">
        カットがありません。台本タブから生成するか、ショットを追加してください
      </div>
    )
  }

  // スナップ候補（カット境界・クリップ端・KF時刻）。呼び出し側でグリッドを足す
  const baseCandidates = (): number[] => {
    const arr: number[] = [...shotStarts(useStore.getState().project.shots)]
    arr.push(useStore.getState().project.shots.reduce((a, s) => a + s.durationSec, 0))
    for (const c of useStore.getState().project.audioTrack) { arr.push(c.startSec); arr.push(c.startSec + c.durationSec) }
    for (const ch of useStore.getState().project.scene.characters) for (const k of ch.keyframes ?? []) arr.push(k.time)
    return arr
  }
  const applySnap = (t: number, cands: number[]): number =>
    snapRef.current ? snapTime(t, [...cands, nearestGrid(t)], 6 / pxRef.current) : t

  // 汎用ポインタドラッグ: deltaSec を onMove へ渡す。history=true で1ドラッグ=1 Undo
  const startDrag = (
    e: React.PointerEvent,
    opts: { history?: boolean; onMove: (deltaSec: number, ev: PointerEvent) => void; onEnd?: () => void },
  ): void => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    if (opts.history) useStore.getState().beginTimelineDrag()
    const move = (ev: PointerEvent) => opts.onMove((ev.clientX - startX) / pxRef.current, ev)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (opts.history) useStore.getState().endTimelineDrag()
      opts.onEnd?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // --- ルーラー: クリック/ドラッグでスクラブ ---
  const scrubAt = (clientX: number): void => {
    const el = scrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left + el.scrollLeft
    let t = Math.min(Math.max(x / pxRef.current, 0), total)
    t = applySnap(t, baseCandidates())
    useStore.getState().scrubTo(Math.min(Math.max(t, 0), total))
  }
  const onRulerDown = (e: React.PointerEvent): void => {
    scrubAt(e.clientX)
    startDrag(e, { onMove: (_d, ev) => scrubAt(ev.clientX) })
  }

  // --- カット境界ドラッグ（roll / Alt=ripple）---
  const onBoundaryDown = (e: React.PointerEvent, boundaryIdx: number): void => {
    setFocus({ kind: 'boundary', index: boundaryIdx })
    const alt = e.altKey
    const origShots = useStore.getState().project.shots
    const origBoundaryTime = shotStarts(origShots)[boundaryIdx + 1]
    const cands = baseCandidates().filter((c) => Math.abs(c - origBoundaryTime) > 1e-6)
    let lastDelta = 0
    startDrag(e, {
      history: true,
      onMove: (deltaSec) => {
        const target = applySnap(origBoundaryTime + deltaSec, cands)
        const desired = target - origBoundaryTime
        const inc = desired - lastDelta
        if (Math.abs(inc) < 1e-6) return
        const st = useStore.getState()
        if (alt) st.rippleCutBoundary(boundaryIdx, inc)
        else st.rollCutBoundary(boundaryIdx, inc)
        const actual = shotStarts(useStore.getState().project.shots)[boundaryIdx + 1] ?? origBoundaryTime
        lastDelta = actual - origBoundaryTime
      },
    })
  }
  // 最終カット右端 = リップル（総尺変更）
  const onEndDown = (e: React.PointerEvent): void => {
    const lastIdx = useStore.getState().project.shots.length - 1
    setFocus({ kind: 'boundary', index: lastIdx })
    const origTotal = useStore.getState().project.shots.reduce((a, s) => a + s.durationSec, 0)
    let lastDelta = 0
    startDrag(e, {
      history: true,
      onMove: (deltaSec) => {
        const target = applySnap(origTotal + deltaSec, baseCandidates().filter((c) => Math.abs(c - origTotal) > 1e-6))
        const inc = (target - origTotal) - lastDelta
        if (Math.abs(inc) < 1e-6) return
        useStore.getState().rippleCutBoundary(lastIdx, inc)
        const newTotal = useStore.getState().project.shots.reduce((a, s) => a + s.durationSec, 0)
        lastDelta = newTotal - origTotal
      },
    })
  }

  // --- クリップドラッグ（startSec 変更、moveClip が重なり禁止でクランプ）---
  const onClipDown = (e: React.PointerEvent, clipId: string): void => {
    setFocus({ kind: 'clip', id: clipId })
    const clip = useStore.getState().project.audioTrack.find((c) => c.id === clipId)
    if (!clip) return
    const origStart = clip.startSec
    const dur = clip.durationSec
    startDrag(e, {
      history: true,
      onMove: (deltaSec) => {
        const cands = baseCandidates()
        // クリップ左端・右端どちらでもスナップできるよう、右端整合分も候補化
        const target = origStart + deltaSec
        const snappedStart = applySnap(target, cands)
        const snappedEnd = applySnap(target + dur, cands) - dur
        // 端の近い方を採用
        const chosen = Math.abs(snappedStart - target) <= Math.abs(snappedEnd - target) ? snappedStart : snappedEnd
        useStore.getState().moveClip(clipId, chosen)
      },
    })
  }

  // --- ダイヤ（KF）ドラッグ（time 変更、再生ヘッド追従スクラブ）---
  const onDiamondDown = (e: React.PointerEvent, charId: string, index: number): void => {
    e.stopPropagation()
    const ch = useStore.getState().project.scene.characters.find((c) => c.id === charId)
    const kf = ch?.keyframes?.[index]
    if (!kf) return
    setFocus({ kind: 'diamond', charId, index })
    useStore.getState().select({ type: 'character', id: charId })
    const origTime = kf.time
    let curIndex = index
    startDrag(e, {
      history: true,
      onMove: (deltaSec) => {
        const cands = baseCandidates().filter((c) => Math.abs(c - origTime) > 1e-6)
        const target = applySnap(origTime + deltaSec, cands)
        useStore.getState().moveCharKeyframe(charId, curIndex, target)
        // 再ソートで index がずれるため、適用後の時刻から追跡し直す
        const kfs = useStore.getState().project.scene.characters.find((c) => c.id === charId)?.keyframes ?? []
        const applied = Math.round(Math.min(Math.max(target, 0), total) * 100) / 100
        const ni = kfs.findIndex((k) => Math.abs(k.time - applied) < 0.001)
        if (ni >= 0) { curIndex = ni; setFocus({ kind: 'diamond', charId, index: ni }) }
      },
    })
  }

  // --- カメラKF（◇）ドラッグ: カット内ローカル秒を変更（再生ヘッド追従スクラブ）---
  // 時刻はカット内ローカルなので、スナップ候補との比較は「カット開始＋tSec」の絶対時刻で行う。
  const onCamKeyDown = (e: React.PointerEvent, shotId: string, index: number): void => {
    e.stopPropagation()
    const st0 = useStore.getState()
    const si = st0.project.shots.findIndex((s) => s.id === shotId)
    const kf = st0.project.shots[si]?.camKeys?.[index]
    if (!kf) return
    setFocus({ kind: 'camkey', shotId, index })
    useStore.getState().selectShot(shotId)
    const shotStart = shotStarts(st0.project.shots)[si]
    const origAbs = shotStart + kf.tSec
    let curIndex = index
    startDrag(e, {
      history: true,
      onMove: (deltaSec) => {
        const cands = baseCandidates().filter((c) => Math.abs(c - origAbs) > 1e-6)
        const targetAbs = applySnap(origAbs + deltaSec, cands)
        const stn = useStore.getState()
        const i = stn.project.shots.findIndex((s) => s.id === shotId)
        if (i < 0) return
        const start = shotStarts(stn.project.shots)[i]
        stn.moveCamKeyframe(shotId, curIndex, targetAbs - start)
        // 再ソートで index がずれるため、適用後の時刻から追跡し直す
        const keys = useStore.getState().project.shots[i]?.camKeys ?? []
        const applied = Math.round(
          Math.min(Math.max(targetAbs - start, 0), stn.project.shots[i].durationSec) * 100,
        ) / 100
        const ni = keys.findIndex((k) => Math.abs(k.tSec - applied) < 0.001)
        if (ni >= 0) { curIndex = ni; setFocus({ kind: 'camkey', shotId, index: ni }) }
      },
    })
  }

  // --- キーボード nudge（←→=±1コマ, Shift=±1s）+ Delete ---
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!focus) return
    const st = useStore.getState()
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (focus.kind === 'diamond' && focus.charId != null && focus.index != null) {
        e.preventDefault()
        st.removeCharKeyframe(focus.charId, focus.index)
        setFocus(null)
      } else if (focus.kind === 'camkey' && focus.shotId != null && focus.index != null) {
        e.preventDefault()
        st.removeCamKeyframe(focus.shotId, focus.index)
        setFocus(null)
      }
      return
    }
    let dir = 0
    if (e.key === 'ArrowLeft') dir = -1
    else if (e.key === 'ArrowRight') dir = 1
    else return
    e.preventDefault()
    const d = dir * (e.shiftKey ? 1 : 1 / 24)
    st.beginTimelineDrag()
    if (focus.kind === 'boundary' && focus.index != null) {
      st.rollCutBoundary(focus.index, d)
    } else if (focus.kind === 'clip' && focus.id != null) {
      const c = st.project.audioTrack.find((x) => x.id === focus.id)
      if (c) st.moveClip(focus.id, c.startSec + d)
    } else if (focus.kind === 'diamond' && focus.charId != null && focus.index != null) {
      const ch = st.project.scene.characters.find((x) => x.id === focus.charId)
      const kf = ch?.keyframes?.[focus.index]
      if (kf) {
        st.moveCharKeyframe(focus.charId, focus.index, kf.time + d)
        const kfs = st.project.scene.characters.find((x) => x.id === focus.charId)?.keyframes ?? []
        const applied = Math.round(Math.min(Math.max(kf.time + d, 0), total) * 100) / 100
        const ni = kfs.findIndex((k) => Math.abs(k.time - applied) < 0.001)
        if (ni >= 0) setFocus({ kind: 'diamond', charId: focus.charId, index: ni })
      }
    } else if (focus.kind === 'camkey' && focus.shotId != null && focus.index != null) {
      const shot = st.project.shots.find((x) => x.id === focus.shotId)
      const kf = shot?.camKeys?.[focus.index]
      if (shot && kf) {
        st.moveCamKeyframe(focus.shotId, focus.index, kf.tSec + d)
        const keys = st.project.shots.find((x) => x.id === focus.shotId)?.camKeys ?? []
        const applied = Math.round(Math.min(Math.max(kf.tSec + d, 0), shot.durationSec) * 100) / 100
        const ni = keys.findIndex((k) => Math.abs(k.tSec - applied) < 0.001)
        if (ni >= 0) setFocus({ kind: 'camkey', shotId: focus.shotId, index: ni })
      }
    }
    st.endTimelineDrag()
  }

  const headPos = (p: Vec3): string => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`

  // ルーラー目盛り
  const step = tickStep(pxPerSec)
  const ticks: number[] = []
  for (let t = 0; t <= total + 1e-6; t += step) ticks.push(Math.round(t * 100) / 100)

  return (
    <div
      className="tl-root"
      data-testid="timeline-view"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={() => menu && setMenu(null)}
    >
      {/* ツールバー */}
      <div className="tl-toolbar">
        <button data-testid="tl-split" title="再生ヘッド位置でカット分割" onClick={() => useStore.getState().splitShotAtPlayhead()}>✂ 分割</button>
        <span className="tl-sep" />
        <button title="ズームアウト" onClick={() => setPxPerSec((v) => Math.max(8, v / 1.3))}>－</button>
        <span className="tl-zoom">{Math.round(pxPerSec)}px/s</span>
        <button title="ズームイン" onClick={() => setPxPerSec((v) => Math.min(300, v * 1.3))}>＋</button>
        <span className="tl-sep" />
        <button className={snap ? 'active' : ''} title="スナップ" onClick={() => setSnap((v) => !v)} data-testid="tl-snap">🧲 スナップ</button>
        <button className={autokey ? 'active' : ''} title="オートキー（3Dギズモ移動でKF自動記録）" onClick={() => useStore.getState().setAutokey(!autokey)} data-testid="tl-autokey">🔴 オートキー</button>
      </div>

      <div className="tl-body">
        {/* 左ラベル列 */}
        <div className="tl-labels" style={{ width: LABEL_W }}>
          <div style={{ height: RULER_H }} />
          <div className="tl-lbl tl-lbl-track" style={{ height: CUT_H }}>
            <span>カメラ</span>
            <button
              className="tl-addkf"
              title="再生ヘッド位置に、そのカットのカメラの現在位置でキーフレームを追加"
              data-testid="tl-addcamkf"
              onClick={() => useStore.getState().addCamKeyframeAtPlayhead()}
            >◇＋</button>
          </div>
          <div className="tl-lbl tl-lbl-track" style={{ height: AUDIO_H }}>音声</div>
          {characters.map((c) => (
            <div key={c.id} className="tl-lbl tl-lbl-char" style={{ height: CHAR_H }}>
              <button
                className="tl-chevron"
                title={collapsed[c.id] ? '展開' : '折りたたみ'}
                onClick={() => setCollapsed((m) => ({ ...m, [c.id]: !m[c.id] }))}
              >{collapsed[c.id] ? '▸' : '▾'}</button>
              <span className="tl-chip" style={{ background: c.color }} />
              <span className="tl-char-name" title={c.name}>{c.name}</span>
              <button
                className="tl-addkf"
                title={`${playTime.toFixed(1)}秒に現在の姿勢でKFを追加`}
                data-testid={`tl-addkf-${c.id}`}
                onClick={() => useStore.getState().addCharKeyframe(c.id)}
              >◆＋</button>
            </div>
          ))}
        </div>

        {/* 右レーン域（横スクロール） */}
        <div className="tl-lanes" ref={scrollRef}>
          <div className="tl-inner" style={{ width: contentW, height: innerH }}>
            {/* ルーラー */}
            <div className="tl-ruler" style={{ height: RULER_H }} onPointerDown={onRulerDown} data-testid="tl-ruler">
              {ticks.map((t) => (
                <div key={t} className="tl-tick" style={{ left: t * pxPerSec }}>
                  <span className="tl-tick-label">{t % 1 === 0 ? `${t}s` : `${t.toFixed(1)}`}</span>
                </div>
              ))}
            </div>

            {/* カット（カメラ）トラック */}
            <div className="tl-row tl-cutrow" style={{ top: RULER_H, height: CUT_H }}>
              {shots.map((s, i) => {
                const left = starts[i] * pxPerSec
                const w = s.durationSec * pxPerSec
                return (
                  <div
                    key={s.id}
                    className={`tl-cut ${selectedShotId === s.id ? 'selected' : ''}`}
                    style={{ left, width: w, height: CUT_H }}
                    data-testid={`tl-cut-${i}`}
                    onClick={() => useStore.getState().selectShot(s.id)}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, shotId: s.id, camSub: false }) }}
                  >
                    {s.thumbnail && <div className="tl-cut-thumb" style={{ backgroundImage: `url(${s.thumbnail})` }} />}
                    <div className="tl-cut-label">
                      <span className="tl-cut-num">{shotNumber(i)}</span>
                      <span className="tl-cut-cam">{s.cameraName}</span>
                      <span className="tl-cut-dur" data-testid={`tl-cut-dur-${i}`}>{s.durationSec.toFixed(1)}s</span>
                    </div>
                  </div>
                )
              })}
              {/* 内部境界ハンドル（roll / Alt=ripple） */}
              {shots.slice(0, -1).map((_s, i) => (
                <div
                  key={`b${i}`}
                  className={`tl-boundary ${focus?.kind === 'boundary' && focus.index === i ? 'focus' : ''}`}
                  style={{ left: starts[i + 1] * pxPerSec - 3, height: CUT_H }}
                  data-testid={`tl-boundary-${i}`}
                  title="ドラッグ=ロール / Alt+ドラッグ=リップル"
                  onPointerDown={(e) => onBoundaryDown(e, i)}
                />
              ))}
              {/* 末尾ハンドル（総尺リップル） */}
              <div
                className="tl-boundary tl-boundary-end"
                style={{ left: total * pxPerSec - 3, height: CUT_H }}
                data-testid="tl-boundary-end"
                title="ドラッグ=最終カットの尺（総尺）を伸縮"
                onPointerDown={onEndDown}
              />
              {/* カメラKF（◇）: カットブロックの上に重ねて描く。時刻はカット内ローカル秒なので
                  絶対位置は カット開始 + tSec。カット尺より後ろへ出たKFは inert（グレー）表示 */}
              {shots.map((s, i) =>
                (s.camKeys ?? []).map((k, ki) => {
                  const inert = k.tSec > s.durationSec + 1e-6
                  const isFocus = focus?.kind === 'camkey' && focus.shotId === s.id && focus.index === ki
                  return (
                    <div
                      key={`${s.id}-ck${ki}`}
                      className={`tl-camkey ${isFocus ? 'focus' : ''} ${inert ? 'inert' : ''}`}
                      style={{ left: (starts[i] + k.tSec) * pxPerSec - 6 }}
                      data-testid={`tl-camkey-${i}-${ki}`}
                      title={
                        inert
                          ? `${k.tSec.toFixed(2)}s（カット尺の外・再生には使われません）`
                          : `カメラKF ${k.tSec.toFixed(2)}s（カット内） / ${Math.round(k.pose.focalLength)}mm`
                          + '\nドラッグ=時刻変更 / Delete=削除'
                      }
                      onPointerDown={(e) => onCamKeyDown(e, s.id, ki)}
                    />
                  )
                }),
              )}
            </div>

            {/* 音声トラック */}
            <div className="tl-row tl-audiorow" style={{ top: RULER_H + CUT_H, height: AUDIO_H }}>
              {audioTrack.map((clip) => {
                const left = clip.startSec * pxPerSec
                const w = clip.durationSec * pxPerSec
                const label = clip.speaker ? `${clip.speaker}「${clip.text}」` : `（ト書き）${clip.text}`
                return (
                  <div
                    key={clip.id}
                    className={`tl-clip ${clip.speaker ? '' : 'note'} ${focus?.kind === 'clip' && focus.id === clip.id ? 'focus' : ''}`}
                    style={{ left, width: w, height: AUDIO_H - 8 }}
                    data-testid={`tl-clip-${clip.id}`}
                    title={label}
                    onPointerDown={(e) => onClipDown(e, clip.id)}
                  >
                    <span className="tl-clip-text">{label}</span>
                  </div>
                )
              })}
            </div>

            {/* キャラトラック */}
            {characters.map((c, ci) => (
              <div
                key={c.id}
                className="tl-row tl-charrow"
                style={{ top: RULER_H + CUT_H + AUDIO_H + ci * CHAR_H, height: CHAR_H }}
              >
                {!collapsed[c.id] && (c.keyframes ?? []).map((k, ki) => (
                  <div
                    key={ki}
                    className={`tl-diamond ${focus?.kind === 'diamond' && focus.charId === c.id && focus.index === ki ? 'focus' : ''}`}
                    style={{ left: k.time * pxPerSec - 6, borderColor: c.color }}
                    data-testid={`tl-diamond-${c.id}-${ki}`}
                    title={`${k.time.toFixed(2)}s ${headPos(k.position)}`}
                    onPointerDown={(e) => onDiamondDown(e, c.id, ki)}
                    onClick={() => { useStore.getState().select({ type: 'character', id: c.id }); useStore.getState().scrubTo(k.time) }}
                  />
                ))}
              </div>
            ))}

            {/* 再生ヘッド */}
            <div className="tl-playhead" style={{ left: playTime * pxPerSec, height: innerH }} data-testid="tl-playhead" />
          </div>
        </div>
      </div>

      {/* コンテキストメニュー */}
      {menu && (() => {
        const shot = shots.find((s) => s.id === menu.shotId)
        const idx = shots.findIndex((s) => s.id === menu.shotId)
        if (!shot) return null
        return (
          <div className="tl-menu" style={{ left: menu.x, top: menu.y }} data-testid="tl-menu" onClick={(e) => e.stopPropagation()}>
            {!menu.camSub ? (
              <>
                <button onClick={() => { useStore.getState().selectShot(shot.id); useStore.getState().splitShotAtPlayhead(); setMenu(null) }}>ここで分割</button>
                <button disabled={idx >= shots.length - 1} onClick={() => { useStore.getState().mergeShotWithNext(shot.id); setMenu(null) }}>次と結合</button>
                <button
                  data-testid="tl-menu-addcamkf"
                  onClick={() => { useStore.getState().addCamKeyframeAtPlayhead(shot.id); setMenu(null) }}
                >📷 カメラKFを追加（再生ヘッド位置）</button>
                {!!shot.camKeys?.length && (
                  <button onClick={() => { useStore.getState().clearCamKeyframes(shot.id); setMenu(null) }}>
                    ◇ カメラKFを全消去（{shot.camKeys.length}）
                  </button>
                )}
                <button onClick={() => setMenu({ ...menu, camSub: true })}>カメラ差し替え ▸</button>
                <button className="danger" onClick={() => { useStore.getState().removeShot(shot.id); setMenu(null) }}>削除</button>
              </>
            ) : (
              <>
                <button className="tl-menu-back" onClick={() => setMenu({ ...menu, camSub: false })}>◂ 戻る</button>
                {cameras.map((cam) => (
                  <button
                    key={cam.id}
                    className={cam.id === shot.cameraId ? 'active' : ''}
                    onClick={() => { useStore.getState().reassignShotCamera(shot.id, cam.id); setMenu(null) }}
                  >{cam.name}</button>
                ))}
                {!cameras.length && <button disabled>カメラがありません</button>}
              </>
            )}
          </div>
        )
      })()}
    </div>
  )
}
