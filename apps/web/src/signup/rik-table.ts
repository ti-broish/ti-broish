import { strToU8, zipSync } from 'fflate'
import { RIK_STYLES_XML, RIK_THEME_XML } from './rik-table-assets'

/**
 * „РИК NN Представители.xlsx“ — the list of authorised representatives handed to each РИК,
 * reproduced from the previous election's tables (Google Sheets, 17.04.2026): one sheet
 * „Sheet1“, an empty spacer column A, a merged B1:E1 title, a four-column header and one
 * row per пълномощно (B number, C three names, D ЕГН as text, E „number/date“), sorted by number.
 * Only the coalition line of the title changes: it names this election's committee.
 */
export interface RikTableRow {
  number: number
  name: string
  egn: string
  numberWithDate: string
}

export const RIK_TITLE_PREFIX = 'Списък на упълномощените представители на \n'
export const RIK_HEADERS = ['№ по ред', 'собствено, бащино и фамилно име', 'ЕГН', '№ и дата на пълномощното'] as const

export function rikTableFilename(mir: string) {
  return `РИК ${mir.padStart(2, '0')} Представители.xlsx`
}

export function rikTableTitle(committeeFullName: string) {
  return `${RIK_TITLE_PREFIX}${committeeFullName.trim()}`
}

// Cell style indexes in RIK_STYLES_XML, as the example uses them.
const STYLE = {
  titleSpacer: 1, // A1 and F1:Q1 — TNR 13 bold, centred
  title: 2, // B1 — TNR 13 bold, centred, wrapped, medium border left/top/bottom
  titleMiddle: 3, // C1:D1 — medium top/bottom
  titleEnd: 4, // E1 — medium right/top/bottom
  headerSpacer: 5, // A2
  headerFirst: 6, // B2 — medium box
  header: 7, // C2, E2
  headerText: 8, // D2 — '@'
  headerTail: 9, // F2:Q2
  rowSpacer: 10, // A and F:Q of every row below the header
  number: 11, // B of a filled row
  firstName: 12, // C, D of the first filled row (medium top too)
  firstEgn: 13,
  numberWithDate: 14, // E of a filled row
  name: 15, // C, D of the next filled rows
  egn: 16,
  blankNumber: 17, // the empty bordered grid below the people
  blankName: 18,
  blankEgn: 19,
  blankNumberWithDate: 20,
  plainName: 21, // unbordered rows after the grid
  plainEgn: 22,
} as const

/** The example's bordered grid runs from row 3 to row 39 (37 rows), filled from the top. */
export const RIK_GRID_LAST_ROW = 39
/** …followed by 551 unbordered, pre-formatted rows (to row 590). */
export const RIK_PLAIN_ROWS = 551

const TAIL_COLUMNS = ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q']

const NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mx="http://schemas.microsoft.com/office/mac/excel/2008/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:mv="urn:schemas-microsoft-com:mac:vml" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"'
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Rows sorted like the example: by пълномощно number. */
export function sortRikRows(rows: RikTableRow[]) {
  return [...rows].sort((a, b) => a.number - b.number || a.name.localeCompare(b.name, 'bg'))
}

