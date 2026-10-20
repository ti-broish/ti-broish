// „РИК NN Представители.xlsx“: the layout of the previous election's РИК tables, cell by cell.
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { RIK_STYLES_XML, RIK_THEME_XML } from './rik-table-assets'
import { RIK_HEADERS, buildRikTableXlsx, rikTableFilename, rikTableTitle } from './rik-table'

const COMMITTEE = 'Инициативен комитет за издигане на кандидатурата на Тест Тестов за президент'
// Fake ЕГН with a valid checksum, for tests only.
function fakeEgn(yy: number, mm: number, dd: number, serial: number) {
  const body = [yy, mm, dd].map((part) => String(part).padStart(2, '0')).join('') + String(serial).padStart(3, '0')
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}
const FAKE_A = fakeEgn(88, 1, 2, 101)
const FAKE_B = fakeEgn(5, 44, 4, 202)
const FAKE_C = fakeEgn(0, 41, 1, 3)

function open(bytes: Uint8Array) {
  const files = unzipSync(bytes)
  const text = (name: string) => strFromU8(files[name]!)
  const strings = [...text('xl/sharedStrings.xml').matchAll(/<si><t>([\s\S]*?)<\/t><\/si>/g)].map((match) => match[1]!)
  const sheet = text('xl/worksheets/sheet1.xml')
  const cell = (ref: string) => {
    const match = new RegExp(`<c r="${ref}" s="(\\d+)"(?: t="s")?(?:/>|><v>([^<]*)</v></c>)`).exec(sheet)
    if (!match) return null
    const shared = new RegExp(`<c r="${ref}" s="\\d+" t="s">`).test(sheet)
    return { style: Number(match[1]), value: match[2] == null ? null : shared ? strings[Number(match[2])] : match[2], shared }
  }
  return { files, text, sheet, cell, strings }
}

