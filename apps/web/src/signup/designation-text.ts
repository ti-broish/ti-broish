import {
  REPRESENTATIVE_RIGHTS,
  TODO_GRANTOR_EGN,
  TODO_GRANTOR_NAME,
  TODO_NUMBER,
  TODO_PERSON_EGN,
  TODO_PERSON_NAME,
  TODO_PRINCIPAL_EGN,
  TODO_PRINCIPAL_NAME,
  districtLineOf,
  formatBgDate,
  formatDesignationNumber,
  verbForCapacity,
  type DesignationConfig,
  type DesignationGrantorFields,
} from './designation-config'
import { formatNumberWithDate } from './designation-number'

export type DesignationGrantor = DesignationGrantorFields

export interface DesignationPersonInput {
  firstName: string
  middleName: string
  lastName: string
  egn: string
  sectionCode: string
  sectionPlace: string
}

export interface DesignationRenderInput {
  number: string | number | null
  issuedOn: string
  grantor: DesignationGrantor
  person: DesignationPersonInput
}

/** `sans` is Calibri in the template (Carlito here), at 14 pt; everything else is Times New Roman 12 pt. */
export type TextRun = { text: string; bold?: boolean; sans?: boolean }

/**
 * Layout follows the committee's .docx (all lengths in pt, from twips / 20):
 * paragraph spacing before, alignment, first-line and left indents, and the
 * list items' marker and text positions.
 */
export type DesignationBlock =
  | { type: 'title'; text: string; numberLine: string; spaceBefore: number }
  | {
      type: 'paragraph'
      runs: TextRun[]
      align: 'justify' | 'center'
      spaceBefore: number
      indentLeft?: number
      /** w:ind w:right of the paragraph. */
      indentRight?: number
      firstLineIndent?: number
    }
  | {
      type: 'bullet'
      marker: string
      text: string
      markerAt: number
      textAt: number
      /** Where wrapped lines start (the paragraph's w:ind w:left). */
      wrapAt: number
      indentRight: number
    }
  | { type: 'blank'; spaceBefore: number }

/** Template paragraph spacing: w:before="276" (13.8 pt) on most paragraphs. */
export const SPACE_BEFORE = 13.8
/**
 * w:ind w:left="23" (1.15 pt): body paragraphs sit just in from the margin. The committee's
 * reference PDF (Google Docs) snaps left indents to whole pixels, so it is 2 px = 1.5 pt there.
 */
export const BODY_INDENT = 1.5
/** w:firstLine="705" on the mandate paragraph. */
export const MANDATE_FIRST_LINE = 35.25
/** Centred headings: w:ind w:left="850" w:right="862". */
export const CENTER_INDENT = { indentLeft: 42.5, indentRight: 43.1 } as const

export function personFullName(person: Pick<DesignationPersonInput, 'firstName' | 'middleName' | 'lastName'>) {
  const name = [person.firstName, person.middleName, person.lastName].map((part) => part.trim()).filter(Boolean).join(' ')
  return name || TODO_PERSON_NAME
}

export function visibleOrTodo(value: string, todo: string) {
  const trimmed = value.trim()
  return trimmed || todo
}

/** Optional clause about the grantor's own authorisation; the template has none. */
export function grantorAuthorisationClause(grantor: DesignationGrantor) {
  if (grantor.capacity !== 'пълномощник') return ''
  const clause = grantor.authorisation.trim().replace(/^[,\s]+/, '').replace(/[.\s]+$/, '')
  return clause ? `, ${clause}` : ''
}

/** Committee name followed by its registration, as worded in the template. */
export function committeeWithRegistration(config: DesignationConfig) {
  return `${config.committeeFullName}, ${config.committeeRegistration}`
}

export function rightsMandateParagraph(person: DesignationPersonInput, config: DesignationConfig) {
  const district = districtLineOf(person.sectionCode)
  return `Да бъде ПРЕДСТАВИТЕЛ на ${committeeWithRegistration(config)} в ${district}.`
}

export function territoryParagraph(config: DesignationConfig) {
  return `Представителят разполага с гореизброените права за всяка от избирателните секции на територията на района, при условие, че носи утвърдения от ЦИК отличителен знак и в съответното изборно помещение не присъства друг упълномощен представител на ${config.committeeShortName}.`
}

export function termParagraph(config: DesignationConfig) {
  return `Настоящото пълномощно се издава със срок до ${formatBgDate(config.validUntil)} г. и следва да се тълкува разширително в полза на упълномощеното лице.`
}

/** The template's opening paragraph, which ends on „(ИК)“ with no full stop. */
export function grantorOpening(grantor: DesignationGrantor, config: DesignationConfig) {
  const name = visibleOrTodo(grantor.name, TODO_GRANTOR_NAME)
  const egn = visibleOrTodo(grantor.egn, TODO_GRANTOR_EGN)
  const committee = `${committeeWithRegistration(config)} (ИК)`
  if (grantor.capacity === 'представляващ') {
    return `Подписаният ${name}, ЕГН ${egn}, в качеството ми на представляващ самостоятелно ${committee}`
  }
  const principalName = visibleOrTodo(grantor.principalName, TODO_PRINCIPAL_NAME)
  const principalEgn = visibleOrTodo(grantor.principalEgn, TODO_PRINCIPAL_EGN)
  return `Подписаният ${name}, ЕГН ${egn}, в качеството ми на пълномощник на ${principalName}, ЕГН ${principalEgn}, в качеството му на представляващ самостоятелно ${committee}${grantorAuthorisationClause(grantor)}`
}

