import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import type {
  Project, Character, Prop, PropKind, CameraRig, CameraPose, Shot, ShotSize, AspectRatio,
  RoomSpec, TimeOfDay, DialogueClip, Alignment, CameraKeyframe,
} from '../model/types'
import { upsertKeyframe } from '../core/charAnim'
import { emotionToArmPose } from '../core/emotionToArmPose'
import { aspectToNumber } from '../model/types'
import { sampleProject, emptyProject, makeCharacter, makeProp, makeCamera, genId, LOCATION_TEMPLATES, PROP_CATALOG } from '../model/defaults'
import { v3, add, sub, scale, normalize, length, distance, rad } from '../core/math'
import {
  shotStarts, roundTime, rollBoundary, rippleBoundary, splitShot, mergeShots, clampClip,
  shotAtTime as cutShotAtTime,
} from '../core/cutTrack'
import { relayoutScriptClips, clampClipsToTotal } from '../core/audioTrack'
import { solveFraming, solveOTS, solvePOV, solveTwoShot, SHOT_SIZE_DEFS } from '../core/framing'
import { establishSide, checkCameraSide, SideStatus } from '../core/axis180'
import { generateCoverage } from '../core/coverage'
import { classifyMove } from '../core/moveClassifier'
import { lerpPose } from '../core/interpolate'
import { shotPoseAtLocal, shotHasMove } from '../core/shotPose'
import {
  activeCamKeys, camKeysFromAB, mergeCamKeys, moveCamKey, removeCamKey, splitCamKeys, upsertCamKey,
} from '../core/cameraTrack'
import type { Vec3 } from '../core/math'
import { parseScript } from '../core/scriptParser'
import { buildCutscene } from '../core/sceneBuilder'
import { defaultVoiceFor } from '../services/elevenlabs'

export type SelectionType = 'character' | 'prop' | 'camera'
export interface Selection { type: SelectionType; id: string }

export type ViewMode = '3d' | 'top'
export type GizmoMode = 'translate' | 'rotate'
export type BottomTab = 'shots' | 'board' | 'animatic' | 'chat' | 'script' | 'timeline'
export type RightTab = 'object' | 'camera' | 'shot'

export interface Overlays {
  thirds: boolean
  safe: boolean
  axis180: boolean
  eyelines: boolean
  paths: boolean
  labels: boolean
}

// three層が登録するフレームキャプチャ関数（カメラポーズ→dataURL）。
// 既定はサムネイル用JPEG。opts で PNG・高解像度バッファを指定できる（スタートフレーム書き出し用）。
export interface CaptureOpts { format?: 'jpeg' | 'png'; bufferWidth?: number }
export type CaptureFn = (pose: CameraPose, aspect: number, opts?: CaptureOpts) => string
let captureFn: CaptureFn | null = null
export const registerCaptureFn = (fn: CaptureFn | null) => { captureFn = fn }
export const getCaptureFn = (): CaptureFn | null => captureFn

// カメラの手動調整を、そのカメラに紐づく台本カットへ自動反映する（デバウンス0.6秒）。
// アニマティックはライブリンク済みなので、ここではサムネイル・凍結ポーズ（ボード/PDF出力用）を追従させる
const pendingSyncCamIds = new Set<string>()
let shotSyncTimer: ReturnType<typeof setTimeout> | null = null
function scheduleShotAutoSync(cameraId: string): void {
  pendingSyncCamIds.add(cameraId)
  if (shotSyncTimer) clearTimeout(shotSyncTimer)
  shotSyncTimer = setTimeout(() => {
    const ids = new Set(pendingSyncCamIds)
    pendingSyncCamIds.clear()
    if (!captureFn) return
    const ar = aspectToNumber(useStore.getState().project.aspect)
    useStore.setState((s) => {
      for (const shot of s.project.shots) {
        if (shot.source !== 'script' || !ids.has(shot.cameraId)) continue
        // camKeys 制御下のカットは camKeys が正本。リグの現在ポーズで上書きしない
        if (shot.camKeys?.length) continue
        const cam = s.project.scene.cameras.find((c) => c.id === shot.cameraId)
        if (!cam) continue
        shot.poseSnapshot.a = JSON.parse(JSON.stringify(cam.pose))
        shot.focalLength = cam.pose.focalLength
        shot.thumbnail = captureFn!(cam.pose, ar)
      }
    })
  }, 600)
}

// camKeys カットのサムネイルを先頭KF/末尾KFで撮り直す（デバウンス0.4秒）。
// camKeys 制御下のカットは scheduleShotAutoSync の対象外なので、ここで撮らないと
// サムネが「KF化する前の最後のリグ位置」で凍結し、絵コンテPNG/PDF・ショット一覧が再生と食い違う。
// ドラッグ中に毎フレーム撮ると重いためデバウンスする。
const pendingThumbShotIds = new Set<string>()
let camKeyThumbTimer: ReturnType<typeof setTimeout> | null = null
function scheduleCamKeyThumbSync(shotId: string): void {
  pendingThumbShotIds.add(shotId)
  if (camKeyThumbTimer) clearTimeout(camKeyThumbTimer)
  camKeyThumbTimer = setTimeout(() => {
    const ids = new Set(pendingThumbShotIds)
    pendingThumbShotIds.clear()
    if (!captureFn) return
    const st = useStore.getState()
    const ar = aspectToNumber(st.project.aspect)
    const updates: Array<{ id: string; thumbnail: string; thumbnailB?: string }> = []
    for (const id of ids) {
      const shot = st.project.shots.find((s) => s.id === id)
      if (!shot?.camKeys?.length) continue
      const act = activeCamKeys(shot.camKeys, shot.durationSec)
      updates.push({
        id,
        thumbnail: captureFn(act[0].pose, ar),
        thumbnailB: act.length >= 2 ? captureFn(act[act.length - 1].pose, ar) : undefined,
      })
    }
    if (!updates.length) return
    useStore.setState((s) => {
      for (const u of updates) {
        const t = s.project.shots.find((x) => x.id === u.id)
        if (!t) continue
        t.thumbnail = u.thumbnail
        t.thumbnailB = u.thumbnailB
      }
    })
  }, 400)
}

// カットの実効カメラワークをKF列として取り出す。camKeys があればそれ、無ければ従来の
// A/Bムーブ（ライブリンク・moveRange窓込み）を2キーへ変換したもの。
// 「camKeysあり」と「なし」のカットを結合するときに、無い側のムーブを失わないために使う。
function asCamKeys(shot: Shot, cameras: CameraRig[]): CameraKeyframe[] {
  if (shot.camKeys?.length) return shot.camKeys
  const a = shotPoseAtLocal(shot, cameras, 0)
  const b = shotHasMove(shot, cameras) ? shotPoseAtLocal(shot, cameras, shot.durationSec) : null
  return camKeysFromAB(
    JSON.parse(JSON.stringify(a ?? shot.poseSnapshot.a)),
    b ? JSON.parse(JSON.stringify(b)) : null,
    shot.durationSec,
  )
}

