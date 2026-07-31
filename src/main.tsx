import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { useStore } from './state/store'
import { animaticPoseAt, shotPoseAtLocal, shotHasMove } from './core/shotPose'
import { shotToPromptJson } from './core/promptGen'

// E2E・デバッグ用フック。ブラウザのコンソールからも状態と評価結果を直接確認できる。
// （全状態はもともとクライアント内に閉じており、露出による実害はない。
//  pose-debug.spec.ts は以前からこの window.useStore を前提に書かれていたが未接続だった）
const w = window as unknown as Record<string, unknown>
w.useStore = useStore
w.__shotmachine_test__ = { animaticPoseAt, shotPoseAtLocal, shotHasMove, shotToPromptJson }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
