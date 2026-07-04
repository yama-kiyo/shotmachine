// 機材配置図（真上ビュー2D図面）のエクスポート。照明部・制作部に渡せる書類を目指す。
// 日本語テキストはcanvasでラスタライズ→PDF埋め込み（boardPdfと同方式）
import { PDFDocument } from 'pdf-lib'
import type { Project, Prop, CameraRig, Character } from '../model/types'
import { PROP_CATALOG } from '../model/defaults'
import { downloadBlob, downloadDataUrl } from './download'
import { deg } from '../core/math'

const PAGE_W = 1754 // A4横 150dpi
const PAGE_H = 1240
const MARGIN = 70
const HEADER_H = 80
const LEGEND_W = 330

export interface PlanTransform {
  scale: number // px / m
  toX: (worldX: number) => number
  toY: (worldZ: number) => number
}

// ワールド座標(XZ)→紙面座標の変換を決める（純関数・テスト対象）
export function makePlanTransform(
  roomW: number, roomD: number,
  paperW = PAGE_W - MARGIN * 2 - LEGEND_W, paperH = PAGE_H - MARGIN * 2 - HEADER_H,
  pad = 1.0, // 部屋外の機材用余白（m）
): PlanTransform {
  const wM = roomW + pad * 2
  const dM = roomD + pad * 2
  const scale = Math.min(paperW / wM, paperH / dM)
  const originX = MARGIN + (paperW - wM * scale) / 2 + pad * scale + (roomW / 2) * scale
  const originY = MARGIN + HEADER_H + (paperH - dM * scale) / 2 + pad * scale + (roomD / 2) * scale
  return {
    scale,
    toX: (x) => originX + x * scale,
    toY: (z) => originY + z * scale,
  }
}

function drawRotatedRect(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number,
  rotY: number, fill: string, stroke: string,
) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-rotY) // ワールドY回転は紙面では逆回り
  ctx.fillStyle = fill
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.5
  ctx.fillRect(-w / 2, -h / 2, w, h)
  ctx.strokeRect(-w / 2, -h / 2, w, h)
  ctx.restore()
}

function drawCameraSymbol(
  ctx: CanvasRenderingContext2D, t: PlanTransform, cam: CameraRig, crossed: boolean,
) {
  const x = t.toX(cam.pose.position.x)
  const y = t.toY(cam.pose.position.z)
  const az = Math.atan2(cam.pose.lookAt.x - cam.pose.position.x, cam.pose.lookAt.z - cam.pose.position.z)
  const color = crossed ? '#cc2222' : '#1a4f8a'
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(az + Math.PI) // 紙面Y下向き=+Z
  // カメラ本体（くさび形）
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-9, 16)
  ctx.lineTo(9, 16)
  ctx.closePath()
  ctx.fill()
  ctx.fillRect(-7, 16, 14, 10)
  ctx.restore()
  ctx.fillStyle = color
  ctx.font = 'bold 16px sans-serif'
  ctx.fillText(`${cam.name} ${Math.round(cam.pose.focalLength)}mm`, x + 14, y + 4)
}

