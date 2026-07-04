// アニマティックの動画書き出し: 再生をリアルタイム録画（字幕焼き込み＋セリフ音声入り）
// 3Dキャンバス→合成キャンバス（字幕描画）→MediaRecorder。mp4対応ブラウザならmp4、なければwebm
import { useStore, totalAnimaticDuration } from '../state/store'
import { aspectToNumber } from '../model/types'
import { activeClipsAt } from '../core/audioTrack'
import { getRecordingAudioStream } from './audioBus'
import { downloadBlob } from '../export/download'

function pickMimeType(): { mime: string; ext: string } {
  const candidates: Array<[string, string]> = [
    ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs="vp9,opus"', 'webm'],
    ['video/webm', 'webm'],
  ]
  for (const [mime, ext] of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext }
  }
  return { mime: '', ext: 'webm' }
}

export interface ExportHandle {
  stop: () => void
}

// 録画開始。再生終了で自動停止しダウンロード。onStateで進捗通知
export async function exportAnimaticVideo(
  srcCanvas: HTMLCanvasElement,
  onState: (s: { recording: boolean; message: string }) => void,
): Promise<ExportHandle> {
  const st = useStore.getState()
  const ar = aspectToNumber(st.project.aspect)
  const W = 1280
  const H = Math.round(W / ar / 2) * 2

  // 合成キャンバス（字幕を毎フレーム焼き込む）
  const comp = document.createElement('canvas')
  comp.width = W
  comp.height = H
  const ctx = comp.getContext('2d')!

  let running = true
  const draw = () => {
    if (!running) return
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
    try { ctx.drawImage(srcCanvas, 0, 0, W, H) } catch { /* 初期化中 */ }
    // 字幕（音声トラックのクリップから解決）
    const s = useStore.getState()
    const clip = activeClipsAt(s.project.audioTrack, s.playTime)[0]?.clip
    if (clip?.text) {
      const text = clip.speaker ? `${clip.speaker}「${clip.text}」` : clip.text
      ctx.font = `500 ${Math.round(H * 0.042)}px "Hiragino Sans", "Yu Gothic UI", sans-serif`
      const tw = Math.min(ctx.measureText(text).width, W * 0.92)
      const pad = H * 0.018
      const bx = (W - tw) / 2 - pad
      const by = H - H * 0.085 - pad
      ctx.fillStyle = 'rgba(0,0,0,0.65)'
      ctx.beginPath()
      ctx.roundRect(bx, by, tw + pad * 2, H * 0.042 + pad * 2, 8)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.textBaseline = 'top'
      ctx.fillText(text, (W - tw) / 2, by + pad, W * 0.92)
    }
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)

  // ストリーム合成（映像＋セリフ音声）
  const stream = comp.captureStream(30)
  try {
    const audio = await getRecordingAudioStream()
    audio.getAudioTracks().forEach((t) => stream.addTrack(t))
  } catch { /* 音声ルーティング不可でも映像のみで続行 */ }

  const { mime, ext } = pickMimeType()
  const rec = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 8_000_000,
  })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }

  const finish = () => {
    if (!running) return
    running = false
    unsubscribe()
    clearTimeout(safety)
    if (rec.state !== 'inactive') rec.stop()
  }
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mime || 'video/webm' })
    const name = `${useStore.getState().project.name}_animatic.${ext}`
    downloadBlob(blob, name)
    onState({ recording: false, message: `書き出し完了: ${name}（${(blob.size / 1e6).toFixed(1)}MB）` })
  }

  // 再生終了（playing=false）で自動停止
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (prev.playing && !s.playing) finish()
  })
  const totalSec = totalAnimaticDuration(st)
  const safety = setTimeout(finish, (totalSec + 5) * 1000)

  // 頭出しして再生開始
  st.setPlayTime(0)
  rec.start(250)
  st.setPlaying(true)
  onState({ recording: true, message: `録画中…（${Math.ceil(totalSec)}秒・実時間で再生します）` })

  return { stop: () => { useStore.getState().setPlaying(false); finish() } }
}
