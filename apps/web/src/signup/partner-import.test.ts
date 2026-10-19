import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  IAZ_PARTNER,
  inlineSql,
  mapPartnerRow,
  mapPlace,
  normalizeEgn,
  normalizePhone,
  parsePartnerCsv,
  parseSubmitted,
  partnerBadge,
  partnerImportStatements,
  planPartnerImport,
  splitFullName,
  type PartnerRawRow,
} from './partner-import'
import { rosterWhere } from './admin-csv'
import { validEgn } from './rules'

/** A fake ЕГН with a correct check digit. */
function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

const HEADER = 'Име;Имейл;ЕГН;Телефон;Област;Общини;IP;Подадено'
const A = egn(85, 3, 14, 123)
const B = egn(5, 47, 2, 456) // born 2005: month + 40, leading zero
const C = egn(90, 12, 1, 77)

function csv(...lines: string[]) {
  return `\uFEFF${[HEADER, ...lines].join('\r\n')}\r\n`
}

function raw(patch: Partial<PartnerRawRow>): PartnerRawRow {
  return { line: 2, name: 'Иван Петров Иванов', email: 'harry+iaz1@hkdobrev.com', egn: A, phone: '888123456', oblast: 'Варна', municipalities: 'Варна', submitted: '19 окт 2026 · 7:21', ...patch }
}

describe('partner CSV', () => {
  it('reads the semicolon file with a BOM, quotes and the IP column', () => {
    const parsed = parsePartnerCsv(csv(`Иван Петров Иванов;Harry+IAZ1@hkdobrev.com ;${A};888123456;Бургас;"Бургас, Созопол";203.0.113.5;19 окт 2026 · 7:21`, ';;;;;;;'))
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]).toMatchObject({ line: 2, email: 'Harry+IAZ1@hkdobrev.com', municipalities: 'Бургас, Созопол', submitted: '19 окт 2026 · 7:21' })
    expect(Object.keys(parsed.rows[0]!)).not.toContain('ip')
  })

  it('rejects a file without the partner header', () => {
    expect(parsePartnerCsv('email,first_name\na@b.bg,Ива\n').errors[0]).toMatch(/Име;Имейл;ЕГН/)
  })
})

