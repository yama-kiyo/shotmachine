// 姿勢ごとの身体メトリクス（フレーミングソルバ・POV・マネキン形状の共通基準）
// 立位を1.0とした実効的な「頭頂の高さ係数」と「目の高さ係数」を定義する
import type { Character, PoseState } from '../model/types'

export interface PoseMetrics {
  topNorm: number // 頭頂の高さ / 身長（立位=1.0）
  eyeNorm: number // 目の高さ / 身長
  label: string
}

// 人体計測の標準値ベース:
// 座位（椅子0.45m想定）: 頭頂 ≈ 0.77h、目 ≈ 0.70h
// しゃがみ: 頭頂 ≈ 0.55h、目 ≈ 0.48h
// 横臥: 体の厚み分（頭頂 ≈ 0.17h、目 ≈ 0.14h）
export const POSE_METRICS: Record<PoseState, PoseMetrics> = {
  stand:  { topNorm: 1.0,  eyeNorm: 0.93, label: '立つ' },
  sit:    { topNorm: 0.77, eyeNorm: 0.70, label: '座る' },
  crouch: { topNorm: 0.55, eyeNorm: 0.48, label: 'しゃがむ' },
  lie:    { topNorm: 0.17, eyeNorm: 0.14, label: '横になる' },
}

export const poseOf = (char: Character): PoseState => char.poseState ?? 'stand'

// 頭頂のワールドY
export const headTopY = (char: Character): number =>
  char.position.y + POSE_METRICS[poseOf(char)].topNorm * char.height

// 目のワールドY（POV・CU系のlook-at基準）
export const eyeY = (char: Character): number =>
  char.position.y + POSE_METRICS[poseOf(char)].eyeNorm * char.height