// 尺が変わると inert 境界（KFが尺の外へ出る/戻る）が動くため、camKeys カットの派生キャッシュを
// 引き直す。これを怠ると再生（尺で正しくクリップ）と絵コンテ/CSV/プロンプトが食い違う。
function resyncCamKeyShots(shots: Shot[], cameras: CameraRig[]): void {
  for (const s of shots) if (s.camKeys?.length) recalcMoveType(s, cameras)
}

// camKeys を「カメラワークの正本」として、そこから派生する Shot 上のフィールドを揃える。
// poseSnapshot / focalLength / moveType は、絵コンテPNG・PDF・ショットリストCSV・
// AIプロンプト出力（promptGen）が参照する“派生キャッシュ”。ここを同期しておかないと、
// 再生だけカメラが動いて書き出し系が全部 'Static' のまま取り残される（＝今回の不具合の本体）。
function recalcMoveType(shot: Shot, cameras: CameraRig[]): void {
  if (shot.camKeys?.length) {
    const act = activeCamKeys(shot.camKeys, shot.durationSec)
    const head = act[0]
    const tail = act[act.length - 1]
    // 派生キャッシュを先頭KF/末尾KFへ同期
    shot.poseSnapshot = {
      a: JSON.parse(JSON.stringify(head.pose)),
      b: act.length >= 2 ? JSON.parse(JSON.stringify(tail.pose)) : undefined,
    }
    shot.focalLength = head.pose.focalLength
    if (act.length < 2) { shot.moveType = 'Static'; return }
    const segs = act.slice(0, -1)
      .map((k, i) => classifyMove(k.pose, act[i + 1].pose))
      .filter((m) => m !== 'Static')
    const kinds = new Set(segs)
    const overall = classifyMove(head.pose, tail.pose)
    // 「行って戻る」（パン往復・一周アーク）は head≈tail のため overall が Static になるが、
    // 途中で確かに動いている。ここを Static にすると絵コンテ矢印が消え、AIプロンプトが
    // 'static camera, locked off' を出してしまう。区間に動きがあれば必ず動きとして扱う。
    shot.moveType = kinds.size >= 2 || (segs.length > 0 && overall === 'Static') ? 'Compound' : overall
    return
  }
  const a = shotPoseAtLocal(shot, cameras, 0)
  const b = shotHasMove(shot, cameras) ? shotPoseAtLocal(shot, cameras, shot.durationSec) : null
  shot.moveType = a && b ? classifyMove(a, b) : 'Static'
}

interface ShotmachineState {
  project: Project
  selection: Selection | null
  viewMode: ViewMode
  gizmoMode: GizmoMode
  overlays: Overlays
  bottomTab: BottomTab
  rightTab: RightTab
  pipCameraId: string | null
  pipGrid: boolean
  moveSlider: number
  playing: boolean
  playTime: number
  animScrub: boolean // 停止中でもキーフレームを評価表示する（スクラブ・再生後）
  autokey: boolean // オートキー: ONでギズモ移動が再生ヘッド位置にKFを打つ（UI状態・Undo/保存対象外）
  lastFraming: Record<string, { size: ShotSize; subjectIds: string[] }>
  toast: string | null
  selectedShotId: string | null
  selectShot: (id: string | null) => void

  // project
  setProjectName: (s: string) => void
  setSlugline: (s: string) => void
  setAspect: (a: AspectRatio) => void
  newProject: (sample: boolean) => void
  loadProject: (p: Project) => void

  // テンプレート（V2）
  applyTemplate: (key: string) => void

  // スクリプトモード（STUDIO）
  setScriptRaw: (raw: string) => void
  importScript: (clearExisting?: boolean, preserveKeyframes?: boolean) => void
  setVoice: (speaker: string, voiceId: string) => void

  // entities
  addCharacter: () => void
  addProp: (kind: PropKind) => void
  addCamera: () => CameraRig
  removeSelected: () => void
  updateCharacter: (id: string, patch: Partial<Character>) => void
  updateProp: (id: string, patch: Partial<Prop>) => void
  updateRoom: (patch: Partial<RoomSpec>) => void
  setTimeOfDay: (t: TimeOfDay) => void

  // キャラクターキーフレーム
  addCharKeyframe: (charId: string) => void
  removeCharKeyframe: (charId: string, index: number) => void
  clearCharKeyframes: (charId: string) => void
  moveCharKeyframe: (charId: string, index: number, newTime: number) => void // タイムライン: KF時刻変更
  writeCharKeyframeFromGizmo: (charId: string, patch: { position: Vec3; rotationY: number }) => void // ギズモ→KF（autokey/既存KF編集）
  setAutokey: (v: boolean) => void
  updateCameraPose: (id: string, patch: Partial<CameraPose>) => void
  updateCamera: (id: string, patch: Partial<Pick<CameraRig, 'name' | 'moveDurationSec'>>) => void
  duplicateCamera: (id: string) => void
  deleteCamera: (id: string) => void

  // selection / ui
  select: (sel: Selection | null) => void
  setViewMode: (m: ViewMode) => void
  setGizmoMode: (m: GizmoMode) => void
  toggleOverlay: (k: keyof Overlays) => void
  setBottomTab: (t: BottomTab) => void
  setRightTab: (t: RightTab) => void
  setPipCamera: (id: string | null) => void
  togglePipGrid: () => void
  setToast: (s: string | null) => void

  // axis 180
  setAxisChars: (aId: string, bId: string) => void
  reestablishSide: () => void
  clearAxis: () => void
  addCoverage: () => void

  // framing
  frameAs: (size: ShotSize) => void

  // camera move A→B
  setPoseA: () => void
  setPoseB: () => void
  clearMove: () => void
  setMoveSlider: (t: number) => void

  // shots
  captureShot: () => void
  syncShotToCamera: (shotId: string) => void
  syncAllShotsToCameras: () => void
  removeShot: (id: string) => void
  moveShot: (id: string, dir: -1 | 1) => void
  updateShot: (id: string, patch: Partial<Shot>) => void

  // カット編集（タイムライン）
  rollCutBoundary: (boundaryIdx: number, deltaSec: number) => void
  rippleCutBoundary: (boundaryIdx: number, deltaSec: number) => void
  dragCameraPosition: (id: string, position: Vec3) => void
  dragCameraOrientation: (id: string, forward: Vec3) => void
  setCameraFrameTarget: (cameraId: string, charId: string | null) => void
  splitShotAtPlayhead: () => void
  mergeShotWithNext: (shotId: string) => void
  // カメラKF（カット内ローカル秒。camKeys があれば A/B ムーブより優先される）
  addCamKeyframeAtPlayhead: (shotId?: string) => void
  moveCamKeyframe: (shotId: string, index: number, tSec: number) => void
  removeCamKeyframe: (shotId: string, index: number) => void
  setCamKeyEase: (shotId: string, index: number, ease: 'linear' | 'easeInOut') => void
  clearCamKeyframes: (shotId: string) => void
  reassignShotCamera: (shotId: string, cameraId: string) => void
  moveClip: (clipId: string, newStartSec: number) => void
  applyVoiceToClip: (clipId: string, audio: string, alignment: Alignment | undefined, audioDurSec: number) => void
  beginTimelineDrag: () => void
  endTimelineDrag: () => void