describe('field mapping', () => {
  it('splits the full name the way the signup form keeps it', () => {
    expect(splitFullName('  иван  ПЕТРОВ иванов ')).toEqual({ firstName: 'Иван', middleName: 'Петров', lastName: 'Иванов' })
    expect(splitFullName('Мария Иванова')).toEqual({ firstName: 'Мария', middleName: '', lastName: 'Иванова' })
    expect(splitFullName('Ана Мария Петрова Иванова')).toEqual({ firstName: 'Ана', middleName: 'Мария', lastName: 'Петрова Иванова' })
    expect(splitFullName('Мария-Магдалена Петрова-Иванова')).toEqual({ firstName: 'Мария-Магдалена', middleName: '', lastName: 'Петрова-Иванова' })
  })

  it('normalises phones to 08xxxxxxxx and rejects short ones', () => {
    expect(normalizePhone('888123456')).toEqual({ phone: '0888123456', problem: null })
    expect(normalizePhone('359888123456')).toEqual({ phone: '0888123456', problem: null })
    expect(normalizePhone('+359 88 812 3456')).toEqual({ phone: '0888123456', problem: null })
    expect(normalizePhone('0888 123 456')).toEqual({ phone: '0888123456', problem: null })
    expect(normalizePhone('6312345').problem).toBe('телефонът не е валиден')
    expect(normalizePhone('')).toEqual({ phone: '', problem: null })
  })

  it('restores the leading zeros a spreadsheet dropped, only for a real ЕГН', () => {
    expect(validEgn(B)).toBe(true)
    expect(B.startsWith('0')).toBe(true)
    expect(normalizeEgn(B.replace(/^0+/, ''))).toEqual({ egn: B, padded: true, problem: null })
    expect(normalizeEgn(A)).toEqual({ egn: A, padded: false, problem: null })
    const bad = `${A.slice(0, 9)}${(Number(A[9]) + 1) % 10}`
    expect(normalizeEgn(bad).problem).toMatch(/контролна цифра/)
    expect(normalizeEgn('').problem).toBe('липсва ЕГН')
  })

  it('reads „Подадено“ as Sofia time', () => {
    expect(parseSubmitted('19 окт 2026 · 7:21')).toBe('2026-10-19T04:21:00.000Z')
    expect(parseSubmitted('15 окт 2026 · 10:04')).toBe('2026-10-15T07:04:00.000Z')
    // After the switch to winter time Sofia is UTC+2.
    expect(parseSubmitted('2 ное 2026 · 9:00')).toBe('2026-11-02T07:00:00.000Z')
    expect(parseSubmitted('вчера')).toBeNull()
  })

  it('maps Област and Общини onto the signup place, travel stops and a team note', () => {
    const burgas = mapPlace('Бургас', 'Бургас, Созопол, Руен')
    expect(burgas.place).toMatchObject({ regionCode: '02', regionName: 'Бургас', municipalityName: 'Бургас' })
    expect(burgas.travel.map((stop) => stop.name)).toEqual(['Созопол', 'Руен'])
    expect(mapPlace('София град', 'Младост 3').place).toMatchObject({ regionCode: 'sofia-merged', municipalityName: 'Столична', cityRegionName: 'Младост' })
    expect(mapPlace('София град', 'Sofiya').place).toMatchObject({ regionCode: 'sofia-merged', municipalityName: 'Столична' })
    expect(mapPlace('Софийска', 'Божурище, Сливница, Костинброд').place).toMatchObject({ regionCode: '26', municipalityName: 'Божурище' })
    expect(mapPlace('Благоевград', 'BLAGOEVGRAD').place).toMatchObject({ regionCode: '01', municipalityName: 'Благоевград' })
    expect(mapPlace('Русе', 'Ruse').place).toMatchObject({ regionCode: '19', municipalityName: 'Русе' })
    expect(mapPlace('Пловдив', 'Пловдив').place?.regionCode).toBe('16')
    expect(mapPlace('Пловдив', 'Карлово, Сопот').place?.regionCode).toBe('17')
    const varna = mapPlace('Варна', 'Варна, Аксаково, Аспарухово')
    expect(varna.unmatched).toEqual(['Аспарухово'])
    const free = mapPlace('Варна', 'Без ограничения, Където има нужда')
    expect(free.place).toMatchObject({ regionCode: '03' })
    expect(free.place?.municipalityCode).toBeUndefined()
    expect(mapPlace('', '').place).toBeNull()
  })

  it('lists the reasons a row is invalid', () => {
    const result = mapPartnerRow(raw({ email: 'не-е-имейл', egn: '1234567890', phone: '12' }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reasons).toEqual(['имейлът не е валиден', 'ЕГН не е валидно (дата или контролна цифра)', 'телефонът не е валиден'])
  })

  it('imports a row without a phone, with a warning', () => {
    const result = mapPartnerRow(raw({ phone: '' }))
    expect(result.ok && result.person.warnings).toContain('няма телефон')
  })
})

describe('plan', () => {
  const rows: PartnerRawRow[] = [
    raw({ line: 2 }),
    raw({ line: 3, email: 'harry+iaz2@hkdobrev.com', egn: B.replace(/^0+/, ''), name: 'Мария Иванова' }),
    raw({ line: 4, submitted: '15 окт 2026 · 8:00' }),
    raw({ line: 5, email: 'harry+iaz3@hkdobrev.com', egn: C }),
    raw({ line: 6, email: 'shared@example.com', egn: egn(70, 1, 1, 1) }),
    raw({ line: 7, email: 'shared@example.com', egn: egn(72, 2, 2, 2) }),
    raw({ line: 8, email: 'harry+iaz4@hkdobrev.com', egn: '1234567890' }),
  ]

  it('sorts rows into new, existing, repeated in the file and invalid', () => {
    const plan = planPartnerImport(rows, [{ id: 'existing-c', email: 'someone@example.com', egn: C, partner: null }])
    expect(plan.counts).toEqual({ new: 2, tag: 1, already: 0, repeat: 1, invalid: 3 })
    expect(plan.rows.find((row) => row.line === 4)).toMatchObject({ kind: 'repeat' })
    expect(plan.rows.find((row) => row.line === 2)).toMatchObject({ kind: 'new' })
    expect(plan.rows.find((row) => row.line === 5)).toMatchObject({ kind: 'tag', existingId: 'existing-c' })
    expect(plan.rows.filter((row) => row.email === 'shared@example.com').every((row) => row.kind === 'invalid')).toBe(true)
  })

  it('never writes over an existing signup: only the empty partner tag', () => {
    const plan = planPartnerImport(rows, [{ id: 'existing-c', email: 'someone@example.com', egn: C, partner: null }])
    const statements = partnerImportStatements(plan, '2026-10-19T19:00:00.000Z', { id: () => 'id', token: () => 'token', referral: () => 'Ref123' })
    const tag = statements.find((statement) => statement.sql.startsWith('UPDATE'))!
    expect(tag.sql).toMatch(/SET partner = \?, partner_submitted_at = COALESCE/)
    expect(tag.sql).not.toMatch(/payload|email =|egn =|phone/)
    expect(tag.sql).toMatch(/COALESCE\(partner, ''\) = ''/)
    expect(tag.params).toEqual([IAZ_PARTNER, '2026-10-19T04:21:00.000Z', '2026-10-19T19:00:00.000Z', 'existing-c'])
  })

  it('stores a new person as imported, unconfirmed, without a letter and with the partner', () => {
    const plan = planPartnerImport(rows, [])
    const statements = partnerImportStatements(plan, '2026-10-19T19:00:00.000Z', { id: () => 'id', token: () => 'token', referral: () => 'Ref123' })
    const insert = statements.find((statement) => statement.params.includes('harry+iaz2@hkdobrev.com'))!
    expect(insert.sql).toMatch(/ON CONFLICT\(email\) DO NOTHING/)
    expect(insert.sql).toMatch(/0, 0, 0, 0, 1, 'skipped'/)
    expect(insert.sql).not.toMatch(/confirm_token/)
    expect(insert.params).toContain(B)
    const payload = JSON.parse(String(insert.params[17]))
    expect(payload).toMatchObject({ firstName: 'Мария', lastName: 'Иванова', phone: '0888123456', egn: '', source: IAZ_PARTNER, emailConfirmed: false })
    expect(insert.params[insert.params.length - 2]).toBe('2026-10-19T04:21:00.000Z')
  })

  it('is idempotent: the second run of the same file only finds people already tagged', () => {
    const first = planPartnerImport(rows, [])
    const imported = first.rows
      .filter((row) => row.kind === 'new')
      .map((row) => ({ id: `id-${row.line}`, email: row.email, egn: row.person!.egn, partner: IAZ_PARTNER }))
    const second = planPartnerImport(rows, imported)
    expect(second.counts.new).toBe(0)
    expect(second.counts.already).toBe(first.counts.new)
    expect(partnerImportStatements(second, '2026-10-19T19:00:00.000Z')).toEqual([])
  })

  it('skips an email that already belongs to another ЕГН', () => {
    const plan = planPartnerImport([raw({})], [{ id: 'x', email: 'harry+iaz1@hkdobrev.com', egn: C, partner: null }])
    expect(plan.rows[0]).toMatchObject({ kind: 'invalid', reasons: ['имейлът вече е записан с друго ЕГН'] })
  })

  it('inlines literals safely for the script', () => {
    expect(inlineSql({ sql: 'SELECT ?, ?, ?', params: ["O'Neil", null, 3] })).toBe("SELECT 'O''Neil', NULL, 3;")
  })
})

describe('the „И аз“ tag in Записани', () => {
  it('has a badge and a view', () => {
    expect(partnerBadge('iaz.bg')).toBe('И аз')
    expect(partnerBadge('IAZ.BG')).toBe('И аз')
    expect(partnerBadge('other.bg')).toBe('')
    const view = rosterWhere('iaz', '')
    expect('clause' in view && view.clause).toMatch(/partner/)
  })

  it('sends nothing: the import modules do not load mail or Brevo code', () => {
    for (const name of ['partner-import.ts', 'partner-import-admin.ts']) {
      const text = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
      expect(text).not.toMatch(/from '\.\/(mail|brevo[\w-]*|admin-brevo|confirm-mail)'/)
      expect(text).not.toMatch(/deliverMail|confirm_token = /)
    }
  })
})
