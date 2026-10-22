// 描画中の例外で画面が真っ白にならないよう、アプリ全体を包むエラー境界。
// 画面にはスタックトレースやデータを出さず、復帰手段（新規プロジェクトで再開／再読み込み）だけを示す。
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useStore } from '../state/store'

interface Props { children: ReactNode }
interface State { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    // 開発者向けにも種類だけを残す（読み込んだデータを含みうるメッセージ・スタックは出さない）
    console.error(`[ErrorBoundary] 描画エラー: ${error?.name ?? 'Error'}`)
  }

  private restartWithNewProject = (): void => {
    try {
      useStore.getState().newProject(false)
      // Undo 履歴（zundo）に壊れた状態が残っていると Ctrl+Z で戻ってしまうため消す
      useStore.temporal.getState().clear()
    } catch {
      // ストア自体が壊れている場合は再読み込みに任せる
    }
    this.setState({ failed: false })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" data-testid="error-boundary" style={{ maxWidth: 560, margin: '80px auto', padding: 16, lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>表示中にエラーが発生しました</h2>
        <p style={{ fontSize: 13, margin: '0 0 16px' }}>
          読み込んだプロジェクトファイルが壊れているか、未対応の形式の可能性があります。
          新規プロジェクトで再開するか、ページを再読み込みしてください（保存済みのAPIキーは消えません）。
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={this.restartWithNewProject} data-testid="error-boundary-reset">新規プロジェクトで再開</button>
          <button onClick={() => location.reload()}>ページを再読み込み</button>
        </div>
      </div>
    )
  }
}
