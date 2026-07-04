// 時間帯ライティングプリセット（朝・昼・夕・夜）
// SceneContentの環境光・太陽光・背景色と、プロンプト生成の照明記述で共用する
import type { TimeOfDay } from '../model/types'

export interface LightingPreset {
  key: TimeOfDay
  label: string
  ambient: { color: string; intensity: number }
  sun: { color: string; intensity: number; position: [number, number, number] }
  background: string
  promptEn: string // プロンプト用の英語記述
}

export const TIME_OF_DAY_PRESETS: Record<TimeOfDay, LightingPreset> = {
  morning: {
    key: 'morning', label: '朝',
    ambient: { color: '#e8e2d4', intensity: 0.5 },
    sun: { color: '#ffd9a8', intensity: 1.25, position: [7, 3.2, 4] }, // 低い暖色の斜光
    background: '#46525f',
    promptEn: 'early morning, soft warm low-angle sunlight',
  },
  day: {
    key: 'day', label: '昼',
    ambient: { color: '#f2f2ee', intensity: 0.7 },
    sun: { color: '#fff2dc', intensity: 1.45, position: [4, 8, 5] },
    background: '#5b6878',
    promptEn: 'daytime, bright natural daylight',
  },
  evening: {
    key: 'evening', label: '夕',
    ambient: { color: '#d9b8a0', intensity: 0.42 },
    sun: { color: '#ff8b4a', intensity: 1.1, position: [-7, 2.4, 3] }, // 西日（-X側から低く）
    background: '#4d3a40',
    promptEn: 'golden hour evening, warm orange sunset light, long shadows',
  },
  night: {
    key: 'night', label: '夜',
    ambient: { color: '#aab6d8', intensity: 0.3 },
    sun: { color: '#b8c8f2', intensity: 0.5, position: [4, 8, -3] }, // 月光
    background: '#13161d',
    promptEn: 'night scene, dim cool moonlight, practical lights dominant',
  },
}

export const TIME_OF_DAY_ORDER: TimeOfDay[] = ['morning', 'day', 'evening', 'night']
