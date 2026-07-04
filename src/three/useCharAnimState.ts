// キャラクターのキーフレーム評価フック（Mannequin / VRMAvatar 共用）
// 再生中・スクラブ中のみキーフレームを評価し、それ以外はベース状態を返す
import { useStore } from '../state/store'
import type { Character } from '../model/types'
import { charStateAt, baseCharState, CharAnimState } from '../core/charAnim'

export function useCharAnimState(char: Character): CharAnimState {
  const active = useStore((s) => (s.playing || s.animScrub) && (char.keyframes?.length ?? 0) > 0)
  const playTime = useStore((s) => (active ? s.playTime : -1))
  return active ? charStateAt(char, playTime) : baseCharState(char)
}
