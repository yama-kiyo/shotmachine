// 台本テキストのパーサ（純関数）
// 対応形式:
//   ミサキ「ご機嫌よう、ソウタ」
//   ミサキ（怒り）「いい加減にして」
//   ミサキ: セリフ / ミサキ：セリフ
//   話者のない行 → ト書き（アクション）
export interface ScriptLine {
  speaker: string | null // null = ト書き
  text: string
  emotion?: string
}

const KAKKO = /^(.+?)(?:（(.+?)）|\((.+?)\))?「(.+)」$/ // 名前（感情）「セリフ」
const COLON = /^(.{1,12}?)(?:（(.+?)）|\((.+?)\))?[:：]\s*(.+)$/ // 名前: セリフ

export function parseScript(raw: string): ScriptLine[] {
  const lines: ScriptLine[] = []
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim()
    if (!line) continue
    if (line.startsWith('#') || line.startsWith('//')) continue // コメント
    let m = line.match(KAKKO)
    if (m) {
      lines.push({ speaker: m[1].trim(), emotion: m[2] ?? m[3], text: m[4].trim() })
      continue
    }
    m = line.match(COLON)
    if (m) {
      lines.push({ speaker: m[1].trim(), emotion: m[2] ?? m[3], text: m[4].trim() })
      continue
    }
    lines.push({ speaker: null, text: line })
  }
  return lines
}

export const uniqueSpeakers = (lines: ScriptLine[]): string[] => {
  const out: string[] = []
  for (const l of lines) {
    if (l.speaker && !out.includes(l.speaker)) out.push(l.speaker)
  }
  return out
}

// 日本語の読み上げ尺の推定（TTS生成前のプレースホルダ。約6.5文字/秒＋前後の間）
export const estimateDurationSec = (text: string): number =>
  Math.max(1.6, Math.round((text.length / 6.5 + 0.7) * 10) / 10)
