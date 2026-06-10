// ストーリーボードPDF出力。
// 日本語テキストはcanvas側でラスタライズ済み（boardPngのページ画像をPDFに埋め込む方式）。
// フォント埋め込み不要で日本語が確実に表示される。
import { PDFDocument } from 'pdf-lib'
import type { Project } from '../model/types'
import { exportBoardPngPages } from './boardPng'
import { downloadBlob } from './download'

const A4_LANDSCAPE: [number, number] = [841.89, 595.28] // pt

export async function downloadBoardPdf(project: Project): Promise<void> {
  const pages = await exportBoardPngPages(project)
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${project.name} — ストーリーボード`)
  pdf.setCreator('ショットマシン (Shot Machine)')
  for (const dataUrl of pages) {
    const png = await pdf.embedPng(dataUrl)
    const page = pdf.addPage(A4_LANDSCAPE)
    page.drawImage(png, { x: 0, y: 0, width: A4_LANDSCAPE[0], height: A4_LANDSCAPE[1] })
  }
  const bytes = await pdf.save()
  const buf = new Uint8Array(bytes)
  downloadBlob(new Blob([buf], { type: 'application/pdf' }), `${project.name}_storyboard.pdf`)
}
