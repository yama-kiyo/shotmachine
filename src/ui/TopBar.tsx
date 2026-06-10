import { useState, useRef, useEffect } from 'react'
import { useStore, undo, redo } from '../state/store'
import type { AspectRatio } from '../model/types'
import type { Overlays } from '../state/store'
import { saveProjectFile, openProjectFile } from '../export/projectFile'
import { exportPromptsMarkdown, exportPromptsJson } from '../export/prompts'
import { downloadBoardPng } from '../export/boardPng'
import { downloadBoardPdf } from '../export/boardPdf'
import { downloadFloorPlanPdf, downloadFloorPlanPng } from '../export/floorPlan'
import { downloadShotlistCsv } from '../export/shotlistCsv'

function Menu({ label, items, testid }: {
  label: string
  items: Array<{ label: string; onClick: () => void; disabled?: boolean }>
  testid?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div className="menu-wrap" ref={ref}>
      <button onClick={() => setOpen(!open)} data-testid={testid}>{label} ▾</button>
      {open && (
        <div className="menu-pop">
          {items.map((it) => (
            <button
              key={it.label}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick() }}
            >{it.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

const OVERLAY_LABELS: Array<[keyof Overlays, string]> = [
  ['thirds', '三分割'], ['safe', 'セーフ'], ['axis180', '180°'],
  ['eyelines', '目線'], ['paths', 'パス'], ['labels', 'ラベル'],
]

export function TopBar() {
  const st = useStore()
  const shotsCount = st.project.shots.length
  return (
    <div className="topbar">
      <span className="logo">🎬 ショットマシン</span>
      <Menu
        label="ファイル"
        testid="menu-file"
        items={[
          { label: '新規プロジェクト', onClick: () => st.newProject(false) },
          { label: 'サンプルを開く（Kitchen Argument）', onClick: () => st.newProject(true) },
          {
            label: 'プロジェクトを開く…',
            onClick: () => {
              openProjectFile()
                .then((p) => st.loadProject(p))
                .catch((e) => st.setToast(e instanceof Error ? e.message : '読み込みに失敗しました'))
            },
          },
          { label: 'プロジェクトを保存（JSON）', onClick: () => saveProjectFile(st.project) },
        ]}
      />
      <Menu
        label="エクスポート"
        testid="menu-export"
        items={[
          { label: 'ストーリーボード PDF', disabled: !shotsCount, onClick: () => { void downloadBoardPdf(st.project) } },
          { label: 'ストーリーボード PNG', disabled: !shotsCount, onClick: () => { void downloadBoardPng(st.project) } },
          { label: 'AIプロンプト一覧（Markdown）', disabled: !shotsCount, onClick: () => exportPromptsMarkdown(st.project) },
          { label: 'AIプロンプト一覧（JSON）', disabled: !shotsCount, onClick: () => exportPromptsJson(st.project) },
          { label: '機材配置図 PDF', onClick: () => { void downloadFloorPlanPdf(st.project) } },
          { label: '機材配置図 PNG', onClick: () => downloadFloorPlanPng(st.project) },
          { label: 'ショットリスト CSV', disabled: !shotsCount, onClick: () => downloadShotlistCsv(st.project) },
        ]}
      />
      <button title="元に戻す (Ctrl+Z)" onClick={undo} data-testid="undo">↩</button>
      <button title="やり直す (Ctrl+Y)" onClick={redo} data-testid="redo">↪</button>
      <input
        value={st.project.name}
        onChange={(e) => st.setProjectName(e.target.value)}
        style={{ width: 170 }}
        title="プロジェクト名"
        data-testid="project-name"
      />
      <input
        value={st.project.slugline}
        onChange={(e) => st.setSlugline(e.target.value)}
        style={{ width: 190 }}
        title="シーン見出し（スラッグライン）"
        data-testid="slugline"
      />
      <span className="spacer" />
      <div style={{ display: 'flex', gap: 2 }}>
        <button className={st.viewMode === '3d' ? 'active' : ''} onClick={() => st.setViewMode('3d')} data-testid="view-3d">3D</button>
        <button className={st.viewMode === 'top' ? 'active' : ''} onClick={() => st.setViewMode('top')} data-testid="view-top">真上</button>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        <button className={st.gizmoMode === 'translate' ? 'active' : ''} onClick={() => st.setGizmoMode('translate')}>移動</button>
        <button className={st.gizmoMode === 'rotate' ? 'active' : ''} onClick={() => st.setGizmoMode('rotate')}>回転</button>
      </div>
      <select
        value={st.project.aspect}
        onChange={(e) => st.setAspect(e.target.value as AspectRatio)}
        title="アスペクト比"
        data-testid="aspect-select"
      >
        {(['16:9', '2.39:1', '4:3', '1:1', '9:16'] as const).map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
      {OVERLAY_LABELS.map(([key, label]) => (
        <label className="cb" key={key}>
          <input
            type="checkbox"
            checked={st.overlays[key]}
            onChange={() => st.toggleOverlay(key)}
            data-testid={`overlay-${key}`}
          />
          {label}
        </label>
      ))}
    </div>
  )
}
