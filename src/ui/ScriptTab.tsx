// スクリプトモード: 台本→自動カット割り→TTS（セミオート撮影所のWeb実装）
import { useState } from 'react'
import { useStore } from '../state/store'
import { parseScript, uniqueSpeakers } from '../core/scriptParser'
import { VOICE_PRESETS, getElKey, setElKey, clearElKey } from '../services/elevenlabs'
import { generateAllVoices, VoiceGenProgress } from '../services/voiceGen'

const SAMPLE = `ミサキ「ご機嫌よう、ソウタ」
ソウタ「今日はついてない。話しかけるな」
ミサキ（怒り）「いい加減にして。一日中その調子じゃない」
ソウタ「悪かった。…昼飯でもどうだ」
ミサキ「そうね。近くにいい店があるようだけど」
二人は黙って見つめ合う。
ソウタ「行くか」
ミサキ（笑）「ふふ、そうしましょう」`

export function ScriptTab() {
  const st = useStore()
  const [hasKey, setHasKey] = useState(!!getElKey())
  const [keyInput, setKeyInput] = useState('')
  const [progress, setProgress] = useState<VoiceGenProgress | null>(null)
  const [clearExisting, setClearExisting] = useState(true)
  const [preserveKeyframes, setPreserveKeyframes] = useState(false)
  const raw = st.project.scriptRaw ?? ''
  const speakers = uniqueSpeakers(parseScript(raw))
  const voicedCount = st.project.audioTrack.filter((c) => c.speaker && c.audio).length
  const dialogueCount = st.project.audioTrack.filter((c) => c.speaker).length

  return (
    <div style={{ display: 'flex', gap: 14, height: '100%' }}>
      {/* 台本入力 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="section-title" style={{ margin: 0 }}>台本</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            形式: 名前「セリフ」／名前（感情）「セリフ」／話者なし行=ト書き
          </span>
          <button style={{ marginLeft: 'auto' }} onClick={() => st.setScriptRaw(SAMPLE)} data-testid="script-sample">
            サンプル
          </button>
        </div>
        <textarea
          style={{ flex: 1, resize: 'none', fontSize: 13, lineHeight: 1.7 }}
          value={raw}
          onChange={(e) => st.setScriptRaw(e.target.value)}
          placeholder={'ミサキ「ご機嫌よう、ソウタ」\nソウタ「今日はついてない」\n…'}
          data-testid="script-input"
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="capture-btn"
            style={{ flex: 1 }}
            disabled={!raw.trim()}
            onClick={() => st.importScript(clearExisting, preserveKeyframes)}
            data-testid="script-import"
          >
            ⚡ カット割りを生成（カメラ・キャラ・ショット自動配置）
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <label className="cb" style={{ fontSize: 11, color: 'var(--text-dim)', display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={clearExisting}
                onChange={(e) => setClearExisting(e.target.checked)}
                data-testid="clear-existing"
              />
              台本にいないキャラ・既存カメラをクリア
            </label>
            <label className="cb" style={{ fontSize: 11, color: 'var(--text-dim)', display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={preserveKeyframes}
                onChange={(e) => setPreserveKeyframes(e.target.checked)}
                data-testid="preserve-keyframes"
              />
              キャラのキーフレームを保持
            </label>
          </div>
        </div>
      </div>

      {/* 話者→ボイス割当＋TTS */}
      <div style={{ width: 320, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="section-title" style={{ margin: 0 }}>ボイス（ElevenLabs）</span>
        {!hasKey ? (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
              ElevenLabsのAPIキーを設定するとセリフ音声と口パクが生成されます。
              キーはこのブラウザにのみ保存されます。
            </div>
            <div className="chat-input-row">
              <input
                type="password" placeholder="xi-..." value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                data-testid="el-key-input"
              />
              <button
                disabled={keyInput.length < 10}
                onClick={() => { setElKey(keyInput.trim()); setHasKey(true) }}
                data-testid="el-key-save"
              >保存</button>
            </div>
          </div>
        ) : (
          <>
            {speakers.length === 0 && <div className="hint" style={{ padding: 4 }}>台本を入力すると話者が表示されます</div>}
            {speakers.map((sp) => (
              <div key={sp} className="field-row" style={{ margin: 0 }}>
                <label style={{ width: 70 }}>{sp}</label>
                <select
                  style={{ flex: 1 }}
                  value={st.project.voiceMap?.[sp] ?? ''}
                  onChange={(e) => st.setVoice(sp, e.target.value)}
                  data-testid={`voice-${sp}`}
                >
                  <option value="">（自動割当）</option>
                  {VOICE_PRESETS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
              </div>
            ))}
            <button
              disabled={!dialogueCount || !!progress}
              onClick={() => {
                void generateAllVoices((p) => {
                  setProgress(p.done >= p.total && !p.error ? null : p)
                  if (p.error) st.setToast(`音声生成エラー: ${p.error.slice(0, 80)}`)
                  else if (p.done >= p.total) st.setToast(`音声${p.total}本の生成が完了しました`)
                })
              }}
              data-testid="generate-voices"
            >
              🔊 セリフ音声を一括生成{dialogueCount ? `（${voicedCount}/${dialogueCount}済）` : ''}
            </button>
            {progress && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                生成中 {progress.done}/{progress.total} {progress.current ?? ''}
              </div>
            )}
            <button
              style={{ marginTop: 'auto' }}
              onClick={() => { clearElKey(); setHasKey(false) }}
            >🔑 ElevenLabsキーを削除</button>
          </>
        )}
      </div>
    </div>
  )
}
