// ElevenLabs TTS（タイムスタンプ付き＝リップシンク用）。
// キーはこのブラウザのlocalStorageにのみ保存され、ElevenLabs API以外には送信されない。
import type { Alignment } from '../model/types'

const KEY_STORAGE = 'shotmachine.elevenLabsKey'
// 優先順位: 手入力（localStorage）→ .envのVITE_ELEVENLABS_API_KEY（ローカル専用ビルドに埋め込み）
const ENV_KEY = (import.meta.env.VITE_ELEVENLABS_API_KEY as string | undefined) ?? null
export const getElKey = (): string | null => localStorage.getItem(KEY_STORAGE) ?? ENV_KEY
export const setElKey = (k: string): void => localStorage.setItem(KEY_STORAGE, k)
export const clearElKey = (): void => localStorage.removeItem(KEY_STORAGE)

// 日本語対応 v3ボイス（~/.claude/rules/elevenlabs.md 準拠）
export const VOICE_PRESETS: Array<{ id: string; label: string; gender: 'F' | 'M' }> = [
  { id: '9BWtsMINqrJLrRacOk9x', label: 'Aria（女性・既定）', gender: 'F' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', label: 'Lily（女性）', gender: 'F' },
  { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte（女性）', gender: 'F' },
  { id: '5l5f8iK3YPeGga21rQIX', label: 'Adeline（女性）', gender: 'F' },
  { id: 'hA4zGnmTwX2NQiTRMt7o', label: 'Riley（女性）', gender: 'F' },
  { id: 'NOpBlnGInO9m6vDvFkFC', label: 'Grandpa（男性・年配）', gender: 'M' },
  { id: 'KdlbMHGeafEyWqPCWkW0', label: 'kiyo（男性）', gender: 'M' },
]

// 話者の並びに男女交互っぽくデフォルト割当（1人目=女性Aria、2人目=男性kiyo…）
export function defaultVoiceFor(index: number): string {
  const order = [0, 6, 1, 5, 2, 4, 3]
  return VOICE_PRESETS[order[index % order.length]].id
}

export interface TtsResult {
  audio: string // dataURL
  alignment?: Alignment
  durationSec: number
}

function audioDuration(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio()
    a.onloadedmetadata = () => resolve(a.duration)
    a.onerror = () => resolve(0)
    a.src = dataUrl
  })
}

// 感情注記をv3オーディオタグに変換
function emotionTag(emotion?: string): string {
  if (!emotion) return ''
  const map: Record<string, string> = {
    怒り: '[angry] ', 怒: '[angry] ', 悲しみ: '[sad] ', 悲: '[sad] ',
    喜び: '[happy] ', 笑: '[laughs] ', 驚き: '[surprised] ', 驚: '[surprised] ',
    囁き: '[whispers] ', ささやき: '[whispers] ', 叫び: '[shouting] ',
  }
  return map[emotion] ?? `[${emotion}] `
}

export async function ttsWithTimestamps(
  text: string, voiceId: string, emotion?: string,
): Promise<TtsResult> {
  const key = getElKey()
  if (!key) throw new Error('ElevenLabsのAPIキーが設定されていません')
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: emotionTag(emotion) + text,
        model_id: 'eleven_v3',
        language_code: 'ja',
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`TTS失敗 (${res.status}): ${body.slice(0, 200)}`)
  }
  const json = await res.json()
  const audio = `data:audio/mpeg;base64,${json.audio_base64}`
  const al = json.alignment ?? json.normalized_alignment
  const alignment = al
    ? {
        chars: al.characters as string[],
        starts: al.character_start_times_seconds as number[],
        ends: al.character_end_times_seconds as number[],
      }
    : undefined
  const durationSec =
    alignment && alignment.ends.length
      ? alignment.ends[alignment.ends.length - 1]
      : await audioDuration(audio)
  return { audio, alignment, durationSec: Math.max(durationSec, 0.5) }
}
