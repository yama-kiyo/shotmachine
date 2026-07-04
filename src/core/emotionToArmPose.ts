// 台本の感情注記（自由文字列）から腕ポーズを推定する純関数（段階③ジェスチャーAI・B案）。
// 該当キーワードが無ければ 'natural' を返す。store側は 'natural' のときキーフレームを打たず、
// 既存の手動設定・既定挙動を温存する。調整用の 'tpose' は自動割当しない。
import type { ArmPose } from '../model/types'

// 評価順は配列の先頭から。先にマッチしたルールが優先される。
const RULES: ReadonlyArray<readonly [RegExp, ArmPose]> = [
  // 怒り・苛立ち → 腰に手
  [/怒|激怒|苛立|苛々|いらだ|むっと|不満|憤|キレ|不機嫌/, 'hands_on_hips'],
  // 困惑・思案・不安・疑い → 腕組み
  [/困惑|困|思案|考え|悩|不安|疑|戸惑|迷|警戒|慎重/, 'crossed'],
  // 喜び・挨拶・呼びかけ → 手を振る
  [/喜|嬉|笑|楽し|挨拶|呼びかけ|呼び掛け|歓迎|やあ|おーい|手を振|声をかけ/, 'wave'],
  // 強調・指示・断定・主張 → 指差し
  [/強調|指示|断定|主張|命令|指摘|宣言|力説|訴え|断言/, 'point'],
]

/**
 * 感情注記を腕ポーズへ写像する。
 * @param emotion 台本の感情注記（`名前（感情）「セリフ」` の感情部分）。未指定・空・未知語は 'natural'。
 */
export function emotionToArmPose(emotion?: string | null): ArmPose {
  if (!emotion) return 'natural'
  const e = emotion.trim()
  if (!e) return 'natural'
  for (const [re, pose] of RULES) {
    if (re.test(e)) return pose
  }
  return 'natural'
}
