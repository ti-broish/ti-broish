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

/** Page geometry from the template's .docx: A4, 1417-twip side margins, 1640-twip top margin. */
const A4: [number, number] = [595.28, 841.89]
const MARGIN_X = 70.85
const MARGIN_TOP = 82
const MIN_BOTTOM = 36
const BLACK = rgb(0, 0, 0)
const BODY_SIZE = 12
const SANS_SIZE = 14
/** Single line spacing: Times New Roman ≈ 1.149 em, Calibri ≈ 1.221 em. */
const SERIF_LINE = 1.149
const SANS_LINE = 1.221
/** Heading 1 in the template is indented 3196 / 3208 twips, so the number wraps under the title. */
const TITLE_INDENT_LEFT = 159.8
const TITLE_INDENT_RIGHT = 160.4
const TITLE = 'Пълномощно'

type Fonts = { regular: PDFFont; bold: PDFFont; sans: PDFFont }
type Word = { text: string; font: PDFFont; size: number; width: number; spaceBefore: boolean }

interface DrawnLine {
  x: number
  /** Baseline. */
  y: number
  words: Word[]
  justifyTo: number | null
}

export async function renderDesignationPdf(input: DesignationRenderInput, config: DesignationConfig): Promise<Uint8Array> {
  const blocks = buildDesignationBlocks(input, config)
  const files = await loadDesignationFonts()
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const fonts: Fonts = {
    regular: await doc.embedFont(files.regular, { subset: true }),
    bold: await doc.embedFont(files.bold, { subset: true }),
    sans: await doc.embedFont(files.sans, { subset: true }),
  }
  const page = doc.addPage(A4)
  const number = displayedNumber(input, config)
  doc.setTitle(`${TITLE} № ${number}`)
  doc.setAuthor('Ти Броиш')
  doc.setCreator('Ти Броиш')
  doc.setProducer('Ти Броиш')
  doc.setLanguage('bg')
  const lines = layoutBlocks(fonts, blocks)
  if (Math.min(...lines.map((line) => line.y), A4[1]) < MIN_BOTTOM) {
    throw new Error('Пълномощното не се побра на една страница.')
  }
  for (const line of lines) drawLine(page, line)
  if (doc.getPageCount() !== 1) {
    throw new Error('Пълномощното не се побра на една страница.')
  }
  return doc.save()
}

function fontOf(run: TextRun, fonts: Fonts) {
  if (run.sans) return { font: fonts.sans, size: SANS_SIZE }
  return { font: run.bold ? fonts.bold : fonts.regular, size: BODY_SIZE }
}

function lineHeight(words: Word[]) {
  let height = BODY_SIZE * SERIF_LINE
  for (const word of words) height = Math.max(height, word.size * (word.size === SANS_SIZE ? SANS_LINE : SERIF_LINE))
  return height
}