  // playback
  setPlaying: (p: boolean) => void
  setPlayTime: (t: number) => void
  scrubTo: (t: number) => void
}

// ドラッグ操作の連続setを1履歴にまとめるスロットル
let lastHistoryAt = 0
const HISTORY_THROTTLE_MS = 400
const HISTORY_LIMIT = 60

// タイムラインドラッグ開始時点のプロジェクト状態（1ドラッグ=1 Undo のチェックポイント）
let dragSnapshot: ShotmachineState | null = null

export const useStore = create<ShotmachineState>()(
  temporal(
    immer((set, get) => ({
    // STUDIO版は空シーンで起動（サンプルはファイルメニューから開ける）
    project: emptyProject(),
    selection: null,
    viewMode: '3d',
    gizmoMode: 'translate',
    overlays: { thirds: true, safe: false, axis180: true, eyelines: true, paths: true, labels: true },
    bottomTab: 'script',
    rightTab: 'camera',
    pipCameraId: null,
    pipGrid: true,
    moveSlider: 0,
    playing: false,
    playTime: 0,
    animScrub: false,
    autokey: false,
    lastFraming: {},
    toast: null,
    selectedShotId: null,
    selectShot: (id) => set((st) => { st.selectedShotId = id; if (id) st.rightTab = 'shot' }),

    setProjectName: (s) => set((st) => { st.project.name = s }),
    setSlugline: (s) => set((st) => { st.project.slugline = s }),
    setAspect: (a) => set((st) => { st.project.aspect = a }),
    newProject: (sample) =>
      set((st) => {
        st.project = sample ? sampleProject() : emptyProject()
        st.selection = null
        st.pipCameraId = st.project.scene.cameras[0]?.id ?? null
        st.lastFraming = {}
        st.moveSlider = 0
        st.playing = false
        st.playTime = 0
        st.animScrub = false
      }),
    loadProject: (p) =>
      set((st) => {
        st.project = p
        st.selection = null
        st.pipCameraId = p.scene.cameras[0]?.id ?? null
        st.lastFraming = {}
        st.moveSlider = 0
        st.playing = false
        st.playTime = 0
        st.animScrub = false
      }),

    setScriptRaw: (raw) => set((st) => { st.project.scriptRaw = raw }),
    setVoice: (speaker, voiceId) =>
      set((st) => {
        st.project.voiceMap = { ...(st.project.voiceMap ?? {}), [speaker]: voiceId }
      }),
    importScript: (clearExisting = true, preserveKeyframes = false) => {
      const stNow = get()
      const raw = stNow.project.scriptRaw ?? ''
      const lines = parseScript(raw)
      if (!lines.length) { set((s) => { s.toast = '台本が空です' }); return }
      const ar = aspectToNumber(stNow.project.aspect)
      // 部屋の壁位置を渡し、開いている側にカメラを置く
      const plan = buildCutscene(lines, stNow.project.scene.characters, ar, stNow.project.scene.room)
      // KF保持ONで、台本に名前が残らず削除されるキャラのうちKFを持つものを控える（トースト用）
      const droppedKfNames = clearExisting && preserveKeyframes
        ? stNow.project.scene.characters
            .filter((c) => (c.keyframes?.length ?? 0) > 0 && !plan.allSpeakerNames.includes(c.name))
            .map((c) => c.name)
        : []
      set((st) => {
        if (clearExisting) {
          // 台本に登場しないキャラと全カメラ・全ショット・軸をクリア
          // （台本と同名のキャラはVRM・身長設定ごと温存される）
          st.project.scene.characters = st.project.scene.characters.filter(
            (c) => plan.allSpeakerNames.includes(c.name),
          )
          // 温存キャラのキーフレームは旧台本の時間軸。KF保持OFFのときのみ破棄する
          // （保持ON時は絶対時刻のまま残し、感情由来KFは upsertKeyframe が epsilon 置換する）
          if (!preserveKeyframes) for (const c of st.project.scene.characters) c.keyframes = undefined
          st.project.scene.cameras = []
          st.project.shots = []
          st.project.axis = undefined
          st.selection = null
        }
        // 新規キャラ追加
        st.project.scene.characters.push(...plan.characters)
        // 生成カメラ追加（既存と名前衝突したら既存を使う）
        const camByName = new Map(st.project.scene.cameras.map((c) => [c.name, c]))
        for (const cam of plan.cameras) {
          const existing = camByName.get(cam.name)
          if (existing) {
            existing.pose = cam.pose // 再取込時は解き直したポーズで更新
          } else {
            st.project.scene.cameras.push(cam)
            camByName.set(cam.name, cam)
          }
        }
        // 軸
        if (plan.axis) {
          const a = st.project.scene.characters.find((c) => c.name === plan.axis!.aName)
          const b = st.project.scene.characters.find((c) => c.name === plan.axis!.bName)
          if (a && b) st.project.axis = { charAId: a.id, charBId: b.id, lockedSide: plan.axis.lockedSide }
        }
        // ボイス割当（未割当の話者のみ）
        const vm = { ...(st.project.voiceMap ?? {}) }
        plan.allSpeakerNames.forEach((name, i) => { if (!vm[name]) vm[name] = defaultVoiceFor(i) })
        st.project.voiceMap = vm
        // ショット生成＋音声トラック生成（台本取込はショット列・音声トラックを置き換える）
        // 各台本行 → カット1つ＋DialogueClip1つ。clipId で1:1に紐づけ、startSec=カット累積開始。
        const charIdByName = new Map(st.project.scene.characters.map((c) => [c.name, c.id]))
        const newAudioTrack: DialogueClip[] = []
        let clipAcc = 0
        st.project.shots = plan.shots.map((ps) => {
          const cam = camByName.get(ps.cameraName)!
          const thumbnail = captureFn ? captureFn(ps.pose, ar) : ''
          const clipId = genId('clip')
          const startSec = roundTime(clipAcc)
          clipAcc += ps.durationSec
          newAudioTrack.push({
            id: clipId,
            speaker: ps.speakerName ?? null,
            text: ps.text,
            emotion: ps.speakerName ? ps.emotion : undefined,
            voiceId: ps.speakerName ? vm[ps.speakerName] : undefined,
            startSec,
            durationSec: roundTime(ps.durationSec),
          })
          return {
            id: genId('shot'),
            cameraId: cam.id,
            cameraName: cam.name,
            thumbnail,
            shotSize: ps.shotSize,
            focalLength: ps.pose.focalLength,
            moveType: 'Static' as const,
            subjectIds: ps.subjectNames.map((n) => charIdByName.get(n)!).filter(Boolean),
            durationSec: ps.durationSec,
            notes: { action: ps.speakerName ? '' : ps.text, camera: '' },
            poseSnapshot: { a: JSON.parse(JSON.stringify(ps.pose)) },
            source: 'script' as const,
            clipId,
          }
        })
        st.project.audioTrack = newAudioTrack
        // 感情注記 → 腕ポーズの自動キーフレーム（段階③ジェスチャーAI・B案／腕ポーズのみ）。
        // 各カット開始時刻に、話者キャラへ感情から推定した腕ポーズを1キー打つ。
        // 'natural'（無記載・未知語・平静）はキーを打たず、既存挙動を温存する。
        {
          const charByName = new Map(st.project.scene.characters.map((c) => [c.name, c]))
          let tAccum = 0
          for (const ps of plan.shots) {
            const speaker = ps.speakerName ? charByName.get(ps.speakerName) : undefined
            if (speaker) {
              const armPose = emotionToArmPose(ps.emotion)
              if (armPose !== 'natural') {
                speaker.keyframes = upsertKeyframe(speaker.keyframes, {
                  time: Math.round(tAccum * 100) / 100,
                  position: { ...speaker.position },
                  rotationY: speaker.rotationY,
                  poseState: speaker.poseState ?? 'stand',
                  armPose,
                })
              }
            }
            tAccum += ps.durationSec
          }
        }
        st.bottomTab = 'shots'
        st.pipCameraId = camByName.get('MASTER')?.id ?? st.project.scene.cameras[0]?.id ?? null
        st.toast = droppedKfNames.length
          ? `${droppedKfNames.join('・')}のキーフレームは台本に名前がないため削除されました`
          : `台本から${plan.shots.length}カット・カメラ${plan.cameras.length}台を生成しました`
      })
    },

    applyTemplate: (key) =>
      set((st) => {
        const tpl = LOCATION_TEMPLATES.find((t) => t.key === key)
        if (!tpl) return
        // セット（部屋＋美術）を差し替え。キャラ・カメラ・機材・ショットは維持する
        const keepEquipment = st.project.scene.props.filter(
          (p) => PROP_CATALOG[p.kind].category === 'equipment',
        )
        st.project.scene.room = { ...tpl.room }
        st.project.scene.props = [
          ...tpl.props.map((tp) => ({
            id: genId('prop'),
            kind: tp.kind,
            name: tp.name ?? PROP_CATALOG[tp.kind].label,
            position: v3(tp.x, 0, tp.z),
            rotationY: tp.ry ?? 0,
            scale: v3(tp.sx ?? 1, 1, tp.sz ?? 1),
          })),
          ...keepEquipment,
        ]
        st.project.slugline = tpl.slugline
        st.selection = null
        st.toast = `テンプレート「${tpl.label}」を適用しました（キャラ・カメラは維持）`
      }),

    addCharacter: () =>
      set((st) => {
        const i = st.project.scene.characters.length
        const c = makeCharacter(`キャラ ${i + 1}`, i)
        st.project.scene.characters.push(c)
        st.selection = { type: 'character', id: c.id }
        st.rightTab = 'object'
      }),
    addProp: (kind) =>
      set((st) => {
        const p = makeProp(kind)
        st.project.scene.props.push(p)
        st.selection = { type: 'prop', id: p.id }
        st.rightTab = 'object'
      }),
    addCamera: () => {
      const cam = makeCamera(get().project.scene.cameras.length)
      set((st) => {
        st.project.scene.cameras.push(cam)
        st.selection = { type: 'camera', id: cam.id }
        st.pipCameraId = cam.id
        st.rightTab = 'camera'
      })
      return cam
    },
    removeSelected: () =>
      set((st) => {
        const sel = st.selection
        if (!sel) return
        const sc = st.project.scene
        if (sel.type === 'character') {
          sc.characters = sc.characters.filter((c) => c.id !== sel.id)
          if (st.project.axis && (st.project.axis.charAId === sel.id || st.project.axis.charBId === sel.id)) {
            st.project.axis = undefined
          }
          // このキャラを狙っていたカメラはフリーへ戻す（消えたキャラを指し続けないように）
          for (const cam of sc.cameras) if (cam.frameTargetId === sel.id) cam.frameTargetId = null
        } else if (sel.type === 'prop') sc.props = sc.props.filter((p) => p.id !== sel.id)
        else {
          sc.cameras = sc.cameras.filter((c) => c.id !== sel.id)
          if (st.pipCameraId === sel.id) st.pipCameraId = sc.cameras[0]?.id ?? null
        }
        st.selection = null
      }),
    updateCharacter: (id, patch) =>
      set((st) => {
        const c = st.project.scene.characters.find((c) => c.id === id)
        if (c) Object.assign(c, patch)
      }),
    updateProp: (id, patch) =>
      set((st) => {
        const p = st.project.scene.props.find((p) => p.id === id)
        if (p) Object.assign(p, patch)
      }),
    updateRoom: (patch) =>
      set((st) => {
        Object.assign(st.project.scene.room, patch)
      }),
    setTimeOfDay: (t) => set((st) => { st.project.scene.timeOfDay = t }),

    addCharKeyframe: (charId) =>
      set((st) => {
        const c = st.project.scene.characters.find((c) => c.id === charId)
        if (!c) return
        c.keyframes = upsertKeyframe(c.keyframes, {
          time: Math.round(st.playTime * 100) / 100,
          position: { ...c.position },
          rotationY: c.rotationY,
          poseState: c.poseState ?? 'stand',
          armPose: c.armPose ?? 'natural',
        })
        st.toast = `${c.name} のキーフレームを ${st.playTime.toFixed(1)}秒 に記録しました`
      }),
    removeCharKeyframe: (charId, index) =>
      set((st) => {
        const c = st.project.scene.characters.find((c) => c.id === charId)
        if (!c?.keyframes) return
        c.keyframes.splice(index, 1)
        if (!c.keyframes.length) c.keyframes = undefined
      }),
    clearCharKeyframes: (charId) =>
      set((st) => {
        const c = st.project.scene.characters.find((c) => c.id === charId)
        if (c) c.keyframes = undefined
      }),
    // タイムライン: KFの時刻を変更（総尺内クランプ＋再ソート）。再生ヘッドを追従スクラブさせ3Dを更新
    moveCharKeyframe: (charId, index, newTime) =>
      set((st) => {
        const c = st.project.scene.characters.find((c) => c.id === charId)
        if (!c?.keyframes) return
        const kf = c.keyframes[index]
        if (!kf) return
        const total = st.project.shots.reduce((a, s) => a + s.durationSec, 0)
        const t = roundTime(Math.min(Math.max(newTime, 0), total))
        const rest = c.keyframes.filter((_, i) => i !== index)
        c.keyframes = upsertKeyframe(rest, { ...kf, time: t })
        st.playTime = t
        st.animScrub = true
      }),
    // ギズモからのKF書き込み（autokey ON、または再生ヘッドが既存KF上）。位置・向きのみ差し替え、
    // 姿勢/腕は同時刻の既存KF→キャラ現在値の順で継承。再生ヘッド位置にKFが無ければ新規追加。
    writeCharKeyframeFromGizmo: (charId, patch) =>
      set((st) => {
        const c = st.project.scene.characters.find((c) => c.id === charId)
        if (!c) return
        const time = roundTime(st.playTime)
        const existing = c.keyframes?.find((k) => Math.abs(k.time - time) <= 0.05)
        c.keyframes = upsertKeyframe(c.keyframes, {
          time,
          position: { ...patch.position },
          rotationY: patch.rotationY,
          poseState: existing?.poseState ?? c.poseState ?? 'stand',
          armPose: existing?.armPose ?? c.armPose ?? 'natural',
        })
        st.animScrub = true
      }),
    setAutokey: (v) => set((st) => { st.autokey = v }),
    updateCameraPose: (id, patch) => {
      set((st) => {
        const c = st.project.scene.cameras.find((c) => c.id === id)
        if (c) Object.assign(c.pose, patch)
      })
      scheduleShotAutoSync(id) // ボード・サムネイルへの自動反映
    },
    updateCamera: (id, patch) =>
      set((st) => {
        const c = st.project.scene.cameras.find((c) => c.id === id)
        if (c) Object.assign(c, patch)
      }),
    duplicateCamera: (id) =>
      set((st) => {
        const src = st.project.scene.cameras.find((c) => c.id === id)
        if (!src) return
        const copy: CameraRig = JSON.parse(JSON.stringify(src))
        copy.id = genId('cam')
        copy.name = `${src.name}'`
        st.project.scene.cameras.push(copy)
        st.selection = { type: 'camera', id: copy.id }
        st.pipCameraId = copy.id
      }),
    deleteCamera: (id) =>
      set((st) => {
        st.project.scene.cameras = st.project.scene.cameras.filter((c) => c.id !== id)
        if (st.pipCameraId === id) st.pipCameraId = st.project.scene.cameras[0]?.id ?? null
        if (st.selection?.type === 'camera' && st.selection.id === id) st.selection = null
      }),

    select: (sel) =>
      set((st) => {
        st.selection = sel
        if (sel) st.animScrub = false // 編集に戻ったらキャラはベース状態の表示へ
        if (sel?.type === 'camera') {
          st.rightTab = 'camera'
          st.pipCameraId = sel.id
        } else if (sel) st.rightTab = 'object'
      }),
    setViewMode: (m) => set((st) => { st.viewMode = m }),
    setGizmoMode: (m) => set((st) => { st.gizmoMode = m }),
    toggleOverlay: (k) => set((st) => { st.overlays[k] = !st.overlays[k] }),
    setBottomTab: (t) => set((st) => { st.bottomTab = t }),
    setRightTab: (t) => set((st) => { st.rightTab = t }),
    setPipCamera: (id) => set((st) => { st.pipCameraId = id }),
    togglePipGrid: () => set((st) => { st.pipGrid = !st.pipGrid }),
    setToast: (s) => set((st) => { st.toast = s }),

    setAxisChars: (aId, bId) =>
      set((st) => {
        const a = st.project.scene.characters.find((c) => c.id === aId)
        const b = st.project.scene.characters.find((c) => c.id === bId)
        if (!a || !b || aId === bId) { st.project.axis = undefined; return }
        const cam = st.project.scene.cameras[0]
        const camPos = cam?.pose.position ?? { x: 0, y: 1.5, z: 3 }
        st.project.axis = { charAId: aId, charBId: bId, lockedSide: establishSide(a.position, b.position, camPos) }
      }),
    reestablishSide: () =>
      set((st) => {
        const axis = st.project.axis
        if (!axis) return
        const a = st.project.scene.characters.find((c) => c.id === axis.charAId)
        const b = st.project.scene.characters.find((c) => c.id === axis.charBId)
        const camId = st.selection?.type === 'camera' ? st.selection.id : st.pipCameraId
        const cam = st.project.scene.cameras.find((c) => c.id === camId) ?? st.project.scene.cameras[0]
        if (a && b && cam) axis.lockedSide = establishSide(a.position, b.position, cam.pose.position)
      }),
    clearAxis: () => set((st) => { st.project.axis = undefined }),
    addCoverage: () => {
      const st = get()
      const axis = st.project.axis
      if (!axis) return
      const a = st.project.scene.characters.find((c) => c.id === axis.charAId)
      const b = st.project.scene.characters.find((c) => c.id === axis.charBId)
      if (!a || !b) return
      const ar = aspectToNumber(st.project.aspect)
      const cams = generateCoverage(a, b, axis.lockedSide, ar)
      set((s) => {
        for (const cc of cams) {
          const rig: CameraRig = {
            id: genId('cam'),
            name: cc.name,
            pose: cc.pose,
            moveDurationSec: 4,
          }
          s.project.scene.cameras.push(rig)
          s.lastFraming[rig.id] = { size: cc.shotSize, subjectIds: cc.subjectIds }
        }
        s.toast = `カバレッジ${cams.length}台を生成しました（正サイド配置）`
      })
    },

    frameAs: (size) => {
      const st = get()
      const camId = st.selection?.type === 'camera' ? st.selection.id : st.pipCameraId
      const cam = st.project.scene.cameras.find((c) => c.id === camId)
      if (!cam) return
      const chars = st.project.scene.characters
      // 被写体はカメラ自身が持つ frameTargetId（null/未設定＝フリー）。
      // 旧実装は「今の選択」から推測していたため、カメラを選ぶと必ず先頭キャラが対象になっていた。
      const axis = st.project.axis
      const target = cam.frameTargetId ? chars.find((c) => c.id === cam.frameTargetId) : undefined
      if (!target) {
        set((s) => {
          s.toast = chars.length
            ? 'このカメラはフリーです。フレーミング対象を選んでください'
            : 'フレーミング対象のキャラクターがいません'
        })
        return
      }
      const other =
        (axis && chars.find((c) => c.id === (axis.charAId === target.id ? axis.charBId : axis.charAId))) ||
        chars.find((c) => c.id !== target.id)
      const ar = aspectToNumber(st.project.aspect)
      const f = cam.pose.focalLength
      // solveOTS/solveTwoShotのサイド判定はsideOf(第1引数, 第2引数)基準。
      // 軸の向き（charA→charB）と引数順が逆なら符号を反転して渡す
      const sideFor = (first: Character): (1 | -1) | undefined => {
        if (!axis) return undefined
        if (first.id === axis.charAId) return axis.lockedSide
        if (first.id === axis.charBId) return -axis.lockedSide as 1 | -1
        return undefined
      }
      let pose: CameraPose | null = null
      let subjectIds = [target.id]
      if (size === 'POV') pose = solvePOV(target, f)
      else if (size === 'OTS') {
        if (!other) { set((s) => { s.toast = 'OTSには2人目のキャラクターが必要です' }); return }
        pose = solveOTS(target, other, f, ar, sideFor(target))
        subjectIds = [target.id, other.id]
      } else if (size === '2-SHOT') {
        if (!other) { set((s) => { s.toast = '2-SHOTには2人目のキャラクターが必要です' }); return }
        pose = solveTwoShot(target, other, f, ar, sideFor(target))
        subjectIds = [target.id, other.id]
      } else {
        pose = solveFraming(target, size as keyof typeof SHOT_SIZE_DEFS, f, ar, cam.pose.position)
      }
      set((s) => {
        const c = s.project.scene.cameras.find((c) => c.id === cam.id)
        if (c && pose) c.pose = pose
        s.lastFraming[cam.id] = { size, subjectIds }
        s.pipCameraId = cam.id
        scheduleShotAutoSync(cam.id)
      })
    },

    // フレーミング対象の切り替え（null=フリー）。フリーはカメラを完全手動で扱うモード
    // ギズモの移動: カメラは「三脚ごと移動」＝向きを保ったまま平行移動する。
    // 旧実装は position だけ更新して lookAt を据え置いたため、初期の注視点（原点付近 0,1.2,0）を
    // 永久に向き続け、どこへ動かしても見えない中心点を睨む挙動になっていた。
    dragCameraPosition: (id, position) =>
      set((st) => {
        const c = st.project.scene.cameras.find((c) => c.id === id)
        if (!c) return
        const d = sub(position, c.pose.position)
        c.pose.position = position
        c.pose.lookAt = add(c.pose.lookAt, d)
        scheduleShotAutoSync(id)
      }),
    // ギズモの回転: 前方ベクトル（正規化済み）から注視点を引き直す。被写体までの距離は維持する
    dragCameraOrientation: (id, forward) =>
      set((st) => {
        const c = st.project.scene.cameras.find((c) => c.id === id)
        if (!c) return
        // normalize はゼロベクトルに (0,0,1) を返すため、正規化する前に弾く
        if (length(forward) < 1e-9) return
        const n = normalize(forward)
        // ほぼ真上/真下を向くと、up=+Y 前提の lookAt 行列が特異になり画がロールして暴れる。
        // ティルトを±89°相当でクランプする
        const MAX_TILT = Math.sin(rad(89))
        const f = Math.abs(n.y) > MAX_TILT
          ? normalize(v3(
              n.x || 1e-4,
              Math.sign(n.y) * MAX_TILT,
              n.z,
            ))
          : n
        const dist = Math.max(distance(c.pose.position, c.pose.lookAt), 0.5)
        c.pose.lookAt = add(c.pose.position, scale(f, dist))
        scheduleShotAutoSync(id)
      }),

    setCameraFrameTarget: (cameraId, charId) =>
      set((st) => {
        const c = st.project.scene.cameras.find((c) => c.id === cameraId)
        if (!c) return
        c.frameTargetId = charId
        if (!charId) delete st.lastFraming[cameraId]
        const name = charId ? st.project.scene.characters.find((x) => x.id === charId)?.name : null
        st.toast = name ? `${c.name} のフレーミング対象を ${name} にしました` : `${c.name} をフリーにしました`
      }),

    setPoseA: () =>
      set((st) => {
        const camId = st.selection?.type === 'camera' ? st.selection.id : st.pipCameraId
        const c = st.project.scene.cameras.find((c) => c.id === camId)
        if (c) { c.poseA = JSON.parse(JSON.stringify(c.pose)); st.moveSlider = 0 }
      }),
    setPoseB: () =>
      set((st) => {
        const camId = st.selection?.type === 'camera' ? st.selection.id : st.pipCameraId
        const c = st.project.scene.cameras.find((c) => c.id === camId)
        if (c) { c.poseB = JSON.parse(JSON.stringify(c.pose)); st.moveSlider = 1 }
      }),
    clearMove: () =>
      set((st) => {
        const camId = st.selection?.type === 'camera' ? st.selection.id : st.pipCameraId
        const c = st.project.scene.cameras.find((c) => c.id === camId)
        if (c) { c.poseA = undefined; c.poseB = undefined; st.moveSlider = 0 }
      }),
    setMoveSlider: (t) =>
      set((st) => {
        st.moveSlider = t
        const camId = st.selection?.type === 'camera' ? st.selection.id : st.pipCameraId
        const c = st.project.scene.cameras.find((c) => c.id === camId)
        if (c?.poseA && c.poseB) c.pose = lerpPose(c.poseA, c.poseB, t)
      }),

    captureShot: () => {
      const st = get()
      const cam = st.project.scene.cameras.find((c) => c.id === st.pipCameraId)
      if (!cam) { set((s) => { s.toast = 'キャプチャするカメラがありません' }); return }
      if (!captureFn) { set((s) => { s.toast = 'レンダラ初期化中です' }); return }
      const ar = aspectToNumber(st.project.aspect)
      const poseA = cam.poseA ?? cam.pose
      const poseB = cam.poseA && cam.poseB ? cam.poseB : undefined
      const thumbnail = captureFn(poseA, ar)
      const thumbnailB = poseB ? captureFn(poseB, ar) : undefined
      const framing = st.lastFraming[cam.id]
      const shot: Shot = {
        id: genId('shot'),
        cameraId: cam.id,
        cameraName: cam.name,
        thumbnail,
        thumbnailB,
        shotSize: framing?.size,
        focalLength: poseA.focalLength,
        moveType: poseB ? classifyMove(poseA, poseB) : 'Static',
        // 被写体はカメラのフレーミング対象が正。フリーカメラは被写体なし（先頭キャラを勝手に入れない）
        subjectIds: framing?.subjectIds ?? (cam.frameTargetId ? [cam.frameTargetId] : []),
        durationSec: poseB ? cam.moveDurationSec : 3,
        notes: { action: '', camera: '' },
        poseSnapshot: { a: JSON.parse(JSON.stringify(poseA)), b: poseB ? JSON.parse(JSON.stringify(poseB)) : undefined },
      }
      set((s) => {
        s.project.shots.push(shot)
        s.bottomTab = 'shots'
        s.toast = `ショットをキャプチャしました（${cam.name}）`
      })
    },
    // カットの構図をカメラの現在位置で更新（ポーズ凍結＋サムネ再撮影）
    syncShotToCamera: (shotId) => {
      const stNow = get()
      const ar = aspectToNumber(stNow.project.aspect)
      set((st) => {
        const shot = st.project.shots.find((s) => s.id === shotId)
        if (!shot) return
        const cam = st.project.scene.cameras.find((c) => c.id === shot.cameraId)
        if (!cam) { st.toast = 'このカットのカメラは削除されています'; return }
        shot.poseSnapshot.a = JSON.parse(JSON.stringify(cam.pose))
        shot.poseSnapshot.b = cam.poseA && cam.poseB ? JSON.parse(JSON.stringify(cam.poseB)) : undefined
        shot.focalLength = cam.pose.focalLength
        if (captureFn) shot.thumbnail = captureFn(cam.pose, ar)
        st.toast = `カットを ${cam.name} の現在位置で更新しました`
      })
    },
    syncAllShotsToCameras: () => {
      const stNow = get()
      const ar = aspectToNumber(stNow.project.aspect)
      set((st) => {
        let n = 0
        for (const shot of st.project.shots) {
          const cam = st.project.scene.cameras.find((c) => c.id === shot.cameraId)
          if (!cam) continue
          shot.poseSnapshot.a = JSON.parse(JSON.stringify(cam.pose))
          shot.focalLength = cam.pose.focalLength
          if (captureFn) shot.thumbnail = captureFn(cam.pose, ar)
          n++
        }
        st.toast = `${n}カットをカメラの現在位置に同期しました`
      })
    },
    removeShot: (id) =>
      set((st) => {
        st.project.shots = st.project.shots.filter((s) => s.id !== id)
        if (st.selectedShotId === id) st.selectedShotId = null
      }),
    moveShot: (id, dir) =>
      set((st) => {
        const i = st.project.shots.findIndex((s) => s.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= st.project.shots.length) return
        const [s] = st.project.shots.splice(i, 1)
        st.project.shots.splice(j, 0, s)
      }),
    updateShot: (id, patch) =>
      set((st) => {
        const s = st.project.shots.find((s) => s.id === id)
        if (!s) return
        Object.assign(s, patch)
        // 尺変更は inert 境界を動かすので派生キャッシュを引き直す
        if (patch.durationSec !== undefined && s.camKeys?.length) {
          recalcMoveType(s, st.project.scene.cameras)
        }
      }),

    // 境界ロール: 左+δ/右−δ（合計不変）。音声との対応が崩れないタイムラインの既定操作
    rollCutBoundary: (boundaryIdx, deltaSec) =>
      set((st) => {
        st.project.shots = rollBoundary(st.project.shots, boundaryIdx, deltaSec)
        resyncCamKeyShots(st.project.shots, st.project.scene.cameras)
      }),
    // 境界リップル: 左カットのみ伸縮、以降は累積で後方シフト。総尺が変わるためクリップを再クランプ
    rippleCutBoundary: (boundaryIdx, deltaSec) =>
      set((st) => {
        st.project.shots = rippleBoundary(st.project.shots, boundaryIdx, deltaSec)
        resyncCamKeyShots(st.project.shots, st.project.scene.cameras)
        const total = st.project.shots.reduce((a, s) => a + s.durationSec, 0)
        st.project.audioTrack = clampClipsToTotal(st.project.audioTrack, total)
      }),
    // 再生ヘッド位置でカット分割。分割点ポーズでサムネ再撮影（左thumbnailB/右thumbnail）
    splitShotAtPlayhead: () => {
      const stNow = get()
      const at = cutShotAtTime(stNow.project.shots, stNow.playTime)
      if (!at) return
      const shot = stNow.project.shots[at.idx]
      const ar = aspectToNumber(stNow.project.aspect)
      // 分割点のポーズは shotPose の共有実装で解決（camKeys/ライブリンク/凍結の分岐を一元化）
      const splitPose = shotPoseAtLocal(shot, stNow.project.scene.cameras, at.tInShot) ?? shot.poseSnapshot.a
      const thumb = captureFn ? captureFn(splitPose, ar) : null
      set((st) => {
        const split = splitShot(st.project.shots, at.idx, at.tInShot, 0.5, () => genId('shot'))
        if (!split) { st.toast = 'この位置ではカット分割できません（最小0.5秒）'; return }
        if (thumb) {
          split[at.idx] = { ...split[at.idx], thumbnailB: thumb }
          split[at.idx + 1] = { ...split[at.idx + 1], thumbnail: thumb }
        }
        // camKeys は境界に仮想KFを挿して両側へ振り分ける（分割してもモーションが途切れない）
        if (shot.camKeys?.length) {
          const { left, right } = splitCamKeys(shot.camKeys, at.tInShot, shot.durationSec)
          split[at.idx] = { ...split[at.idx], camKeys: left }
          split[at.idx + 1] = { ...split[at.idx + 1], camKeys: right }
          recalcMoveType(split[at.idx], st.project.scene.cameras)
          recalcMoveType(split[at.idx + 1], st.project.scene.cameras)
        }
        st.project.shots = split
        st.selectedShotId = split[at.idx + 1].id
        st.toast = 'カットを分割しました'
      })
    },
    // 次カットと結合（同カメラ・連続ムーブならムーブ結合、それ以外は左カットのポーズ採用）
    mergeShotWithNext: (shotId) =>
      set((st) => {
        const idx = st.project.shots.findIndex((s) => s.id === shotId)
        if (idx < 0 || idx >= st.project.shots.length - 1) return
        const left = st.project.shots[idx]
        const right = st.project.shots[idx + 1]
        // camKeys は右カットの時刻を左カット尺だけ後ろへずらして連結（境界の重複は畳まれる）。
        // 片側だけがKF制御の場合、もう一方のA→BムーブもKF化してから繋ぐ。
        // そうしないと KF を持たない側のカメラワークが黙って消える
        const mergedKeys = left.camKeys?.length || right.camKeys?.length
          ? mergeCamKeys(
              asCamKeys(left, st.project.scene.cameras),
              left.durationSec,
              asCamKeys(right, st.project.scene.cameras),
            )
          : undefined
        st.project.shots = mergeShots(st.project.shots, idx)
        const merged = st.project.shots[idx]
        if (mergedKeys) {
          merged.camKeys = mergedKeys
          recalcMoveType(merged, st.project.scene.cameras)
        }
      }),

    // --- カメラKF（カット内ローカル秒） ---
    // 再生ヘッド位置に、そのカットのカメラの現在ポーズを記録する。
    // camKeys が空のカットでは、先に従来のA→Bムーブを2キーへ変換してから追加する
    // （監督が組んだムーブが、最初の1キーを打った瞬間に消えてしまわないようにするため）。
    addCamKeyframeAtPlayhead: (shotId) => {
      const stNow = get()
      const at = cutShotAtTime(stNow.project.shots, stNow.playTime)
      if (!at) { set((st) => { st.toast = 'カットがありません' }); return }
      const target = stNow.project.shots[at.idx]
      if (shotId && target.id !== shotId) {
        set((st) => { st.toast = '再生ヘッドをそのカットの中に置いてから追加してください' })
        return
      }
      const cam = stNow.project.scene.cameras.find((c) => c.id === target.cameraId)
      if (!cam) { set((st) => { st.toast = 'このカットのカメラは削除されています' }); return }
      const tSec = roundTime(at.tInShot)
      const pose = JSON.parse(JSON.stringify(cam.pose)) as CameraPose
      set((st) => {
        const shot = st.project.shots[at.idx]
        const cams = st.project.scene.cameras
        // camKeys が空なら、まず従来のA→BムーブをKF化してから追加する
        // （最初の1キーを打った瞬間に、組んであったムーブが消えないように）
        shot.camKeys = upsertCamKey(asCamKeys(shot, cams), tSec, pose)
        recalcMoveType(shot, cams)
        scheduleCamKeyThumbSync(shot.id)
        st.animScrub = true
        st.toast = `カメラKFを記録しました（カット内 ${tSec.toFixed(2)}秒 / 計${shot.camKeys.length}キー）`
      })
    },
    // KFの時刻変更（[0,カット尺]内クランプ）。再生ヘッドを追従させて3Dビューを更新する
    moveCamKeyframe: (shotId, index, tSec) =>
      set((st) => {
        const idx = st.project.shots.findIndex((s) => s.id === shotId)
        const shot = st.project.shots[idx]
        if (!shot?.camKeys) return
        const r = moveCamKey(shot.camKeys, index, tSec, shot.durationSec)
        shot.camKeys = r.keys
        recalcMoveType(shot, st.project.scene.cameras)
        scheduleCamKeyThumbSync(shot.id)
        st.playTime = roundTime(shotStarts(st.project.shots)[idx] + r.tSec)
        st.animScrub = true
      }),
    removeCamKeyframe: (shotId, index) =>
      set((st) => {
        const shot = st.project.shots.find((s) => s.id === shotId)
        if (!shot?.camKeys) return
        shot.camKeys = removeCamKey(shot.camKeys, index)
        recalcMoveType(shot, st.project.scene.cameras)
        if (shot.camKeys?.length) scheduleCamKeyThumbSync(shot.id)
        st.animScrub = true
      }),
    // 区間の補間カーブ切替（そのKFから次のKFまで）。linear=等速 / easeInOut=加減速
    setCamKeyEase: (shotId, index, ease) =>
      set((st) => {
        const shot = st.project.shots.find((s) => s.id === shotId)
        const kf = shot?.camKeys?.[index]
        if (!kf) return
        kf.ease = ease
        st.animScrub = true
      }),
    // 全消去 → 従来のA/Bムーブ評価に戻る
    clearCamKeyframes: (shotId) =>
      set((st) => {
        const shot = st.project.shots.find((s) => s.id === shotId)
        if (!shot) return
        shot.camKeys = undefined
        recalcMoveType(shot, st.project.scene.cameras)
        st.animScrub = true
        st.toast = 'カメラKFを全消去しました（A→Bムーブ評価に戻ります）'
      }),
    // カメラ差し替え（任意タイミングのカットチェンジ後半）。ポーズ凍結＋サムネ再撮影込み
    reassignShotCamera: (shotId, cameraId) => {
      const stNow = get()
      const cam = stNow.project.scene.cameras.find((c) => c.id === cameraId)
      if (!cam) return
      const ar = aspectToNumber(stNow.project.aspect)
      const thumb = captureFn ? captureFn(cam.pose, ar) : null
      set((st) => {
        const shot = st.project.shots.find((s) => s.id === shotId)
        if (!shot) return
        shot.cameraId = cam.id
        shot.cameraName = cam.name
        // camKeys カットはKFがポーズの実体を持つ。差し替えてもカメラワークは維持され、
        // 派生キャッシュ（焦点距離・サムネ）もリグではなくKF基準で引き直す
        if (shot.camKeys?.length) {
          recalcMoveType(shot, st.project.scene.cameras)
          scheduleCamKeyThumbSync(shot.id)
          st.toast = `カットを ${cam.name} に差し替えました（カメラKFは維持されます）`
          return
        }
        shot.focalLength = cam.pose.focalLength
        // script カットはライブリンクのまま（poseSnapshotは触らない）、capture カットは新ポーズを凍結
        if (shot.source !== 'script') {
          shot.poseSnapshot = { a: JSON.parse(JSON.stringify(cam.pose)) }
        }
        if (thumb) shot.thumbnail = thumb
        st.toast = `カットを ${cam.name} に差し替えました`
      })
    },
    // クリップの startSec 変更（[0,総尺]内・重なり禁止でクランプ）
    moveClip: (clipId, newStartSec) =>
      set((st) => {
        const clip = st.project.audioTrack.find((c) => c.id === clipId)
        if (!clip) return
        const total = st.project.shots.reduce((a, s) => a + s.durationSec, 0)
        clip.startSec = clampClip({ ...clip, startSec: newStartSec }, st.project.audioTrack, total).startSec
      }),
    // 一括TTS: クリップに音声/整列/尺を書き込み、紐づく script カット尺を実音声長+0.6s(間)へ。
    // 全 script クリップを新しいカット開始へ貼り直して1:1整列を保つ（ripple＝累積で後方シフト）。
    applyVoiceToClip: (clipId, audio, alignment, audioDurSec) =>
      set((st) => {
        const clip = st.project.audioTrack.find((c) => c.id === clipId)
        if (!clip) return
        clip.audio = audio
        clip.alignment = alignment
        clip.durationSec = roundTime(audioDurSec)
        const shot = st.project.shots.find((s) => s.clipId === clipId)
        if (shot) shot.durationSec = roundTime(audioDurSec + 0.6)
        st.project.audioTrack = relayoutScriptClips(st.project.shots, st.project.audioTrack)
      }),
    // ドラッグ開始/終了: 連続setを1 Undo にまとめる。開始時点をチェックポイントに保持し、
    // 終了時に「変化があれば」その1件だけ履歴へ push（zundoのpause中はset記録されないため手動）
    beginTimelineDrag: () => {
      dragSnapshot = { project: get().project } as unknown as ShotmachineState
      useStore.temporal.getState().pause()
    },
    endTimelineDrag: () => {
      const temporal = useStore.temporal.getState()
      temporal.resume()
      const snap = dragSnapshot
      dragSnapshot = null
      if (snap && get().project !== snap.project) {
        useStore.temporal.setState((s) => ({
          pastStates: [...s.pastStates, snap].slice(-HISTORY_LIMIT),
          futureStates: [],
        }))
      }
    },

    setPlaying: (p) => set((st) => { st.playing = p; if (p) st.animScrub = true }),
    setPlayTime: (t) => set((st) => { st.playTime = t }),
    scrubTo: (t) => set((st) => { st.playing = false; st.playTime = t; st.animScrub = true }),
    })),
    {
      // Undo対象はプロジェクト内容のみ（UI状態・再生状態は対象外）
      partialize: (st) => ({ project: st.project }) as unknown as ShotmachineState,
      limit: 60,
      handleSet: (handleSet) => (state) => {
        const now = Date.now()
        if (now - lastHistoryAt < HISTORY_THROTTLE_MS) return
        lastHistoryAt = now
        handleSet(state)
      },
    },
  ),
)