export function buildRikTableXlsx(input: { title: string; rows: RikTableRow[] }): Uint8Array {
  const strings: string[] = []
  const index = new Map<string, number>()
  let stringRefs = 0
  const shared = (value: string) => {
    stringRefs += 1
    const known = index.get(value)
    if (known != null) return known
    index.set(value, strings.length)
    strings.push(value)
    return strings.length - 1
  }
  const empty = (ref: string, style: number) => `<c r="${ref}" s="${style}"/>`
  const text = (ref: string, style: number, value: string) => `<c r="${ref}" s="${style}" t="s"><v>${shared(value)}</v></c>`
  const tail = (row: number, style: number) => TAIL_COLUMNS.map((column) => empty(`${column}${row}`, style)).join('')

  const rows: string[] = []
  rows.push(
    `<row r="1" ht="63.75" customHeight="1">${empty('A1', STYLE.titleSpacer)}${text('B1', STYLE.title, input.title)}${empty('C1', STYLE.titleMiddle)}${empty('D1', STYLE.titleMiddle)}${empty('E1', STYLE.titleEnd)}${tail(1, STYLE.titleSpacer)}</row>`,
  )
  rows.push(
    `<row r="2" ht="14.25" customHeight="1">${empty('A2', STYLE.headerSpacer)}${text('B2', STYLE.headerFirst, RIK_HEADERS[0])}${text('C2', STYLE.header, RIK_HEADERS[1])}${text('D2', STYLE.headerText, RIK_HEADERS[2])}${text('E2', STYLE.header, RIK_HEADERS[3])}${tail(2, STYLE.headerTail)}</row>`,
  )
  const people = sortRikRows(input.rows)
  people.forEach((person, offset) => {
    const r = offset + 3
    const first = offset === 0
    rows.push(
      `<row r="${r}" ht="14.25" customHeight="1">${empty(`A${r}`, STYLE.rowSpacer)}` +
        `<c r="B${r}" s="${STYLE.number}"><v>${Math.trunc(person.number)}</v></c>` +
        text(`C${r}`, first ? STYLE.firstName : STYLE.name, person.name) +
        text(`D${r}`, first ? STYLE.firstEgn : STYLE.egn, person.egn) +
        text(`E${r}`, STYLE.numberWithDate, person.numberWithDate) +
        `${tail(r, STYLE.rowSpacer)}</row>`,
    )
  })
  const lastFilled = people.length + 2
  const gridEnd = Math.max(RIK_GRID_LAST_ROW, lastFilled)
  for (let r = lastFilled + 1; r <= gridEnd; r += 1) {
    rows.push(
      `<row r="${r}" ht="14.25" customHeight="1">${empty(`A${r}`, STYLE.rowSpacer)}${empty(`B${r}`, STYLE.blankNumber)}${empty(`C${r}`, STYLE.blankName)}` +
        `${empty(`D${r}`, STYLE.blankEgn)}${empty(`E${r}`, STYLE.blankNumberWithDate)}${tail(r, STYLE.rowSpacer)}</row>`,
    )
  }
  for (let r = gridEnd + 1; r <= gridEnd + RIK_PLAIN_ROWS; r += 1) {
    rows.push(
      `<row r="${r}" ht="14.25" customHeight="1">${empty(`A${r}`, STYLE.rowSpacer)}${empty(`B${r}`, STYLE.rowSpacer)}${empty(`C${r}`, STYLE.plainName)}` +
        `${empty(`D${r}`, STYLE.plainEgn)}${empty(`E${r}`, STYLE.rowSpacer)}${tail(r, STYLE.rowSpacer)}</row>`,
    )
  }

  const sheet =
    `${XML_HEAD}<worksheet ${NS}><sheetPr><pageSetUpPr/></sheetPr><sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    '<sheetFormatPr customHeight="1" defaultColWidth="14.43" defaultRowHeight="15.0"/>' +
    '<cols><col customWidth="1" min="1" max="1" width="2.43"/><col customWidth="1" min="2" max="2" width="8.86"/><col customWidth="1" min="3" max="3" width="39.43"/><col customWidth="1" min="4" max="4" width="22.29"/><col customWidth="1" min="5" max="17" width="22.14"/></cols>' +
    `<sheetData>${rows.join('')}</sheetData>` +
    '<mergeCells count="1"><mergeCell ref="B1:E1"/></mergeCells><printOptions/>' +
    '<pageMargins bottom="0.75" footer="0.0" header="0.0" left="0.7" right="0.7" top="0.75"/><pageSetup orientation="portrait"/></worksheet>'
  const sst =
    `${XML_HEAD}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${stringRefs}" uniqueCount="${strings.length}">` +
    strings.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join('') +
    '</sst>'
  const workbook = `${XML_HEAD}<workbook ${NS}><workbookPr/><sheets><sheet state="visible" name="Sheet1" sheetId="1" r:id="rId4"/></sheets><definedNames/><calcPr/></workbook>`
  const rel = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`
  const workbookRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rel('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', 'theme/theme1.xml') +
    rel('rId2', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles', 'styles.xml') +
    rel('rId3', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings', 'sharedStrings.xml') +
    rel('rId4', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet', 'worksheets/sheet1.xml') +
    '</Relationships>'
  const rootRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rel('rId1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', 'xl/workbook.xml') +
    '</Relationships>'
  const override = (part: string, type: string) => `<Override ContentType="${type}" PartName="${part}"/>`
  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default ContentType="application/xml" Extension="xml"/><Default ContentType="application/vnd.openxmlformats-package.relationships+xml" Extension="rels"/>' +
    override('/xl/worksheets/sheet1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml') +
    override('/xl/sharedStrings.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml') +
    override('/xl/styles.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml') +
    override('/xl/theme/theme1.xml', 'application/vnd.openxmlformats-officedocument.theme+xml') +
    override('/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml') +
    '</Types>'

  const mtime = new Date('2026-01-01T00:00:00Z')
  return zipSync(
    {
      '[Content_Types].xml': strToU8(contentTypes),
      '_rels/.rels': strToU8(rootRels),
      'xl/workbook.xml': strToU8(workbook),
      'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
      'xl/styles.xml': strToU8(RIK_STYLES_XML),
      'xl/theme/theme1.xml': strToU8(RIK_THEME_XML),
      'xl/sharedStrings.xml': strToU8(sst),
      'xl/worksheets/sheet1.xml': strToU8(sheet),
    },
    { level: 6, mtime },
  )
}
