import { describe, it, expect } from 'vitest'
import { crc32, buildZip, toDosDateTime } from '../zipStore'

const u8 = (s: string): Uint8Array => new TextEncoder().encode(s)

// リトルエンディアン32bit読み出し
const readU32 = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
const readU16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8)

describe('zipStore: crc32', () => {
  it('既知の値と一致する', () => {
    // CRC32("hello") = 0x3610A686
    expect(crc32(u8('hello'))).toBe(0x3610a686)
    // 空入力は 0
    expect(crc32(new Uint8Array(0))).toBe(0)
  })
})

describe('zipStore: buildZip', () => {
  it('ローカルヘッダ・中央ディレクトリ・EOCDのシグネチャが並ぶ', () => {
    const zip = buildZip([
      { name: 'a.txt', data: u8('hello') },
      { name: 'b.txt', data: u8('world!') },
    ])
    // 先頭はローカルファイルヘッダ PK\x03\x04
    expect(readU32(zip, 0)).toBe(0x04034b50)

    // EOCD PK\x05\x06 は末尾22バイト（コメントなし）
    const eocdOff = zip.length - 22
    expect(readU32(zip, eocdOff)).toBe(0x06054b50)
    // エントリ数 = 2
    expect(readU16(zip, eocdOff + 8)).toBe(2)
    expect(readU16(zip, eocdOff + 10)).toBe(2)

    // 中央ディレクトリ先頭は EOCD が指すオフセットにあり PK\x01\x02
    const cdOffset = readU32(zip, eocdOff + 16)
    expect(readU32(zip, cdOffset)).toBe(0x02014b50)
  })

  it('ローカルヘッダにファイル名とCRC・サイズが入る', () => {
    const data = u8('hello')
    const zip = buildZip([{ name: 'a.txt', data }])
    expect(readU16(zip, 6)).toBe(0x0800) // UTF-8フラグ
    expect(readU16(zip, 8)).toBe(0) // STORE（無圧縮）
    expect(readU32(zip, 14)).toBe(0x3610a686) // CRC of "hello"
    expect(readU32(zip, 18)).toBe(data.length) // 圧縮後サイズ
    expect(readU32(zip, 22)).toBe(data.length) // 無圧縮サイズ
    expect(readU16(zip, 26)).toBe(u8('a.txt').length) // ファイル名長
    // ファイル名はヘッダ直後（30バイト目）から
    expect(new TextDecoder().decode(zip.slice(30, 30 + 5))).toBe('a.txt')
    // データはファイル名の直後に無圧縮で格納
    expect(new TextDecoder().decode(zip.slice(35, 35 + 5))).toBe('hello')
  })

  it('空エントリ配列でもEOCDのみで成立する', () => {
    const zip = buildZip([])
    expect(zip.length).toBe(22)
    expect(readU32(zip, 0)).toBe(0x06054b50)
    expect(readU16(zip, 8)).toBe(0)
  })

  it('mtime を固定すると DOS date/time がローカル・中央の両方に入り決定的になる', () => {
    // 2026-01-02 03:04:05（ローカルタイム）
    const mtime = new Date(2026, 0, 2, 3, 4, 5)
    // DOS date = ((2026-1980)<<9)|(1<<5)|2 = 0x5C22
    // DOS time = (3<<11)|(4<<5)|(5>>1)   = 0x1882
    const expDate = 0x5c22
    const expTime = 0x1882

    const zip = buildZip([{ name: 'a.txt', data: u8('hello') }], { mtime })
    // ローカルヘッダ: offset10=time / offset12=date
    expect(readU16(zip, 10)).toBe(expTime)
    expect(readU16(zip, 12)).toBe(expDate)
    // 中央ディレクトリ: offset12=time / offset14=date
    const eocdOff = zip.length - 22
    const cdOffset = readU32(zip, eocdOff + 16)
    expect(readU16(zip, cdOffset + 12)).toBe(expTime)
    expect(readU16(zip, cdOffset + 14)).toBe(expDate)

    // 同一入力・同一 mtime ならバイト完全一致（決定的）
    const zip2 = buildZip([{ name: 'a.txt', data: u8('hello') }], { mtime })
    expect(Array.from(zip)).toEqual(Array.from(zip2))
  })
})

describe('zipStore: toDosDateTime', () => {
  it('1980-01-01 00:00:00 → date=0x0021, time=0', () => {
    expect(toDosDateTime(new Date(1980, 0, 1, 0, 0, 0))).toEqual({ date: 0x0021, time: 0 })
  })

  it('1980未満は下限 1980-01-01 へクランプ', () => {
    expect(toDosDateTime(new Date(1970, 5, 15, 12, 30, 40))).toEqual({ date: 0x0021, time: 0 })
  })

  it('一般値 2026-01-02 03:04:05 → date=0x5C22, time=0x1882', () => {
    expect(toDosDateTime(new Date(2026, 0, 2, 3, 4, 5))).toEqual({ date: 0x5c22, time: 0x1882 })
  })
})