function layoutBlocks(fonts: Fonts, blocks: DesignationBlock[]): DrawnLine[] {
  const left = MARGIN_X
  const right = A4[0] - MARGIN_X
  /** Top of the next line box. */
  let top = A4[1] - MARGIN_TOP
  const lines: DrawnLine[] = []

  const place = (words: Word[], x: number, justifyTo: number | null) => {
    const height = lineHeight(words)
    const ascent = height * 0.78
    lines.push({ x, y: top - ascent, words, justifyTo })
    top -= height
  }

  for (const block of blocks) {
    if (block.type === 'blank') {
      top -= block.spaceBefore + 11 * SERIF_LINE
      continue
    }
    if (block.type === 'title') {
      top -= block.spaceBefore
      const colLeft = left + TITLE_INDENT_LEFT
      const colRight = right - TITLE_INDENT_RIGHT
      const center = (colLeft + colRight) / 2
      for (const [text, font] of [
        [block.text, fonts.bold],
        [block.numberLine, fonts.regular],
      ] as const) {
        const width = font.widthOfTextAtSize(text, BODY_SIZE)
        place([{ text, font, size: BODY_SIZE, width, spaceBefore: false }], center - width / 2, null)
      }
      continue
    }
    if (block.type === 'bullet') {
      const markerWidth = fonts.regular.widthOfTextAtSize(block.marker, BODY_SIZE)
      const textX = left + Math.max(block.textAt, block.markerAt + markerWidth)
      const wrapped = wrapRuns([{ text: block.text }], fonts, right - textX, right - left)
      wrapped.forEach((words, index) => {
        const last = index === wrapped.length - 1
        if (index === 0) {
          lines.push({
            x: left + block.markerAt,
            y: top - lineHeight(words) * 0.78,
            words: [{ text: block.marker, font: fonts.regular, size: BODY_SIZE, width: markerWidth, spaceBefore: false }],
            justifyTo: null,
          })
        }
        place(words, index === 0 ? textX : left, last ? null : right)
      })
      continue
    }
    top -= block.spaceBefore
    const indentLeft = block.indentLeft ?? 0
    const firstLine = block.firstLineIndent ?? 0
    const lineLeft = left + indentLeft
    if (block.align === 'center') {
      const words = toWords(block.runs, fonts)
      const width = rowWidth(words)
      place(words, (left + right) / 2 - width / 2, null)
      continue
    }
    const wrapped = wrapRuns(block.runs, fonts, right - lineLeft - firstLine, right - lineLeft)
    wrapped.forEach((words, index) => {
      const last = index === wrapped.length - 1
      place(words, lineLeft + (index === 0 ? firstLine : 0), last ? null : right)
    })
  }
  return lines
}

/** Words keep their exact spacing: a run boundary or a space before a word is recorded, runs of spaces are kept. */
function toWords(runs: TextRun[], fonts: Fonts): Word[] {
  const words: Word[] = []
  let pendingSpaces = 0
  for (const run of runs) {
    const { font, size } = fontOf(run, fonts)
    for (const part of run.text.split(/( +)/)) {
      if (!part) continue
      if (/^ +$/.test(part)) {
        pendingSpaces += part.length
        continue
      }
      if (pendingSpaces > 1 && words.length > 0) {
        // Extra spaces (e.g. „ЕГН  “) are drawn as part of the gap.
        words[words.length - 1] = { ...words[words.length - 1]!, text: words[words.length - 1]!.text + ' '.repeat(pendingSpaces - 1) }
        const prev = words[words.length - 1]!
        prev.width = prev.font.widthOfTextAtSize(prev.text, prev.size)
      }
      words.push({ text: part, font, size, width: font.widthOfTextAtSize(part, size), spaceBefore: pendingSpaces > 0 && words.length > 0 })
      pendingSpaces = 0
    }
  }
  return words
}

function spaceWidth(word: Word) {
  return word.font.widthOfTextAtSize(' ', word.size)
}

function rowWidth(words: Word[]) {
  return words.reduce((sum, word, index) => sum + word.width + (index > 0 && word.spaceBefore ? spaceWidth(word) : 0), 0)
}

function wrapRuns(runs: TextRun[], fonts: Fonts, firstWidth: number, restWidth: number) {
  const words = toWords(runs, fonts)
  const lines: Word[][] = []
  let current: Word[] = []
  let used = 0
  let limit = firstWidth
  for (const word of words) {
    const extra = current.length > 0 && word.spaceBefore ? spaceWidth(word) : 0
    if (current.length > 0 && used + extra + word.width > limit + 0.01) {
      lines.push(current)
      current = [{ ...word, spaceBefore: false }]
      used = word.width
      limit = restWidth
      continue
    }
    current.push(current.length === 0 ? { ...word, spaceBefore: false } : word)
    used += extra + word.width
  }
  if (current.length) lines.push(current)
  return lines
}

function drawLine(page: PDFPage, line: DrawnLine) {
  if (line.words.length === 0) return
  const slots = line.words.filter((word, index) => index > 0 && word.spaceBefore).length
  let stretch = 0
  if (line.justifyTo != null && slots > 0) {
    stretch = Math.max(0, (line.justifyTo - line.x - rowWidth(line.words)) / slots)
  }
  let x = line.x
  line.words.forEach((word, index) => {
    if (index > 0 && word.spaceBefore) x += spaceWidth(word) + stretch
    page.drawText(word.text, { x, y: line.y, size: word.size, font: word.font, color: BLACK })
    x += word.width
  })
}
