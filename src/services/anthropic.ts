// Scene Chat: ユーザー自身のAnthropic APIキーでブラウザから直接呼び出す。
// キーはこのブラウザのlocalStorageにのみ保存され、Anthropic API以外には送信されない。
import Anthropic from '@anthropic-ai/sdk'
import { SCENE_TOOLS, executeTool } from './sceneTools'

const KEY_STORAGE = 'shotmachine.apiKey'
export const DEFAULT_MODEL = 'claude-opus-4-8'

export const getApiKey = (): string | null => localStorage.getItem(KEY_STORAGE)
export const setApiKey = (k: string): void => localStorage.setItem(KEY_STORAGE, k)
export const clearApiKey = (): void => localStorage.removeItem(KEY_STORAGE)

const SYSTEM_PROMPT = `あなたは3Dショット計画ツール「ショットマシン」のシーンアシスタントです。
監督の指示（例:「もっとローアングルにして」「MayaのCUにして」「2人が入る引きの画に」）を、提供されたツールでシーンに反映します。

ルール:
- まず get_scene_state で現状を確認してから操作する
- カメラを「低く/高く」は adjust_camera の dy で行う（注視点は固定なのでアングルが自然に変わる）
- ショットサイズの指定があれば frame_character を使う
- 操作後は何をしたかを1〜2文の日本語で簡潔に報告する。座標の羅列はしない
- 曖昧な指示は最も映画的に妥当な解釈で実行してよい`

export interface ChatEvent {
  type: 'text' | 'tool'
  content: string
}

// ツール使用ループ。各イベントをonEventで通知し、最終テキストを返す
export async function runChat(
  history: Anthropic.MessageParam[],
  onEvent: (e: ChatEvent) => void,
): Promise<Anthropic.MessageParam[]> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('APIキーが設定されていません')
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const messages: Anthropic.MessageParam[] = [...history]

  for (let i = 0; i < 8; i++) {
    const res = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: SCENE_TOOLS as Anthropic.Tool[],
      messages,
    })
    messages.push({ role: 'assistant', content: res.content })
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    for (const block of res.content) {
      if (block.type === 'text' && block.text.trim()) onEvent({ type: 'text', content: block.text })
    }
    if (res.stop_reason !== 'tool_use' || toolUses.length === 0) break
    const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => {
      const result = executeTool(tu.name, (tu.input ?? {}) as Record<string, unknown>)
      onEvent({ type: 'tool', content: `🔧 ${tu.name}: ${result.slice(0, 120)}` })
      return { type: 'tool_result', tool_use_id: tu.id, content: result }
    })
    messages.push({ role: 'user', content: results })
  }
  return messages
}
