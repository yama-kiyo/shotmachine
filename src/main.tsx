import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './styles.css'
import { useStore } from './state/store'
import { animaticPoseAt, shotPoseAtLocal, shotHasMove } from './core/shotPose'
import { shotToPromptJson } from './core/promptGen'

// E2E・デバッグ用フック（window.useStore / window.__shotmachine_test__）。
// 開発サーバー（DEV）と E2E 用ビルド（`npm run build:e2e` = vite build --mode e2e）でのみ公開する。
// 本番ビルド（`npm run build`。Vercel / Pages）では条件が定数 false になり、コードごと除去される
// （scripts/check-bundle.mjs が dist に残っていないことを検査）。
if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
  const w = window as unknown as Record<string, unknown>
  w.useStore = useStore
  w.__shotmachine_test__ = { animaticPoseAt, shotPoseAtLocal, shotHasMove, shotToPromptJson }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