export const undo = (): void => {
  useStore.temporal.getState().undo()
  // 巻き戻し後にスクラブ表示が残ると、消えたキーフレームの状態に見えるため解除する
  useStore.setState({ animScrub: false })
}
export const redo = (): void => {
  useStore.temporal.getState().redo()
  useStore.setState({ animScrub: false })
}

// 再生時間→現在ショット。cutTrack の純関数へ委譲（半開区間 [start,end) 規約）。
export function shotAtTime(): { idx: number; tInShot: number } {
  const st = useStore.getState()
  return cutShotAtTime(st.project.shots, st.playTime) ?? { idx: 0, tInShot: 0 }
}

// ---- セレクタ ----
export const selectAxisStatus = (st: ShotmachineState): Record<string, SideStatus> => {
  const axis = st.project.axis
  if (!axis) return {}
  const a = st.project.scene.characters.find((c) => c.id === axis.charAId)
  const b = st.project.scene.characters.find((c) => c.id === axis.charBId)
  if (!a || !b) return {}
  const out: Record<string, SideStatus> = {}
  for (const cam of st.project.scene.cameras) {
    out[cam.id] = checkCameraSide(a.position, b.position, axis.lockedSide, cam.pose.position)
  }
  return out
}

export const selectCharPositions = (st: ShotmachineState): Record<string, Vec3> => {
  const out: Record<string, Vec3> = {}
  for (const c of st.project.scene.characters) out[c.id] = c.position
  return out
}

export const totalAnimaticDuration = (st: ShotmachineState): number =>
  st.project.shots.reduce((acc, s) => acc + s.durationSec, 0)
