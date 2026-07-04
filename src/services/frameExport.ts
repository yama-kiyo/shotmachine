// Seedance生成パッケージの書き出し。各カットのIN点（＋ムーブありはOUT点）を高解像度PNGで
// レンダリングし、prompts.json と共に1つのZIPにまとめてダウンロードする。
// これらPNGを Seedance 2.0 の image-to-video 先頭フレーム参照に与え、構図・レンズ・ライティングを
// テキストではなく画像で固定するのが目的。
import { useStore, getCaptureFn } from '../state/store'
import { aspectToNumber } from '../model/types'
import { shotStarts } from '../core/cutTrack'
import { animaticPoseAt, shotHasMove } from '../core/shotPose'
import { shotNumber, shotToPromptJson, type ShotPromptJson } from '../core/promptGen'
import { buildZip, type ZipEntry } from '../core/zipStore'
import { downloadBlob, dataUrlToBytes } from '../export/download'

// スタートフレームの内部バッファ幅（16:9 → 1080p）。テキストではなく画像で構図を伝えるため高解像度。
const CAPTURE_BUFFER_WIDTH = 1920

// キャラクターのVRM/マネキンは useFrame でポーズ更新されるため、スクラブ後に
// 2回 rAF を待ってから撮影する（1回目で time 反映、2回目で描画反映）。
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

export async function exportSeedancePackage(): Promise<void> {
  const st = useStore.getState()
  const shots = st.project.shots
  if (!shots.length) { st.setToast('ショットがありません'); return }
  const capture = getCaptureFn()
  if (!capture) { st.setToast('レンダラ初期化中です'); return }

  const project = st.project
  const cameras = project.scene.cameras
  const ar = aspectToNumber(project.aspect)
  const starts = shotStarts(shots)

  // 現在の再生ヘッド状態を控えて、書き出し後に復元する
  const prev = { playTime: st.playTime, animScrub: st.animScrub, playing: st.playing }
  st.setPlaying(false)

  const entries: ZipEntry[] = []
  const prompts: ShotPromptJson[] = []
  const pngAt = (bufferWidth: number, pose: Parameters<typeof capture>[0]): Uint8Array =>
    dataUrlToBytes(capture(pose, ar, { format: 'png', bufferWidth }))

  try {
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i]
      const num = shotNumber(i)
      const pj = shotToPromptJson(shot, project, i)

      // IN フレーム: カット先頭の内側へスクラブ（半開区間 [start,end) に着地）
      useStore.getState().scrubTo(starts[i] + 0.001)
      await nextFrame(); await nextFrame()
      const inPose = animaticPoseAt(useStore.getState().project.shots, cameras, useStore.getState().playTime)
      if (inPose) {
        const inName = `${num}.png`
        entries.push({ name: inName, data: pngAt(CAPTURE_BUFFER_WIDTH, inPose) })
        pj.reference_frame = inName
      }

      // OUT フレーム: ムーブありカットのみ。カット末尾の内側へスクラブしてキャラを終端位置にする
      if (shotHasMove(shot, cameras)) {
        useStore.getState().scrubTo(starts[i] + shot.durationSec - 0.001)
        await nextFrame(); await nextFrame()
        const outPose = animaticPoseAt(useStore.getState().project.shots, cameras, useStore.getState().playTime)
        if (outPose) {
          const outName = `${num}_out.png`
          entries.push({ name: outName, data: pngAt(CAPTURE_BUFFER_WIDTH, outPose) })
          pj.reference_frame_out = outName
        }
      }

      prompts.push(pj)
    }

    entries.push({
      name: 'prompts.json',
      data: new TextEncoder().encode(JSON.stringify(prompts, null, 2)),
    })

    const zip = buildZip(entries)
    downloadBlob(new Blob([zip], { type: 'application/zip' }), `${project.name}_seedance_pkg.zip`)
    const pngCount = entries.filter((e) => e.name.endsWith('.png')).length
    st.setToast(`Seedanceパッケージを書き出しました（${pngCount}枚）`)
  } finally {
    // 再生ヘッドを元の位置・状態へ戻す
    useStore.setState({ playTime: prev.playTime, animScrub: prev.animScrub, playing: prev.playing })
  }
}
