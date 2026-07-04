// 全セリフクリップのTTS一括生成（順次実行・進捗通知）
// 音声/整列/尺は DialogueClip に書き込み、紐づく script カットの尺を実音声長へ追従させる（store側）
import { useStore } from '../state/store'
import { ttsWithTimestamps } from './elevenlabs'

export interface VoiceGenProgress {
  done: number
  total: number
  current?: string
  error?: string
}

export async function generateAllVoices(
  onProgress: (p: VoiceGenProgress) => void,
  regenerate = false,
): Promise<void> {
  const targets = useStore.getState().project.audioTrack.filter(
    (c) => c.speaker && c.text && (regenerate || !c.audio),
  )
  const total = targets.length
  let done = 0
  onProgress({ done, total })
  for (const clip of targets) {
    onProgress({ done, total, current: `${clip.speaker}「${clip.text.slice(0, 12)}…」` })
    try {
      const voiceId = clip.voiceId ?? useStore.getState().project.voiceMap?.[clip.speaker!] ?? ''
      const res = await ttsWithTimestamps(clip.text, voiceId, clip.emotion)
      useStore.getState().applyVoiceToClip(clip.id, res.audio, res.alignment, res.durationSec)
    } catch (e) {
      onProgress({ done, total, error: e instanceof Error ? e.message : String(e) })
      return
    }
    done++
    onProgress({ done, total })
  }
}
