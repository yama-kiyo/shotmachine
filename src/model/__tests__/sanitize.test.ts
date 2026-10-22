import { describe, it, expect, vi, afterEach } from 'vitest'
import { serializeProject, deserializeProject, deserializeProjectWithReport } from '../serialization'
import { sampleProject } from '../defaults'
import { isValidVoiceId, safeJsonParse, MAX_PROJECT_FILE_BYTES, LIMITS, STR_LIMITS } from '../sanitize'
import { ttsWithTimestamps } from '../../services/elevenlabs'

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='
const MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0U='

// sampleProject を JSON 化してから任意に改変したファイル文字列を作る
function tamper(fn: (o: Record<string, any>) => void): string {
  const o = JSON.parse(serializeProject(sampleProject()))
  fn(o)
  return JSON.stringify(o)
}

describe('読込値の検証（信頼できないプロジェクトファイル）', () => {
  it('voiceId は英数字1〜64文字のみ許可', () => {
    expect(isValidVoiceId('9BWtsMINqrJLrRacOk9x')).toBe(true)
    for (const bad of ['', '../../v1/user', 'a/b', 'a?x=1', 'a b', 'a%2F', 'x'.repeat(65), 1, null, {}]) {
      expect(isValidVoiceId(bad)).toBe(false)
    }
  })

  it('__proto__ / constructor / prototype キーは全階層で除去され、プロトタイプは汚染されない', () => {
    const json = '{"a":{"__proto__":{"polluted":1},"constructor":{"prototype":{"p2":1}},"ok":1}}'
    const r = safeJsonParse(json) as { a: Record<string, unknown> }
    expect(Object.keys(r.a)).toEqual(['ok'])
    // JSON.stringify では __proto__ キーを出せないので、ファイル文字列へ直接差し込む
    const p = deserializeProject(tamper(() => {}).replace('{', '{"__proto__":{"polluted":true},"voiceMap":{"__proto__":"9BWtsMINqrJLrRacOk9x","Maya":"9BWtsMINqrJLrRacOk9x","Dan":"../evil"},'))
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect((p as unknown as Record<string, unknown>).polluted).toBeUndefined()
    expect(p.voiceMap).toEqual({ Maya: '9BWtsMINqrJLrRacOk9x' })
    expect(Object.getPrototypeOf(p.voiceMap)).toBe(Object.prototype)
  })

  it('サムネイルは base64 画像 dataURL のみ（外部URL・javascript:・SVG は空に）', () => {
    const p = deserializeProject(tamper((o) => {
      o.shots = [0, 1, 2, 3].map((i) => ({
        id: `s${i}`, cameraId: 'cam_a', cameraName: 'CAM A', focalLength: 35, moveType: 'Static', subjectIds: [],
        durationSec: 3, notes: { action: '', camera: '' }, poseSnapshot: { a: o.scene.cameras[0].pose },
        thumbnail: [JPEG, 'https://evil.example/t.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4='][i],
        thumbnailB: 'https://evil.example/b.png',
      }))
    }))
    expect(p.shots.map((s) => s.thumbnail)).toEqual([JPEG, '', '', ''])
    expect(p.shots.every((s) => s.thumbnailB === undefined)).toBe(true)
  })

  it('audioTrack の audio は audio dataURL のみ、voiceId は不正なら落とす', () => {
    const p = deserializeProject(tamper((o) => {
      o.audioTrack = [
        { id: 'c1', speaker: 'Maya', text: 'a', startSec: 0, durationSec: 1, audio: MP3, voiceId: '9BWtsMINqrJLrRacOk9x' },
        { id: 'c2', speaker: 'Dan', text: 'b', startSec: 1, durationSec: 1, audio: 'https://evil.example/a.mp3', voiceId: '../../history' },
      ]
    }))
    expect(p.audioTrack[0].audio).toBe(MP3)
    expect(p.audioTrack[0].voiceId).toBe('9BWtsMINqrJLrRacOk9x')
    expect(p.audioTrack[1].audio).toBeUndefined()
    expect(p.audioTrack[1].voiceId).toBeUndefined()
  })

  it('色は16進のみ（CSS url() 等は既定色へ）、未知のプロップ種別は捨てる', () => {
    const p = deserializeProject(tamper((o) => {
      o.scene.characters[0].color = 'url(https://evil.example/x)'
      o.scene.props[0].color = 'red;background:url(//evil)'
      o.scene.props.push({ id: 'px', kind: 'toString', name: 'x', position: { x: 0, y: 0, z: 0 }, rotationY: 0, scale: { x: 1, y: 1, z: 1 } })
      o.scene.room.floorColor = 'url(//evil)'
    }))
    expect(p.scene.characters[0].color).toBe('#888888')
    expect(p.scene.props[0].color).toBeUndefined()
    expect(p.scene.props.find((x) => x.id === 'px')).toBeUndefined()
    expect(p.scene.room.floorColor).toBeUndefined()
  })

  it('壊れたキャラ・カメラ要素は捨てる／不正 aspect は既定へ', () => {
    const p = deserializeProject(tamper((o) => {
      o.scene.characters.push(null, 'x', { id: 1 })
      o.scene.cameras.push({ id: 'bad' })
      o.aspect = '</script>'
    }))
    expect(p.scene.characters).toHaveLength(sampleProject().scene.characters.length)
    expect(p.scene.cameras).toHaveLength(sampleProject().scene.cameras.length)
    expect(p.aspect).toBe('16:9')
  })

  it('上限サイズ超のファイルはパース前に拒否', () => {
    expect(() => deserializeProject(' '.repeat(MAX_PROJECT_FILE_BYTES + 1))).toThrow(/大きすぎ/)
  })
})