export function displayedNumber(input: DesignationRenderInput, config: DesignationConfig) {
  if (typeof input.number === 'number' && Number.isFinite(input.number) && input.number > 0) {
    return formatDesignationNumber(input.number, config.numberPrefix)
  }
  const raw = String(input.number ?? '').trim()
  return raw || TODO_NUMBER
}

/** „№   <<Номер с дата>>“ → „№   501/19.10.2026“ (the three spaces are the template's). */
export function numberLine(input: DesignationRenderInput, config: DesignationConfig) {
  return `№   ${formatNumberWithDate(displayedNumber(input, config), formatBgDate(input.issuedOn))}`
}

/**
 * List items as in the template: items 1–3 have the marker at the body indent and a
 * tab 36 pt further (where the reference PDF puts the text); item 4 („-“) and item 5 („–“)
 * carry their own hanging indents (w:left 162 and 203 twips).
 */
export const RIGHTS_LAYOUT = [
  { marker: '–', textAt: BODY_INDENT + 36, wrapAt: BODY_INDENT, indentRight: 1.8 },
  { marker: '-', textAt: BODY_INDENT + 36, wrapAt: BODY_INDENT, indentRight: 1.8 },
  { marker: '–', textAt: BODY_INDENT + 36, wrapAt: BODY_INDENT, indentRight: 1.75 },
  // w:left 162 / 203 twips, at whole pixels as in the reference PDF (11 px, 14 px).
  { marker: '-', textAt: 8.25, wrapAt: 8.25, indentRight: 0 },
  { marker: '–', textAt: 10.5, wrapAt: 10.5, indentRight: 0 },
] as const

export function buildDesignationBlocks(input: DesignationRenderInput, config: DesignationConfig): DesignationBlock[] {
  const verb = verbForCapacity(input.grantor.capacity)
  const fullName = personFullName(input.person)
  const egn = visibleOrTodo(input.person.egn, TODO_PERSON_EGN)
  const blocks: DesignationBlock[] = [
    { type: 'title', text: 'П Ъ Л Н О М О Щ Н О', numberLine: numberLine(input, config), spaceBefore: 3.8 },
    {
      type: 'paragraph',
      runs: [{ text: grantorOpening(input.grantor, config) }],
      align: 'justify',
      spaceBefore: SPACE_BEFORE,
      indentLeft: BODY_INDENT,
      indentRight: 2.15,
    },
    { type: 'paragraph', runs: [{ text: `${verb}:` }], align: 'center', spaceBefore: SPACE_BEFORE, ...CENTER_INDENT },
    {
      type: 'paragraph',
      runs: [{ text: fullName, sans: true }, { text: ', ЕГН  ' }, { text: egn, sans: true }],
      align: 'justify',
      spaceBefore: 0,
    },
    { type: 'blank', spaceBefore: 13.75 },
    { type: 'paragraph', runs: [{ text: 'СЪС СЛЕДНИТЕ ПРАВА:' }], align: 'center', spaceBefore: 0.05, ...CENTER_INDENT },
    {
      type: 'paragraph',
      runs: [{ text: rightsMandateParagraph(input.person, config) }],
      align: 'justify',
      spaceBefore: SPACE_BEFORE,
      indentLeft: BODY_INDENT,
      indentRight: 2,
      firstLineIndent: MANDATE_FIRST_LINE,
    },
    { type: 'paragraph', runs: [{ text: 'Представителят има право:' }], align: 'justify', spaceBefore: SPACE_BEFORE, indentLeft: BODY_INDENT },
    ...REPRESENTATIVE_RIGHTS.map((text, index): DesignationBlock => {
      const layout = RIGHTS_LAYOUT[index] ?? RIGHTS_LAYOUT[0]
      return { type: 'bullet', text, markerAt: BODY_INDENT, ...layout }
    }),
    { type: 'paragraph', runs: [{ text: territoryParagraph(config) }], align: 'justify', spaceBefore: SPACE_BEFORE, indentLeft: BODY_INDENT, indentRight: 1.9 },
    { type: 'paragraph', runs: [{ text: termParagraph(config) }], align: 'justify', spaceBefore: SPACE_BEFORE, indentLeft: BODY_INDENT, indentRight: 2.35 },
    { type: 'paragraph', runs: [{ text: config.sealLine }], align: 'justify', spaceBefore: 13.75, indentLeft: BODY_INDENT },
    // The template's closing block: an empty line, then „УПЪЛНОМОЩИТЕЛ:“ centred, and nothing after it
    // (the document is signed electronically, so there is no line or name for a handwritten signature).
    { type: 'blank', spaceBefore: 0 },
    { type: 'paragraph', runs: [{ text: 'УПЪЛНОМОЩИТЕЛ:' }], align: 'center', spaceBefore: 0, ...CENTER_INDENT },
  ]
  return blocks
}

/** One line per template paragraph; list items as „<marker> <text>“. */
export function designationPlainText(blocks: DesignationBlock[]) {
  const lines: string[] = []
  for (const block of blocks) {
    if (block.type === 'title') lines.push(`${block.text} ${block.numberLine}`)
    else if (block.type === 'paragraph') lines.push(block.runs.map((run) => run.text).join(''))
    else if (block.type === 'bullet') lines.push(`${block.marker} ${block.text}`)
    else lines.push('')
  }
  return lines.join('\n')
}
