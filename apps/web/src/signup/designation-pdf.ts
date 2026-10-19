import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { loadDesignationFonts } from './designation-fonts'
import { type DesignationConfig } from './designation-config'
import {
  buildDesignationBlocks,
  displayedNumber,
  type DesignationBlock,
  type DesignationRenderInput,
  type TextRun,
} from './designation-text'

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 72
const BLACK = rgb(0, 0, 0)
const BODY_SIZE = 12
const INFO_SIZE = 9
const FIRST_LINE_INDENT = 36
const TITLE = 'Пълномощно'

type Fonts = { regular: PDFFont; bold: PDFFont }

interface DrawnLine {
  x: number
  y: number
  size: number
  words: Array<{ text: string; bold: boolean; width: number }>
  justify: boolean
}

export async function renderDesignationPdf(input: DesignationRenderInput, config: DesignationConfig): Promise<Uint8Array> {
  const blocks = buildDesignationBlocks(input, config)
  const files = await loadDesignationFonts()
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const fonts: Fonts = {
    regular: await doc.embedFont(files.regular, { subset: true }),
    bold: await doc.embedFont(files.bold, { subset: true }),
  }
  const page = doc.addPage(A4)
  const number = displayedNumber(input, config)
  doc.setTitle(`${TITLE} № ${number}`)
  doc.setAuthor('Ти Броиш')
  doc.setCreator('Ти Броиш')
  doc.setProducer('Ти Броиш')
  doc.setLanguage('bg')
  layoutAndDraw(page, fonts, blocks)
  if (doc.getPageCount() !== 1) {
    throw new Error('Пълномощното не се побра на една страница.')
  }
  return doc.save()
}

function layoutAndDraw(page: PDFPage, fonts: Fonts, blocks: DesignationBlock[]) {
  const sizes = [BODY_SIZE, 11.5, 11, 10.5, 10]
  let fitted: DrawnLine[] | null = null
  for (const size of sizes) {
    const lines = layoutBlocks(fonts, blocks, size)
    fitted = lines
    const minY = Math.min(...lines.map((line) => line.y), A4[1])
    if (minY >= MARGIN - 1) {
      for (const line of lines) drawLine(page, fonts, line)
      return
    }
  }
  if (!fitted || Math.min(...fitted.map((line) => line.y), A4[1]) < 0) {
    throw new Error('Пълномощното не се побра на една страница.')
  }
  for (const line of fitted) drawLine(page, fonts, line)
}

function layoutBlocks(fonts: Fonts, blocks: DesignationBlock[], bodySize: number): DrawnLine[] {
  const { height } = { height: A4[1] }
  const width = A4[0] - MARGIN * 2
  const leading = bodySize * 1.22
  const paraGap = bodySize * 0.85
  let y = height - MARGIN - bodySize
  const lines: DrawnLine[] = []
  const info = blocks.find((block) => block.type === 'info')

  const push = (line: DrawnLine) => {
    lines.push(line)
    y -= leading
  }

  for (const block of blocks) {
    if (block.type === 'info') continue
    if (block.type === 'spacer') {
      y -= paraGap
      continue
    }
    if (block.type === 'title') {
      const titleSize = bodySize + 1
      const titleWidth = fonts.bold.widthOfTextAtSize(block.text, titleSize)
      push({
        x: (A4[0] - titleWidth) / 2,
        y,
        size: titleSize,
        words: [{ text: block.text, bold: true, width: titleWidth }],
        justify: false,
      })
      continue
    }
    if (block.type === 'center') {
      const font = block.bold ? fonts.bold : fonts.regular
      const textWidth = font.widthOfTextAtSize(block.text, bodySize)
      push({
        x: (A4[0] - textWidth) / 2,
        y,
        size: bodySize,
        words: [{ text: block.text, bold: Boolean(block.bold), width: textWidth }],
        justify: false,
      })
      continue
    }
    if (block.type === 'left') {
      for (const wrapped of wrapRuns(block.runs, fonts, bodySize, width, 0)) {
        push({ x: MARGIN, y, size: bodySize, words: wrapped, justify: false })
      }
      continue
    }
    if (block.type === 'paragraph') {
      const indent = block.firstLineIndent ? FIRST_LINE_INDENT : 0
      const wrapped = wrapRuns(block.runs, fonts, bodySize, width, indent)
      wrapped.forEach((words, index) => {
        const x = MARGIN + (index === 0 ? indent : 0)
        const last = index === wrapped.length - 1
        push({ x, y, size: bodySize, words, justify: !last && words.length > 1 })
      })
      continue
    }
    if (block.type === 'bullets') {
      // Template: dash at the margin, a tab to the first-line indent, continuation lines back at the margin.
      const markerWidth = fonts.regular.widthOfTextAtSize(block.marker, bodySize)
      for (const item of block.items) {
        const wrapped = wrapRuns([{ text: item }], fonts, bodySize, width, FIRST_LINE_INDENT)
        lines.push({ x: MARGIN, y, size: bodySize, words: [{ text: block.marker, bold: false, width: markerWidth }], justify: false })
        wrapped.forEach((words, index) => {
          const x = MARGIN + (index === 0 ? FIRST_LINE_INDENT : 0)
          const last = index === wrapped.length - 1
          push({ x, y, size: bodySize, words, justify: !last && words.length > 1 })
        })
      }
      continue
    }
    if (block.type === 'signature') {
      y -= leading * 0.4
      const heading = 'УПЪЛНОМОЩИТЕЛ:'
      const headingWidth = fonts.regular.widthOfTextAtSize(heading, bodySize)
      push({
        x: (A4[0] - headingWidth) / 2,
        y,
        size: bodySize,
        words: [{ text: heading, bold: false, width: headingWidth }],
        justify: false,
      })
      y -= leading * 1.6
      const dots = '........................'
      const dotsWidth = fonts.regular.widthOfTextAtSize(dots, bodySize)
      push({
        x: (A4[0] - dotsWidth) / 2,
        y,
        size: bodySize,
        words: [{ text: dots, bold: false, width: dotsWidth }],
        justify: false,
      })
      const signed = `/ ${block.grantorName} /`
      const signedWidth = fonts.regular.widthOfTextAtSize(signed, bodySize)
      push({
        x: (A4[0] - signedWidth) / 2,
        y,
        size: bodySize,
        words: [{ text: signed, bold: false, width: signedWidth }],
        justify: false,
      })
    }
  }

  if (info && info.type === 'info') {
    const infoWidth = A4[0] - MARGIN * 2
    const wrapped = wrapRuns([{ text: info.text }], fonts, INFO_SIZE, infoWidth, 0)
    let infoY = MARGIN - 4 + wrapped.length * (INFO_SIZE * 1.25)
    infoY = Math.min(infoY, y - leading)
    lines.push({
      x: MARGIN,
      y: infoY + INFO_SIZE * 1.6,
      size: INFO_SIZE,
      words: [{ text: '—', bold: false, width: fonts.regular.widthOfTextAtSize('—', INFO_SIZE) }],
      justify: false,
    })
    wrapped.forEach((words) => {
      lines.push({ x: MARGIN, y: infoY, size: INFO_SIZE, words, justify: false })
      infoY -= INFO_SIZE * 1.25
    })
  }
  return lines
}