describe('ElevenLabs 呼び出しの voiceId 検証', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('不正な voiceId では fetch せずエラー', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => 'sk_dummy_test_key' })
    vi.stubGlobal('fetch', fetchSpy)
    await expect(ttsWithTimestamps('こんにちは', '../../v1/user')).rejects.toThrow(/ボイスID/)
    await expect(ttsWithTimestamps('こんにちは', '')).rejects.toThrow(/ボイスID/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('正しい voiceId は api.elevenlabs.io の想定パスへ送る', async () => {
    const fetchSpy = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    vi.stubGlobal('localStorage', { getItem: () => 'sk_dummy_test_key' })
    vi.stubGlobal('fetch', fetchSpy)
    await expect(ttsWithTimestamps('こんにちは', '9BWtsMINqrJLrRacOk9x')).rejects.toThrow(/401/)
    const url = String((fetchSpy.mock.calls[0] as unknown[])[0])
    expect(url.startsWith('https://api.elevenlabs.io/v1/text-to-speech/9BWtsMINqrJLrRacOk9x/with-timestamps')).toBe(true)
  })
})

describe('列挙値の正規化（描画で落ちないように）', () => {
  const baseShot = (o: Record<string, any>) => ({
    id: 's1', cameraId: 'cam_a', cameraName: 'CAM A', focalLength: 35, subjectIds: [],
    durationSec: 3, notes: { action: '', camera: '' }, poseSnapshot: { a: o.scene.cameras[0].pose }, thumbnail: '',
  })
  it('moveType 欠落・未知・非文字列は Static に（v2）', () => {
    const p = deserializeProject(tamper((o) => {
      o.shots = [
        baseShot(o),
        { ...baseShot(o), id: 's2', moveType: 'Teleport' },
        { ...baseShot(o), id: 's3', moveType: 42 },
        { ...baseShot(o), id: 's4', moveType: 'Pan' },
      ]
    }))
    expect(p.shots.map((s) => s.moveType)).toEqual(['Static', 'Static', 'Static', 'Pan'])
  })
  it('moveType 欠落は v1 移設ファイルでも Static に', () => {
    const p = deserializeProject(tamper((o) => {
      o.version = 1
      delete o.audioTrack
      o.shots = [{ ...baseShot(o), dialogue: { speaker: 'Maya', text: 123, alignment: { chars: [1], starts: [0], ends: [1] } } }]
    }))
    expect(p.shots[0].moveType).toBe('Static')
    expect(p.audioTrack[0].text).toBe('')
    expect(p.audioTrack[0].alignment).toBeUndefined()
  })
  it('shotSize・姿勢・腕・体型・時間帯の不正値は既定へ', () => {
    const p = deserializeProject(tamper((o) => {
      o.shots = [{ ...baseShot(o), shotSize: 'HUGE', notes: { action: 5 } }]
      o.scene.characters[0].poseState = 'fly'
      o.scene.characters[0].armPose = { x: 1 }
      o.scene.characters[0].bodyType = 'giant'
      o.scene.characters[0].keyframes = [{ time: 0, position: { x: 0, y: 0, z: 0 }, poseState: 'fly', armPose: 'x' }, { time: 'a' }]
      o.scene.timeOfDay = 'midnight'
    }))
    expect(p.shots[0].shotSize).toBeUndefined()
    expect(p.shots[0].notes).toEqual({ action: '', camera: '' })
    const c = p.scene.characters[0]
    expect([c.poseState, c.armPose, c.bodyType]).toEqual([undefined, undefined, undefined])
    expect(c.keyframes).toHaveLength(1)
    expect(c.keyframes![0].poseState).toBe('stand')
    expect(c.keyframes![0].armPose).toBe('natural')
    expect(p.scene.timeOfDay).toBeUndefined()
  })
})

