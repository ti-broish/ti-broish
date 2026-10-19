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

/** Page geometry from the template's .docx: 11920 × 16840 twips (as in the reference PDF), 1417-twip side margins, 1640-twip top margin. */
const A4: [number, number] = [596, 842]
const MARGIN_X = 70.85
const MARGIN_TOP = 82
/** The template has a 0 bottom margin; keep the last line clear of a printer’s unprintable edge. */
const MIN_BOTTOM = 18
const BLACK = rgb(0, 0, 0)
const BODY_SIZE = 12
const SANS_SIZE = 14
/**
 * Single line spacing per face, in em, as the reference PDF lays it out: the line box is
 * ascender + descender + line gap, with the gap above the text (Times New Roman / Tinos
 * 1825 + 443 + 87, Arial / Arimo 1854 + 434 + 67, Calibri 1536 + 512 + 452, per 2048).
 */
const LINE_METRICS = {
  serif: { height: 2355 / 2048, ascent: 1912 / 2048 },
  arial: { height: 2355 / 2048, ascent: 1921 / 2048 },
  calibri: { height: 2500 / 2048, ascent: 1988 / 2048 },
} as const
type LineMetrics = keyof typeof LINE_METRICS
/** Heading 1 in the template is indented 3196 / 3208 twips, so the number wraps under the title. */
const TITLE_INDENT_LEFT = 159.8
const TITLE_INDENT_RIGHT = 160.4
const TITLE = 'Пълномощно'