describe('РИК table (xlsx)', () => {
  const bytes = buildRikTableXlsx({
    title: rikTableTitle(COMMITTEE),
    rows: [
      { number: 612, name: 'Сия Петрова Пробова', egn: FAKE_B, numberWithDate: '612/19.10.2026' },
      { number: 605, name: 'Тодор Иванов Пробов', egn: FAKE_A, numberWithDate: '605/19.10.2026' },
      { number: 640, name: 'Трети Човек Тестов', egn: FAKE_C, numberWithDate: '640/20.10.2026' },
    ],
  })
  const book = open(bytes)

  it('is a one-sheet workbook „Sheet1“ with the example styles and theme verbatim', () => {
    expect(Object.keys(book.files).sort()).toEqual(
      [
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/_rels/workbook.xml.rels',
        'xl/sharedStrings.xml',
        'xl/styles.xml',
        'xl/theme/theme1.xml',
        'xl/workbook.xml',
        'xl/worksheets/sheet1.xml',
      ].sort(),
    )
    expect(book.text('xl/workbook.xml')).toContain('<sheet state="visible" name="Sheet1" sheetId="1" r:id="rId4"/>')
    expect(book.text('xl/styles.xml')).toBe(RIK_STYLES_XML)
    expect(book.text('xl/theme/theme1.xml')).toBe(RIK_THEME_XML)
    expect(RIK_STYLES_XML).toContain('<name val="Times New Roman"/>')
    expect(RIK_STYLES_XML).toContain('<cellXfs count="23">')
  })

  it('keeps the column widths, row heights and the merged B1:E1 title', () => {
    expect(book.sheet).toContain(
      '<cols><col customWidth="1" min="1" max="1" width="2.43"/><col customWidth="1" min="2" max="2" width="8.86"/><col customWidth="1" min="3" max="3" width="39.43"/><col customWidth="1" min="4" max="4" width="22.29"/><col customWidth="1" min="5" max="17" width="22.14"/></cols>',
    )
    expect(book.sheet).toContain('<row r="1" ht="63.75" customHeight="1">')
    expect(book.sheet).toContain('<row r="2" ht="14.25" customHeight="1">')
    expect(book.sheet).toContain('<mergeCells count="1"><mergeCell ref="B1:E1"/></mergeCells>')
    expect(book.cell('A1')).toEqual({ style: 1, value: null, shared: false })
    expect(book.cell('B1')).toMatchObject({ style: 2, value: `Списък на упълномощените представители на \n${COMMITTEE}` })
    expect([book.cell('C1')?.style, book.cell('D1')?.style, book.cell('E1')?.style]).toEqual([3, 3, 4])
    expect(book.cell('Q1')?.style).toBe(1)
    expect(book.cell('R1')).toBeNull()
  })

  it('has the four header cells with the example text and styles', () => {
    expect(['B2', 'C2', 'D2', 'E2'].map((ref) => book.cell(ref)?.value)).toEqual([...RIK_HEADERS])
    expect(RIK_HEADERS).toEqual(['№ по ред', 'собствено, бащино и фамилно име', 'ЕГН', '№ и дата на пълномощното'])
    expect(['A2', 'B2', 'C2', 'D2', 'E2', 'F2'].map((ref) => book.cell(ref)?.style)).toEqual([5, 6, 7, 8, 7, 9])
  })

  it('writes one row per пълномощно, sorted by number: B number, C names, D ЕГН as text, E number/date', () => {
    expect(book.cell('B3')).toEqual({ style: 11, value: '605', shared: false })
    expect(book.cell('C3')).toMatchObject({ style: 12, value: 'Тодор Иванов Пробов' })
    expect(book.cell('D3')).toMatchObject({ style: 13, value: FAKE_A, shared: true })
    expect(book.cell('E3')).toMatchObject({ style: 14, value: '605/19.10.2026', shared: true })
    expect(book.cell('A3')?.style).toBe(10)
    expect(book.cell('B4')).toEqual({ style: 11, value: '612', shared: false })
    expect(['C4', 'D4', 'E4'].map((ref) => book.cell(ref)?.style)).toEqual([15, 16, 14])
    expect(book.cell('D4')?.value).toBe(FAKE_B)
    expect(book.cell('B5')?.value).toBe('640')
    // A leading-zero ЕГН stays text.
    expect(book.cell('D5')).toMatchObject({ value: FAKE_C, shared: true })
  })

  it('keeps the empty bordered grid to row 39 and the 551 plain rows after it, like the example', () => {
    expect(['A6', 'B6', 'C6', 'D6', 'E6', 'F6'].map((ref) => book.cell(ref))).toEqual(
      [10, 17, 18, 19, 20, 10].map((style) => ({ style, value: null, shared: false })),
    )
    expect(book.cell('E39')?.style).toBe(20)
    expect(['A40', 'B40', 'C40', 'D40', 'E40'].map((ref) => book.cell(ref)?.style)).toEqual([10, 10, 21, 22, 10])
    expect(book.cell('D590')?.style).toBe(22)
    expect(book.cell('A591')).toBeNull()
    // More people than the grid: the grid grows, the plain rows follow.
    const many = open(
      buildRikTableXlsx({
        title: 'x',
        rows: Array.from({ length: 40 }, (_, index) => ({ number: index + 1, name: `Човек ${index + 1}`, egn: FAKE_A, numberWithDate: `${index + 1}/19.10.2026` })),
      }),
    )
    expect(many.cell('B42')).toMatchObject({ style: 11, value: '40' })
    expect(many.cell('C43')?.style).toBe(21)
    expect(many.cell('A593')?.style).toBe(10)
    expect(many.cell('A594')).toBeNull()
  })

  it('escapes XML and names files like the example', () => {
    const odd = open(buildRikTableXlsx({ title: rikTableTitle('A & <B>'), rows: [] }))
    expect(odd.text('xl/sharedStrings.xml')).toContain('A &amp; &lt;B&gt;')
    expect(odd.cell('B3')).toEqual({ style: 17, value: null, shared: false })
    expect(rikTableFilename('2')).toBe('РИК 02 Представители.xlsx')
    expect(rikTableFilename('32')).toBe('РИК 32 Представители.xlsx')
  })
})
