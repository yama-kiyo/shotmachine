// 最小ZIPライター（STORE方式・無圧縮）。PNGは既に圧縮済みのため再圧縮しない。
// 依存ライブラリを増やさずブラウザ内でZIPを組み立てるための純関数。
// 参照: PKWARE APPNOTE（ローカルヘッダ PK\x03\x04 / 中央ディレクトリ PK\x01\x02 / EOCD PK\x05\x06）

export interface ZipEntry {
  name: string // ZIP内パス（UTF-8）
  data: Uint8Array
}

// CRC-32（IEEE 802.3、反転多項式 0xEDB88320）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// STORE方式のZIPバイト列を組み立てる。タイムスタンプは0固定（決定的な出力）。
// 戻り値は ArrayBuffer 裏付けを明示（Blob へ直接渡せるように）。
export function buildZip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder()
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0 // ローカルヘッダ領域内での各エントリ先頭オフセット

  for (const e of entries) {
    const nameBytes = enc.encode(e.name)
    const crc = crc32(e.data)
    const size = e.data.length

    // ローカルファイルヘッダ（30バイト固定 + ファイル名）
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true) // シグネチャ PK\x03\x04
    lv.setUint16(4, 20, true) // 展開に必要なバージョン(2.0)
    lv.setUint16(6, 0x0800, true) // 汎用フラグ: bit11 = ファイル名UTF-8
    lv.setUint16(8, 0, true) // 圧縮方式: 0=STORE
    lv.setUint16(10, 0, true) // 更新時刻
    lv.setUint16(12, 0, true) // 更新日付
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true) // 圧縮後サイズ（=無圧縮サイズ）
    lv.setUint32(22, size, true) // 無圧縮サイズ
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // 拡張フィールド長
    local.set(nameBytes, 30)
    localChunks.push(local, e.data)

    // 中央ディレクトリヘッダ（46バイト固定 + ファイル名）
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true) // シグネチャ PK\x01\x02
    cv.setUint16(4, 20, true) // 作成バージョン
    cv.setUint16(6, 20, true) // 展開に必要なバージョン
    cv.setUint16(8, 0x0800, true) // 汎用フラグ
    cv.setUint16(10, 0, true) // 圧縮方式
    cv.setUint16(12, 0, true) // 更新時刻
    cv.setUint16(14, 0, true) // 更新日付
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // 拡張フィールド長
    cv.setUint16(32, 0, true) // コメント長
    cv.setUint16(34, 0, true) // 開始ディスク番号
    cv.setUint16(36, 0, true) // 内部属性
    cv.setUint32(38, 0, true) // 外部属性
    cv.setUint32(42, offset, true) // ローカルヘッダのオフセット
    central.set(nameBytes, 46)
    centralChunks.push(central)

    offset += local.length + e.data.length
  }

  const centralOffset = offset
  let centralSize = 0
  for (const c of centralChunks) centralSize += c.length

  // EOCD（22バイト固定・コメントなし）
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // シグネチャ PK\x05\x06
  ev.setUint16(4, 0, true) // このディスク番号
  ev.setUint16(6, 0, true) // 中央ディレクトリ開始ディスク
  ev.setUint16(8, entries.length, true) // このディスクのエントリ数
  ev.setUint16(10, entries.length, true) // 総エントリ数
  ev.setUint32(12, centralSize, true) // 中央ディレクトリのサイズ
  ev.setUint32(16, centralOffset, true) // 中央ディレクトリのオフセット
  ev.setUint16(20, 0, true) // コメント長

  const total = centralOffset + centralSize + 22
  const out = new Uint8Array(total)
  let p = 0
  for (const c of localChunks) { out.set(c, p); p += c.length }
  for (const c of centralChunks) { out.set(c, p); p += c.length }
  out.set(eocd, p)
  return out
}
