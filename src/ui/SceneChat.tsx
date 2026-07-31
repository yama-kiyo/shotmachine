import { useState, useRef, useEffect } from 'react'
import type Anthropic from '@anthropic-ai/sdk'
import { getApiKey, setApiKey, clearApiKey, isEnvKey, runChat } from '../services/anthropic'

interface UiMsg { role: 'user' | 'assistant' | 'tool'; text: string }

export function SceneChat() {
  const [hasKey, setHasKey] = useState(!!getApiKey())
  const [keyInput, setKeyInput] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [msgs, setMsgs] = useState<UiMsg[]>([])
  const historyRef = useRef<Anthropic.MessageParam[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [msgs])

  if (!hasKey) {
    return (
      <div style={{ maxWidth: 520 }}>
        <div style={{ fontSize: 13, marginBottom: 8 }}>
          シーンチャットは、あなた自身の <b>Anthropic APIキー</b> でClaudeに接続し、
          「もっとローアングルにして」「MayaのCUにして」等の日本語指示でシーンを操作する機能です。
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
          キーは<b>このブラウザのlocalStorageにのみ保存</b>され、Anthropic API以外には送信されません。
          いつでも削除できます。キーは console.anthropic.com で取得できます。
        </div>
        <div className="chat-input-row">
          <input
            type="password"
            placeholder="sk-ant-..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            data-testid="api-key-input"
          />
          <button
            disabled={!keyInput.startsWith('sk-ant-')}
            onClick={() => { setApiKey(keyInput.trim()); setHasKey(true) }}
            data-testid="api-key-save"
          >同意して保存</button>
        </div>
      </div>
    )
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    setMsgs((m) => [...m, { role: 'user', text }])
    historyRef.current = [...historyRef.current, { role: 'user', content: text }]
    try {
      historyRef.current = await runChat(historyRef.current, (e) => {
        setMsgs((m) => [...m, { role: e.type === 'tool' ? 'tool' : 'assistant', text: e.content }])
      })
    } catch (err) {
      setMsgs((m) => [...m, {
        role: 'assistant',
        text: `エラー: ${err instanceof Error ? err.message : String(err)}`,
      }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat-wrap">
      <div className="chat-log" ref={logRef} data-testid="chat-log">
        {!msgs.length && (
          <div className="hint">
            例:「Mayaのクローズアップにして」「カメラをもっと低くして」「2人が入る引きの画にして」「ショットを撮って」
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>{m.text}</div>
        ))}
        {busy && <div className="chat-msg tool">考え中…</div>}
      </div>
      <div className="chat-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
          placeholder="シーンへの指示を日本語で…"
          disabled={busy}
          data-testid="chat-input"
        />
        <button onClick={() => void send()} disabled={busy || !input.trim()} data-testid="chat-send">送信</button>
        <button
          title={
            isEnvKey()
              ? '.env のキーで動作中（削除するものはありません）'
              : '保存したAPIキーを削除'
          }
          disabled={isEnvKey()}
          onClick={() => {
            clearApiKey()
            // .env にキーがあれば削除後もそちらで動く。入力画面へ戻さない
            setHasKey(!!getApiKey())
            setMsgs([])
          }}
        >🔑✕</button>
      </div>
    </div>
  )
}
