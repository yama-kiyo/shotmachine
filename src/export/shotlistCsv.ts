// ショットリストCSV（香盤・現場連携用）。Excelで開けるようBOM付きUTF-8
import type { Project } from '../model/types'
import { shotNumber } from '../core/promptGen'
import { shotStarts } from '../core/cutTrack'
import { clipsOverlappingRange } from '../core/audioTrack'
import { secondsToTC, secondsToFC } from '../core/timecode'
import { downloadBlob } from './download'

const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`

export function shotlistCsv(project: Project): string {
  const header = [
    'ショット番号', 'カメラ', 'サイズ', 'レンズ(mm)', 'ムーブ',
    'IN', 'OUT', '尺(s+f)', '尺(秒)', '被写体', 'セリフ', 'ACTION', 'カメラ注記',
  ]
  const starts = shotStarts(project.shots)
  const rows = project.shots.map((s, i) => {
    const subjects = project.scene.characters
      .filter((c) => s.subjectIds.includes(c.id))
      .map((c) => c.name)
      .join(' / ')
    const inSec = starts[i]
    const outSec = inSec + s.durationSec
    const dialogue = clipsOverlappingRange(project.audioTrack, inSec, outSec)
      .map((c) => (c.speaker ? `${c.speaker}「${c.text}」` : c.text))
      .filter((t) => t.length > 0)
      .join('  ')
    return [
      shotNumber(i), s.cameraName, s.shotSize ?? '', String(Math.round(s.focalLength)), s.moveType,
      secondsToTC(inSec), secondsToTC(outSec), secondsToFC(s.durationSec), String(s.durationSec),
      subjects, dialogue, s.notes.action, s.notes.camera,
    ].map(esc).join(',')
  })
  return [header.map(esc).join(','), ...rows].join('\r\n')
}

export function downloadShotlistCsv(project: Project): void {
  const csv = '﻿' + shotlistCsv(project)
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${project.name}_shotlist.csv`)
}
