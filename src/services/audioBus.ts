// セリフ音声の共有プレイヤーと録音ルーティング。
// 動画書き出し時はWebAudio経由でスピーカーと録音ストリームの両方へ分配する。
let audioEl: HTMLAudioElement | null = null
let ctx: AudioContext | null = null
let mixDest: MediaStreamAudioDestinationNode | null = null

export function getDialogueAudio(): HTMLAudioElement {
  if (!audioEl) audioEl = new Audio()
  return audioEl
}

// 録音用の音声ストリームを用意（初回のみ要素をWebAudioに接続）
export async function getRecordingAudioStream(): Promise<MediaStream> {
  const el = getDialogueAudio()
  if (!ctx) {
    ctx = new AudioContext()
    const src = ctx.createMediaElementSource(el) // 以後この要素はctx経由で出力される
    mixDest = ctx.createMediaStreamDestination()
    src.connect(ctx.destination) // スピーカー
    src.connect(mixDest) // 録音
  }
  if (ctx.state === 'suspended') await ctx.resume()
  return mixDest!.stream
}
