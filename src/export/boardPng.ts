// ストーリーボードのPNGコンタクトシート出力（A4横相当、3×2=6パネル/ページ）
// 業界慣習: ショット番号(1A,1B…)、サイズ略号、レンズ、ムーブ矢印表記、ACTION/NOTES欄
import type { Project, Shot, MoveType } from '../model/types'
import { shotNumber } from '../core/promptGen'
import { downloadDataUrl } from './download'
import { aspectToNumber } from '../model/types'

const PAGE_W = 1754 // A4横 150dpi
const PAGE_H = 1240
const COLS = 3
const ROWS = 2
const MARGIN = 60
const HEADER_H = 70
const GAP = 28

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// ムーブの矢印・注記（慣習: パン/ティルトはフレーム外縁矢印、プッシュは四隅内向き矢印＋枠重ね）
function drawMoveAnnotation(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, move: MoveType,
) {
  if (move === 'Static') return
  ctx.save()
  ctx.strokeStyle = '#ffd24d'
  ctx.fillStyle = '#ffd24d'
  ctx.lineWidth = 3
  ctx.font = 'bold 18px sans-serif'
  const label: Record<string, string> = {
    Pan: 'PAN →', Tilt: 'TILT ↑', 'Push-in': 'PUSH-IN', 'Pull-out': 'PULL-OUT',
    'Truck L': '← TRUCK', 'Truck R': 'TRUCK →', 'Pedestal Up': 'PED ↑', 'Pedestal Down': 'PED ↓',
    Arc: 'ARC ⟳', Zoom: 'ZOOM', Compound: 'MOVE A→B',
  }
  ctx.shadowColor = 'rgba(0,0,0,0.9)'
  ctx.shadowBlur = 6
  ctx.fillText(label[move] ?? move, x + 12, y + 28)
  if (move === 'Push-in' || move === 'Zoom') {
    // 終了フレーミング枠（内側70%）＋四隅から内向き矢印
    const iw = w * 0.7, ih = h * 0.7
    const ix = x + (w - iw) / 2, iy = y + (h - ih) / 2
    ctx.setLineDash([10, 6])
    ctx.strokeRect(ix, iy, iw, ih)
    ctx.setLineDash([])
    for (const [cx, cy, tx, ty] of [
      [x + 8, y + 8, ix, iy], [x + w - 8, y + 8, ix + iw, iy],
      [x + 8, y + h - 8, ix, iy + ih], [x + w - 8, y + h - 8, ix + iw, iy + ih],
    ]) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke()
    }
  } else if (move === 'Pull-out') {
    const iw = w * 0.7, ih = h * 0.7
    const ix = x + (w - iw) / 2, iy = y + (h - ih) / 2
    ctx.setLineDash([10, 6])
    ctx.strokeRect(ix, iy, iw, ih)
    ctx.setLineDash([])
    for (const [cx, cy, tx, ty] of [
      [ix, iy, x + 8, y + 8], [ix + iw, iy, x + w - 8, y + 8],
      [ix, iy + ih, x + 8, y + h - 8], [ix + iw, iy + ih, x + w - 8, y + h - 8],
    ]) {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke()
    }
  } else {
    // 下部の太い方向矢印
    const ay = y + h - 24
    const dir = move === 'Truck L' ? -1 : 1
    ctx.beginPath()
    ctx.moveTo(x + w / 2 - 60 * dir, ay)
    ctx.lineTo(x + w / 2 + 60 * dir, ay)
    ctx.lineTo(x + w / 2 + 45 * dir, ay - 10)
    ctx.moveTo(x + w / 2 + 60 * dir, ay)
    ctx.lineTo(x + w / 2 + 45 * dir, ay + 10)
    ctx.stroke()
  }
  ctx.restore()
}

async function renderPage(
  project: Project, shots: Shot[], startIndex: number, pageNum: number, totalPages: number,
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_W
  canvas.height = PAGE_H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)

  // ヘッダー
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText(project.name, MARGIN, MARGIN)
  ctx.font = '20px sans-serif'
  ctx.fillStyle = '#444444'
  ctx.fillText(project.slugline, MARGIN, MARGIN + 30)
  const dateStr = new Date().toLocaleDateString('ja-JP')
  const right = `${dateStr}　p.${pageNum}/${totalPages}`
  ctx.fillText(right, PAGE_W - MARGIN - ctx.measureText(right).width, MARGIN)

  const ar = aspectToNumber(project.aspect)
  const cellW = (PAGE_W - MARGIN * 2 - GAP * (COLS - 1)) / COLS
  const frameH = cellW / ar
  const infoH = 92
  const cellH = frameH + infoH
  const startY = MARGIN + HEADER_H

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const x = MARGIN + col * (cellW + GAP)
    const y = startY + row * (cellH + GAP)

    // フレーム
    ctx.fillStyle = '#000000'
    ctx.fillRect(x, y, cellW, frameH)
    const img = await loadImage(shot.thumbnail)
    if (img) ctx.drawImage(img, x, y, cellW, frameH)
    ctx.strokeStyle = '#222222'
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, cellW, frameH)
    drawMoveAnnotation(ctx, x, y, cellW, frameH, shot.moveType)

    // 情報欄
    const num = shotNumber(startIndex + i)
    ctx.fillStyle = '#111111'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText(num, x, y + frameH + 28)
    ctx.font = '17px sans-serif'
    ctx.fillStyle = '#333333'
    const sizeStr = shot.shotSize ?? '—'
    ctx.fillText(
      `${sizeStr}  ·  ${Math.round(shot.focalLength)}mm  ·  ${shot.moveType}  ·  ${shot.durationSec}s  ·  ${shot.cameraName}`,
      x + 60, y + frameH + 28,
    )
    ctx.fillStyle = '#555555'
    ctx.font = '15px sans-serif'
    const action = shot.notes.action ? `ACTION: ${shot.notes.action}` : ''
    const camN = shot.notes.camera ? `NOTES: ${shot.notes.camera}` : ''
    if (action) ctx.fillText(action.slice(0, 60), x, y + frameH + 54)
    if (camN) ctx.fillText(camN.slice(0, 60), x, y + frameH + 76)
  }
  return canvas.toDataURL('image/png')
}

export async function exportBoardPngPages(project: Project): Promise<string[]> {
  const perPage = COLS * ROWS
  const pages: string[] = []
  const totalPages = Math.max(1, Math.ceil(project.shots.length / perPage))
  for (let p = 0; p < totalPages; p++) {
    const slice = project.shots.slice(p * perPage, (p + 1) * perPage)
    pages.push(await renderPage(project, slice, p * perPage, p + 1, totalPages))
  }
  return pages
}

export async function downloadBoardPng(project: Project): Promise<void> {
  const pages = await exportBoardPngPages(project)
  pages.forEach((dataUrl, i) => {
    downloadDataUrl(dataUrl, `${project.name}_board_p${i + 1}.png`)
  })
}