function wrapRuns(runs: TextRun[], fonts: Fonts, size: number, maxWidth: number, firstLineIndent: number) {
  const tokens = tokenize(runs)
  const space = fonts.regular.widthOfTextAtSize(' ', size)
  const lines: Array<Array<{ text: string; bold: boolean; width: number }>> = []
  let current: Array<{ text: string; bold: boolean; width: number }> = []
  let used = 0
  let lineWidth = maxWidth - firstLineIndent

  const commit = () => {
    if (current.length === 0) return
    lines.push(current)
    current = []
    used = 0
    lineWidth = maxWidth
  }

  for (const token of tokens) {
    const font = token.bold ? fonts.bold : fonts.regular
    let width = font.widthOfTextAtSize(token.text, size)
    if (width > lineWidth && token.text.length > 1) {
      if (current.length) commit()
      const pieces = breakLong(token.text, font, size, lineWidth)
      for (let i = 0; i < pieces.length; i++) {
        const pieceWidth = font.widthOfTextAtSize(pieces[i] ?? '', size)
        current.push({ text: pieces[i] ?? '', bold: token.bold, width: pieceWidth })
        used = pieceWidth
        if (i < pieces.length - 1) commit()
      }
      continue
    }
    const extra = current.length === 0 || isPunct(token.text) ? width : space + width
    if (current.length > 0 && used + extra > lineWidth + 0.5) {
      commit()
      current.push({ text: token.text, bold: token.bold, width })
      used = width
      continue
    }
    current.push({ text: token.text, bold: token.bold, width })
    used += extra
  }
  commit()
  return lines
}

function breakLong(text: string, font: PDFFont, size: number, maxWidth: number) {
  const pieces: string[] = []
  let rest = text
  while (rest.length > 0) {
    if (font.widthOfTextAtSize(rest, size) <= maxWidth) {
      pieces.push(rest)
      break
    }
    let cut = rest.length - 1
    while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1
    pieces.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  return pieces
}

function tokenize(runs: TextRun[]) {
  const tokens: Array<{ text: string; bold: boolean }> = []
  for (const run of runs) {
    const parts = run.text.split(/(\s+)/)
    for (const part of parts) {
      if (!part || /^\s+$/.test(part)) continue
      tokens.push({ text: part, bold: Boolean(run.bold) })
    }
  }
  return tokens
}

function isPunct(text: string) {
  return /^[.,;:!?)]/.test(text)
}

function drawLine(page: PDFPage, fonts: Fonts, line: DrawnLine) {
  if (line.words.length === 0) return
  const space = fonts.regular.widthOfTextAtSize(' ', line.size)
  const wordWidth = line.words.reduce((sum, word) => sum + word.width, 0)
  const spaceSlots = line.words.filter((_, index) => index < line.words.length - 1 && !isPunct(line.words[index + 1]?.text ?? '')).length
  let gap = space
  if (line.justify && spaceSlots > 0) {
    const maxWidth = line.x === MARGIN + FIRST_LINE_INDENT ? A4[0] - MARGIN - (MARGIN + FIRST_LINE_INDENT) : A4[0] - MARGIN - line.x
    const raw = (maxWidth - wordWidth) / spaceSlots
    gap = Math.min(space * 2.1, Math.max(space * 0.85, raw))
  }
  let x = line.x
  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i]
    if (!word) continue
    page.drawText(word.text, {
      x,
      y: line.y,
      size: line.size,
      font: word.bold ? fonts.bold : fonts.regular,
      color: BLACK,
    })
    x += word.width
    if (i < line.words.length - 1 && !isPunct(line.words[i + 1]?.text ?? '')) x += gap
  }
}