type Kit = ReturnType<typeof fontkit.create>
type Face = { font: PDFFont; kit: Kit; kerning: Map<string, number>; metrics: LineMetrics }
type Fonts = { regular: Face; bold: Face; sans: Face; sansCyrillic: Face }
/** A word's glyphs are drawn in pieces so pair kerning (as Google Docs and Word apply it) is kept. */
type Piece = { text: string; dx: number }
type Word = { text: string; face: Face; size: number; width: number; spaceBefore: boolean; pieces: Piece[] }
const CYRILLIC = /[\u0400-\u04ff]/

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
  const face = async (bytes: Uint8Array, metrics: LineMetrics): Promise<Face> => ({
    font: await doc.embedFont(bytes, { subset: true }),
    kit: fontkit.create(bytes) as Kit,
    kerning: new Map(),
    metrics,
  })
  const fonts: Fonts = {
    regular: await face(files.regular, 'serif'),
    bold: await face(files.bold, 'serif'),
    sans: await face(files.sans, 'calibri'),
    sansCyrillic: await face(files.sansCyrillic, 'arial'),
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

function fontOf(run: TextRun, fonts: Fonts, text: string) {
  if (run.sans) return { face: CYRILLIC.test(text) ? fonts.sansCyrillic : fonts.sans, size: SANS_SIZE }
  return { face: run.bold ? fonts.bold : fonts.regular, size: BODY_SIZE }
}

/** Pair kerning between two characters, in font units (0 when the face has none). */
function kerning(face: Face, a: string, b: string) {
  const key = a + b
  let value = face.kerning.get(key)
  if (value === undefined) {
    const run = face.kit.layout(key)
    value = run.glyphs.length === 2 ? run.positions[0]!.xAdvance - run.glyphs[0]!.advanceWidth : 0
    face.kerning.set(key, value)
  }
  return value
}

function makeWord(text: string, face: Face, size: number, spaceBefore: boolean): Word {
  const chars = [...text]
  const scale = size / face.kit.unitsPerEm
  const pieces: Piece[] = []
  let x = 0
  let current = ''
  let start = 0
  chars.forEach((char, index) => {
    if (!current) start = x
    current += char
    x += face.font.widthOfTextAtSize(char, size)
    const next = chars[index + 1]
    const kern = next ? kerning(face, char, next) * scale : 0
    if (kern !== 0 || !next) {
      pieces.push({ text: current, dx: start })
      current = ''
      x += kern
    }
  })
  return { text, face, size, width: x, spaceBefore, pieces }
}

/** Line box height and baseline offset from its top: the tallest face on the line wins. */
function lineBox(words: Word[]) {
  let height = BODY_SIZE * LINE_METRICS.serif.height
  let ascent = BODY_SIZE * LINE_METRICS.serif.ascent
  for (const word of words) {
    const metrics = LINE_METRICS[word.face.metrics]
    height = Math.max(height, word.size * metrics.height)
    ascent = Math.max(ascent, word.size * metrics.ascent)
  }
  return { height, ascent }
}

function layoutBlocks(fonts: Fonts, blocks: DesignationBlock[]): DrawnLine[] {
  const left = MARGIN_X
  const right = A4[0] - MARGIN_X
  /** Top of the next line box. */
  let top = A4[1] - MARGIN_TOP
  const lines: DrawnLine[] = []

  const place = (words: Word[], x: number, justifyTo: number | null) => {
    const { height, ascent } = lineBox(words)
    lines.push({ x, y: top - ascent, words, justifyTo })
    top -= height
  }

  for (const block of blocks) {
    if (block.type === 'blank') {
      top -= block.spaceBefore + BODY_SIZE * LINE_METRICS.serif.height
      continue
    }
    if (block.type === 'title') {
      top -= block.spaceBefore
      const colLeft = left + TITLE_INDENT_LEFT
      const colRight = right - TITLE_INDENT_RIGHT
      const center = (colLeft + colRight) / 2
      for (const [text, face] of [
        [block.text, fonts.bold],
        [block.numberLine, fonts.regular],
      ] as const) {
        const word = makeWord(text, face, BODY_SIZE, false)
        place([word], center - word.width / 2, null)
      }
      continue
    }
    if (block.type === 'bullet') {
      const marker = makeWord(block.marker, fonts.regular, BODY_SIZE, false)
      const textX = left + Math.max(block.textAt, block.markerAt + marker.width)
      const itemRight = right - block.indentRight
      const wrapped = wrapRuns([{ text: block.text }], fonts, itemRight - textX, itemRight - left - block.wrapAt)
      wrapped.forEach((words, index) => {
        const last = index === wrapped.length - 1
        if (index === 0) {
          lines.push({
            x: left + block.markerAt,
            y: top - lineBox(words).ascent,
            words: [marker],
            justifyTo: null,
          })
        }
        // Wrapped lines of a list item return to the item's own left indent (w:ind w:left="23").
        place(words, index === 0 ? textX : left + block.wrapAt, last ? null : itemRight)
      })
      continue
    }
    top -= block.spaceBefore
    const indentLeft = block.indentLeft ?? 0
    const firstLine = block.firstLineIndent ?? 0
    const lineLeft = left + indentLeft
    const lineRight = right - (block.indentRight ?? 0)
    if (block.align === 'center') {
      const words = toWords(block.runs, fonts)
      const width = rowWidth(words)
      place(words, (lineLeft + lineRight) / 2 - width / 2, null)
      continue
    }
    const wrapped = wrapRuns(block.runs, fonts, lineRight - lineLeft - firstLine, lineRight - lineLeft)
    wrapped.forEach((words, index) => {
      const last = index === wrapped.length - 1
      place(words, lineLeft + (index === 0 ? firstLine : 0), last ? null : lineRight)
    })
  }
  return lines
}

/** Words keep their exact spacing: a run boundary or a space before a word is recorded, runs of spaces are kept. */
function toWords(runs: TextRun[], fonts: Fonts): Word[] {
  const words: Word[] = []
  let pendingSpaces = 0
  for (const run of runs) {
    for (const part of run.text.split(/( +)/)) {
      if (!part) continue
      if (/^ +$/.test(part)) {
        pendingSpaces += part.length
        continue
      }
      if (pendingSpaces > 1 && words.length > 0) {
        // Extra spaces (e.g. „ЕГН  “) are drawn as part of the gap.
        const prev = words[words.length - 1]!
        words[words.length - 1] = makeWord(prev.text + ' '.repeat(pendingSpaces - 1), prev.face, prev.size, prev.spaceBefore)
      }
      // In the sans runs Cyrillic is set in Arimo and everything else (<<, >>, digits) in Carlito, glued together.
      const segments = run.sans ? (part.match(/[\u0400-\u04ff]+|[^\u0400-\u04ff]+/g) ?? [part]) : [part]
      segments.forEach((segment, index) => {
        const { face, size } = fontOf(run, fonts, segment)
        words.push(makeWord(segment, face, size, index === 0 && pendingSpaces > 0 && words.length > 0))
      })
      pendingSpaces = 0
    }
  }
  return words
}

function spaceWidth(word: Word) {
  return word.face.font.widthOfTextAtSize(' ', word.size)
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
    if (current.length > 0 && word.spaceBefore && used + extra + word.width > limit + 0.01) {
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
    for (const piece of word.pieces) {
      page.drawText(piece.text, { x: x + piece.dx, y: line.y, size: word.size, font: word.face.font, color: BLACK })
    }
    x += word.width
  })
}
