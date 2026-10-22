import type { Project } from '../model/types'
import { serializeProject, deserializeProject } from '../model/serialization'
import { MAX_PROJECT_FILE_BYTES } from '../model/sanitize'
import { downloadText } from './download'

export function saveProjectFile(p: Project): void {
  const safe = p.name.replace(/[\\/:*?"<>|]/g, '_') || 'project'
  downloadText(serializeProject(p), `${safe}.shotmachine.json`, 'application/json')
}

export function openProjectFile(): Promise<Project> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return reject(new Error('ファイルが選択されませんでした'))
      // 巨大ファイルは読み込む前に拒否（メモリ保護）
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        return reject(new Error(`ファイルが大きすぎます（上限 ${MAX_PROJECT_FILE_BYTES / 1024 / 1024}MB）`))
      }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          resolve(deserializeProject(String(reader.result)))
        } catch (e) {
          reject(e)
        }
      }
      reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました'))
      reader.readAsText(file)
    }
    input.click()
  })
}