export function renderFloorPlanCanvas(project: Project): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_W
  canvas.height = PAGE_H
  const ctx = canvas.getContext('2d')!
  const { room, props, characters, cameras } = project.scene
  const t = makePlanTransform(room.width, room.depth)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, PAGE_W, PAGE_H)

  // ヘッダー
  ctx.fillStyle = '#111'
  ctx.font = 'bold 30px sans-serif'
  ctx.fillText(`機材配置図 — ${project.name}`, MARGIN, MARGIN)
  ctx.font = '20px sans-serif'
  ctx.fillStyle = '#444'
  ctx.fillText(
    `${project.slugline}　　${new Date().toLocaleDateString('ja-JP')}　　縮尺 1m = ${t.scale.toFixed(0)}px`,
    MARGIN, MARGIN + 32,
  )

  // 部屋（床＋1mグリッド＋壁）
  const x0 = t.toX(-room.width / 2), x1 = t.toX(room.width / 2)
  const y0 = t.toY(-room.depth / 2), y1 = t.toY(room.depth / 2)
  ctx.fillStyle = '#f4f4f2'
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
  ctx.strokeStyle = '#dddddd'
  ctx.lineWidth = 1
  for (let gx = Math.ceil(-room.width / 2); gx <= room.width / 2; gx++) {
    ctx.beginPath(); ctx.moveTo(t.toX(gx), y0); ctx.lineTo(t.toX(gx), y1); ctx.stroke()
  }
  for (let gz = Math.ceil(-room.depth / 2); gz <= room.depth / 2; gz++) {
    ctx.beginPath(); ctx.moveTo(x0, t.toY(gz)); ctx.lineTo(x1, t.toY(gz)); ctx.stroke()
  }
  ctx.strokeStyle = '#222'
  ctx.lineWidth = 3
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
  // 壁の表現（太線）。壁は移動可能（backWallZ / sideWallX）なので実位置に描く
  ctx.lineWidth = 7
  const wallY = t.toY(room.backWallZ ?? -room.depth / 2)
  const wallX = t.toX(room.sideWallX ?? -room.width / 2)
  if (room.showBackWall) { ctx.beginPath(); ctx.moveTo(x0, wallY); ctx.lineTo(x1, wallY); ctx.stroke() }
  if (room.showSideWall) { ctx.beginPath(); ctx.moveTo(wallX, y0); ctx.lineTo(wallX, y1); ctx.stroke() }

  // セット美術（グレー）→ 機材（色付き＋記号）
  const setProps: Prop[] = props.filter((p) => (PROP_CATALOG[p.kind].category ?? 'set') === 'set')
  const equipProps: Prop[] = props.filter((p) => PROP_CATALOG[p.kind].category === 'equipment')
  ctx.font = '13px sans-serif'
  for (const p of setProps) {
    const def = PROP_CATALOG[p.kind]
    drawRotatedRect(
      ctx, t.toX(p.position.x), t.toY(p.position.z),
      def.size.w * p.scale.x * t.scale, def.size.d * p.scale.z * t.scale,
      p.rotationY, '#e3e1dc', '#8d8a83',
    )
    ctx.fillStyle = '#6b6862'
    ctx.fillText(p.name, t.toX(p.position.x) + 6, t.toY(p.position.z) - 6)
  }
  for (const p of equipProps) {
    const def = PROP_CATALOG[p.kind]
    drawRotatedRect(
      ctx, t.toX(p.position.x), t.toY(p.position.z),
      Math.max(def.size.w * p.scale.x * t.scale, 14), Math.max(def.size.d * p.scale.z * t.scale, 14),
      p.rotationY, '#ffe9b8', '#b8860b',
    )
    ctx.fillStyle = '#7a5b00'
    ctx.font = 'bold 15px sans-serif'
    ctx.fillText(def.planCode ?? '?', t.toX(p.position.x) - 8, t.toY(p.position.z) + 5)
    ctx.font = '13px sans-serif'
  }

  // アクション軸
  const axis = project.axis
  if (axis) {
    const a = characters.find((c) => c.id === axis.charAId)
    const b = characters.find((c) => c.id === axis.charBId)
    if (a && b) {
      ctx.save()
      ctx.strokeStyle = '#2aa198'
      ctx.setLineDash([10, 7])
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(t.toX(a.position.x), t.toY(a.position.z))
      ctx.lineTo(t.toX(b.position.x), t.toY(b.position.z))
      ctx.stroke()
      ctx.restore()
    }
  }

  // キャラクター（円＋向き矢印＋名前）
  for (const c of characters) {
    const x = t.toX(c.position.x), y = t.toY(c.position.z)
    ctx.fillStyle = c.color
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.stroke()
    // 向き矢印
    const fx = Math.sin(c.rotationY), fz = Math.cos(c.rotationY)
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + fx * 24, y + fz * 24)
    ctx.strokeStyle = c.color; ctx.lineWidth = 3; ctx.stroke()
    ctx.fillStyle = '#222'
    ctx.font = 'bold 16px sans-serif'
    ctx.fillText(c.name, x + 14, y - 10)
  }

  // カメラ
  for (const cam of cameras) {
    drawCameraSymbol(ctx, t, cam, false)
  }

  // 凡例（右側）
  const lx = PAGE_W - MARGIN - LEGEND_W
  let ly = MARGIN + HEADER_H
  ctx.fillStyle = '#111'
  ctx.font = 'bold 20px sans-serif'
  ctx.fillText('凡例', lx, ly)
  ly += 14
  ctx.font = '15px sans-serif'
  const legendItems: Array<[string, string]> = []
  const usedKinds = new Set(equipProps.map((p) => p.kind))
  for (const kind of usedKinds) {
    const def = PROP_CATALOG[kind]
    legendItems.push([def.planCode ?? '?', `${def.label}（×${equipProps.filter((p) => p.kind === kind).length}）`])
  }
  if (!legendItems.length) legendItems.push(['—', '機材なし（左パネル「撮影機材」から追加）'])
  for (const [code, label] of legendItems) {
    ly += 28
    ctx.fillStyle = '#ffe9b8'
    ctx.strokeStyle = '#b8860b'
    ctx.fillRect(lx, ly - 16, 22, 22)
    ctx.strokeRect(lx, ly - 16, 22, 22)
    ctx.fillStyle = '#7a5b00'
    ctx.font = 'bold 12px sans-serif'
    ctx.fillText(code, lx + 3, ly)
    ctx.fillStyle = '#333'
    ctx.font = '15px sans-serif'
    ctx.fillText(label, lx + 32, ly)
  }
  ly += 36
  ctx.fillStyle = '#1a4f8a'
  ctx.fillText('▲ カメラ（向き=レンズ方向）', lx, ly)
  ly += 26
  ctx.fillStyle = '#2aa198'
  ctx.fillText('---- アクション軸（180°ライン）', lx, ly)
  ly += 26
  ctx.fillStyle = '#333'
  ctx.fillText('● キャラクター（線=視線方向）', lx, ly)

  // スケールバー（1m）
  const sbY = PAGE_H - MARGIN + 10
  ctx.strokeStyle = '#111'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(MARGIN, sbY); ctx.lineTo(MARGIN + t.scale, sbY); ctx.stroke()
  ctx.font = '14px sans-serif'
  ctx.fillStyle = '#111'
  ctx.fillText('1m', MARGIN + t.scale + 8, sbY + 5)

  return canvas
}

export async function downloadFloorPlanPdf(project: Project): Promise<void> {
  const canvas = renderFloorPlanCanvas(project)
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${project.name} — 機材配置図`)
  pdf.setCreator('ショットマシン (Shot Machine)')
  const png = await pdf.embedPng(canvas.toDataURL('image/png'))
  const page = pdf.addPage([841.89, 595.28])
  page.drawImage(png, { x: 0, y: 0, width: 841.89, height: 595.28 })
  const bytes = await pdf.save()
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${project.name}_配置図.pdf`)
}

export function downloadFloorPlanPng(project: Project): void {
  const canvas = renderFloorPlanCanvas(project)
  downloadDataUrl(canvas.toDataURL('image/png'), `${project.name}_配置図.png`)
}
