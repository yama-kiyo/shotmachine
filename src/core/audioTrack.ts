// 音声トラック（DialogueClip[]）の解決・再配置ヘルパー（store 非依存の純関数群）。
// 区間規約は cutTrack と同じ半開区間 [startSec, startSec+durationSec)。時刻は 0.01s 丸め。
import type { DialogueClip, Shot } from '../model/types'
import { shotStarts, roundTime, clampClip } from './cutTrack'

// 再生時刻 playTime に有効なクリップと、そのクリップ先頭からの経過秒 tInClip を返す。
// トラックは1本・重なり禁止なので通常は0件か1件だが、安全のため配列で返す。
export function activeClipsAt(
  clips: DialogueClip[], playTime: number,
): Array<{ clip: DialogueClip; tInClip: number }> {
  const out: Array<{ clip: DialogueClip; tInClip: number }> = []
  for (const clip of clips) {
    const end = clip.startSec + clip.durationSec
    if (playTime >= clip.startSec && playTime < end) {
      out.push({ clip, tInClip: roundTime(playTime - clip.startSec) })
    }
  }
  return out
}

// カットの時間範囲 [start, end)（半開区間）に重なる台詞クリップを返す（元順序を保つ）。
// 分割で境界を跨ぐクリップは両カットに現れる（＝同じ台詞が2コマに出る、正しい挙動）。
// 重なり判定は半開区間同士: clip[cs,ce) ∩ shot[start,end) ≠ ∅ ⟺ cs < end && ce > start。
export function clipsOverlappingRange(
  clips: DialogueClip[], start: number, end: number,
): DialogueClip[] {
  return clips.filter((c) => c.startSec < end && c.startSec + c.durationSec > start)
}

// 一括TTS生成時、各 script カットの尺が実音声長(+間)へ更新された後に呼ぶ。
// clipId で紐づくカットの新しい開始時刻へ clip.startSec を貼り直し、1:1 の初期整列を保つ。
// 紐づくカットが無いクリップ（手動追加・ト書き移動後など）はそのまま残す。
export function relayoutScriptClips(shots: Shot[], clips: DialogueClip[]): DialogueClip[] {
  const starts = shotStarts(shots)
  const startByClipId = new Map<string, number>()
  shots.forEach((s, i) => { if (s.clipId) startByClipId.set(s.clipId, starts[i]) })
  return clips.map((c) => {
    const s0 = startByClipId.get(c.id)
    return s0 === undefined ? c : { ...c, startSec: roundTime(s0) }
  })
}

// 総尺が縮んだ時などに、全クリップを [0,total] かつ重なり禁止でクランプし直す。
// 左から順に clampClip を適用（先に確定した位置を基準に後続を寄せる）。
export function clampClipsToTotal(clips: DialogueClip[], totalSec: number): DialogueClip[] {
  const out = clips.map((c) => ({ ...c }))
  for (let i = 0; i < out.length; i++) {
    out[i] = clampClip(out[i], out, totalSec)
  }
  return out
}
