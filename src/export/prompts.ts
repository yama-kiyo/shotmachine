import type { Project } from '../model/types'
import { allShotsPromptExport, shotToPromptJson } from '../core/promptGen'
import { downloadText } from './download'

export function exportPromptsMarkdown(p: Project): void {
  downloadText(allShotsPromptExport(p), `${p.name}_prompts.md`, 'text/markdown')
}

export function exportPromptsJson(p: Project): void {
  const data = p.shots.map((s, i) => shotToPromptJson(s, p, i))
  downloadText(JSON.stringify(data, null, 2), `${p.name}_prompts.json`, 'application/json')
}