describe('件数・文字数の上限（巨大ファイルでタブが固まらないように）', () => {
  it('20,000 キャラは上限まで切り詰めて通知、短時間で読み込める', () => {
    const json = tamper((o) => {
      const c0 = o.scene.characters[0]
      o.scene.characters = Array.from({ length: 20_000 }, (_, i) => ({ ...c0, id: `c${i}`, name: `C${i}` }))
    })
    const t0 = performance.now()
    const { project, warnings } = deserializeProjectWithReport(json)
    const ms = performance.now() - t0
    expect(project.scene.characters).toHaveLength(LIMITS.characters)
    expect(warnings.join()).toMatch(/キャラクター.*20000件中/)
    expect(ms).toBeLessThan(2000)
  })
  it('カメラ・プロップ・カット・音声クリップ・ボイス割当も上限で切る', () => {
    const { project: p, warnings } = deserializeProjectWithReport(tamper((o) => {
      const cam = o.scene.cameras[0]
      o.scene.cameras = Array.from({ length: LIMITS.cameras + 5 }, (_, i) => ({ ...cam, id: `k${i}` }))
      const pr = o.scene.props[0]
      o.scene.props = Array.from({ length: LIMITS.props + 5 }, (_, i) => ({ ...pr, id: `p${i}` }))
      o.shots = Array.from({ length: LIMITS.shots + 5 }, (_, i) => ({
        id: `s${i}`, cameraId: 'cam_a', cameraName: 'A', moveType: 'Static', focalLength: 35, subjectIds: [],
        durationSec: 1, notes: { action: '', camera: '' }, poseSnapshot: { a: cam.pose }, thumbnail: '',
      }))
      o.audioTrack = Array.from({ length: LIMITS.audioClips + 5 }, (_, i) => ({ id: `a${i}`, speaker: null, text: 't', startSec: i, durationSec: 1 }))
      o.voiceMap = Object.fromEntries(Array.from({ length: LIMITS.voiceMap + 5 }, (_, i) => [`S${i}`, '9BWtsMINqrJLrRacOk9x']))
    }))
    expect(p.scene.cameras).toHaveLength(LIMITS.cameras)
    expect(p.scene.props).toHaveLength(LIMITS.props)
    expect(p.shots).toHaveLength(LIMITS.shots)
    expect(p.audioTrack).toHaveLength(LIMITS.audioClips)
    expect(Object.keys(p.voiceMap!)).toHaveLength(LIMITS.voiceMap)
    expect(warnings).toHaveLength(5)
  })
  it('名前・スラッグライン・台本テキストの長さを切る', () => {
    const { project: p, warnings } = deserializeProjectWithReport(tamper((o) => {
      o.name = 'n'.repeat(10_000)
      o.slugline = 's'.repeat(10_000)
      o.scriptRaw = 'x'.repeat(STR_LIMITS.scriptRaw + 10)
      o.scene.characters[0].name = 'c'.repeat(10_000)
    }))
    expect(p.name).toHaveLength(STR_LIMITS.name)
    expect(p.slugline).toHaveLength(STR_LIMITS.slugline)
    expect(p.scriptRaw).toHaveLength(STR_LIMITS.scriptRaw)
    expect(p.scene.characters[0].name).toHaveLength(STR_LIMITS.objName)
    expect(warnings.join()).toMatch(/台本テキスト/)
  })
})
