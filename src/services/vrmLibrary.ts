// VRMライブラリ: ローカルフォルダ（例: プロジェクト内 vrm/）を一度選ぶと
// 中の .vrm を一覧表示してワンクリック割当できる。File System Access API使用。
// フォルダハンドルはIndexedDBに保存し、次回起動時も再利用（権限は再確認）。

export interface VrmEntry {
  name: string
  handle: FileSystemFileHandle
}

// ---- IndexedDB（軽量KV） ----
const DB_NAME = 'shotmachine-studio'
const KV_STORE = 'kv'
const DIR_KEY = 'vrmDirHandle'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(KV_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readwrite')
    tx.objectStore(KV_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readonly')
    const req = tx.objectStore(KV_STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

// ---- フォルダ選択・スキャン ----
async function scanDir(dir: FileSystemDirectoryHandle): Promise<VrmEntry[]> {
  const out: VrmEntry[] = []
  // @ts-expect-error: async iteratorの型がTS libに未定義の環境向け
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.toLowerCase().endsWith('.vrm')) {
      out.push({ name, handle: handle as FileSystemFileHandle })
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  return out
}

export function isFsApiAvailable(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

// フォルダを選んでスキャン（ハンドルを保存）
export async function pickVrmFolder(): Promise<VrmEntry[]> {
  const picker = (window as unknown as {
    showDirectoryPicker: (opts?: { id?: string; mode?: string }) => Promise<FileSystemDirectoryHandle>
  }).showDirectoryPicker
  const dir = await picker({ id: 'vrm-library', mode: 'read' })
  await kvSet(DIR_KEY, dir)
  return scanDir(dir)
}

// 保存済みフォルダを復元してスキャン（権限がなければ要求。ユーザー操作起点で呼ぶこと）
export async function restoreVrmFolder(): Promise<VrmEntry[] | null> {
  const dir = await kvGet<FileSystemDirectoryHandle>(DIR_KEY)
  if (!dir) return null
  const handle = dir as FileSystemDirectoryHandle & {
    queryPermission?: (d: { mode: string }) => Promise<string>
    requestPermission?: (d: { mode: string }) => Promise<string>
  }
  let perm = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted'
  if (perm !== 'granted') perm = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied'
  if (perm !== 'granted') return null
  return scanDir(dir)
}

export async function readVrmEntry(entry: VrmEntry): Promise<ArrayBuffer> {
  const file = await entry.handle.getFile()
  return file.arrayBuffer()
}
