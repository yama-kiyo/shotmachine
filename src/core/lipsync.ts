// リップシンク: ElevenLabsの文字タイムスタンプ→VRM表情（あいうえお口形状）
// VRM1標準のexpression名 'aa'|'ih'|'ou'|'ee'|'oh' に対応する
import type { Alignment } from '../model/types'

export type Viseme = 'aa' | 'ih' | 'ou' | 'ee' | 'oh' | null

const ROWS: Array<[RegExp, Viseme]> = [
  [/[あかがさざただなはばぱまやらわゃぁアカガサザタダナハバパマヤラワャァ]/, 'aa'],
  [/[いきぎしじちぢにひびぴみりぃイキギシジチヂニヒビピミリィ]/, 'ih'],
  [/[うくぐすずつづぬふぶぷむゆるゅぅウクグスズツヅヌフブプムユルュゥヴ]/, 'ou'],
  [/[えけげせぜてでねへべぺめれぇエケゲセゼテデネヘベペメレェ]/, 'ee'],
  [/[おこごそぞとどのほぼぽもよろをょぉオコゴソゾトドノホボポモヨロヲョォ]/, 'oh'],
]
const ROMAJI: Record<string, Viseme> = { a: 'aa', i: 'ih', u: 'ou', e: 'ee', o: 'oh' }

export function charToViseme(ch: string, prev: Viseme = null): Viseme {
  if (!ch) return null
  if (ch === 'ー' || ch === '〜') return prev // 長音は直前の母音を維持
  for (const [re, v] of ROWS) if (re.test(ch)) return v
  const low = ch.toLowerCase()
  if (low in ROMAJI) return ROMAJI[low]
  return null // ん・っ・句読点・空白などは口を閉じる
}

// 再生時刻tでの口形状。alignmentがなければnull（口閉じ）
export function visemeAt(alignment: Alignment | undefined, t: number): Viseme {
  if (!alignment || !alignment.chars.length) return null
  let prev: Viseme = null
  for (let i = 0; i < alignment.chars.length; i++) {
    const v = charToViseme(alignment.chars[i], prev)
    if (t >= alignment.starts[i] && t <= alignment.ends[i]) return v
    if (alignment.starts[i] > t) break
    prev = v ?? prev
  }
  return null
}

// 口形状→VRM expression重みのマップ（該当1つを0.85、他を0）
export function visemeWeights(v: Viseme): Record<'aa' | 'ih' | 'ou' | 'ee' | 'oh', number> {
  return {
    aa: v === 'aa' ? 0.85 : 0,
    ih: v === 'ih' ? 0.7 : 0,
    ou: v === 'ou' ? 0.75 : 0,
    ee: v === 'ee' ? 0.7 : 0,
    oh: v === 'oh' ? 0.8 : 0,
  }
}
