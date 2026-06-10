import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  Project, Character, Prop, PropKind, CameraRig, CameraPose, Shot, ShotSize, AspectRatio,
} from '../model/types'
import { aspectToNumber } from '../model/types'
import { sampleProject, emptyProject, makeCharacter, makeProp, makeCamera, genId } from '../model/defaults'
import { solveFraming, solveOTS, solvePOV, solveTwoShot, SHOT_SIZE_DEFS } from '../core/framing'
import { establishSide, checkCameraSide, SideStatus } from '../core/axis180'
import { generateCoverage } from '../core/coverage'
import { classifyMove } from '../core/moveClassifier'
import { lerpPose } from '../core/interpolate'
import type { Vec3 } from '../core/math'

export type SelectionType = 'character' | 'prop' | 'camera'
export interface Selection { type: SelectionType; id: string }

export type ViewMode = '3d' | 'top'
export type GizmoMode = 'translate' | 'rotate'
export type BottomTab = 'shots' | 'board' | 'animatic' | 'chat'
export type RightTab = 'object' | 'camera' | 'shot'

export interface Overlays {
  thirds: boolean
  safe: boolean
  axis180: boolean
  eyelines: boolean
  paths: boolean
  labels: boolean
}

// three層が登録するフレームキャプチャ関数（カメラポーズ→JPEG dataURL）
export type CaptureFn = (pose: CameraPose, aspect: number) => string
let captureFn: CaptureFn | null = null
export const registerCaptureFn = (fn: CaptureFn | null) => { captureFn = fn }

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

  // entities
  addCharacter: () => void
  addProp: (kind: PropKind) => void
  addCamera: () => CameraRig
  removeSelected: () => void
  updateCharacter: (id: string, patch: Partial<Character>) => void
  updateProp: (id: string, patch: Partial<Prop>) => void
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
  removeShot: (id: string) => void
  moveShot: (id: string, dir: -1 | 1) => void
  updateShot: (id: string, patch: Partial<Shot>) => void

  // playback
  setPlaying: (p: boolean) => void
  setPlayTime: (t: number) => void
}

export const useStore = create<ShotmachineState>()(
  immer((set, get) => ({
    project: sampleProject(),
    selection: null,
    viewMode: '3d',
    gizmoMode: 'translate',
    overlays: { thirds: true, safe: false, axis180: true, eyelines: true, paths: true, labels: true },
    bottomTab: 'shots',
    rightTab: 'camera',
    pipCameraId: 'cam_c',
    pipGrid: true,
    moveSlider: 0,
    playing: false,
    playTime: 0,
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
    updateCameraPose: (id, patch) =>
      set((st) => {
        const c = st.project.scene.cameras.find((c) => c.id === id)
        if (c) Object.assign(c.pose, patch)
      }),
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
      // 被写体: 選択キャラ or 軸キャラA or 先頭
      const axis = st.project.axis
      const target =
        (st.selection?.type === 'character' && chars.find((c) => c.id === st.selection!.id)) ||
        (axis && chars.find((c) => c.id === axis.charAId)) ||
        chars[0]
      if (!target) { set((s) => { s.toast = 'フレーミング対象のキャラクターがいません' }); return }
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
      })
    },

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
        subjectIds: framing?.subjectIds ?? st.project.scene.characters.slice(0, 1).map((c) => c.id),
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
        if (s) Object.assign(s, patch)
      }),

    setPlaying: (p) => set((st) => { st.playing = p }),
    setPlayTime: (t) => set((st) => { st.playTime = t }),
  })),
)

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
