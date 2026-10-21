import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  IAZ_PARTNER,
  inlineSql,
  mapPartnerRow,
  mapPlace,
  mirsNamed,
  placeNote,
  normalizeEgn,
  normalizePhone,
  parsePartnerCsv,
  parseSubmitted,
  partnerBadge,
  partnerImportStatements,
  partnerMir,
  planPartnerImport,
  planSummary,
  previewRows,
  splitFullName,
  type PartnerRawRow,
} from './partner-import'
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

  it('needs only a name and a valid ЕГН; a bad email or phone is a warning and is not kept', () => {
    const bad = mapPartnerRow(raw({ name: '', egn: '1234567890' }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reasons).toEqual(['липсва име', 'ЕГН не е валидно (дата или контролна цифра)'])
    const loose = mapPartnerRow(raw({ email: 'не-е-имейл', phone: '12' }))
    expect(loose.ok).toBe(true)
    if (loose.ok) {
      expect(loose.person).toMatchObject({ email: '', phone: '' })
      expect(loose.person.warnings).toEqual(expect.arrayContaining(['имейлът не е валиден (не се пази)', 'телефонът не е валиден (не се пази)']))
    }
  })

  it('skips an „И аз“ row whose ЕГН is under 18 on election day', () => {
    const young = egn(8, 50, 26, 321) // born 26.10.2008: 18 the day after the election
    const row = mapPartnerRow(raw({ egn: young }))
    expect(row.ok).toBe(false)
    if (!row.ok) expect(row.reasons).toEqual(['не навършва 18 години до деня на изборите (25.10.2026 г.)'])
    expect(mapPartnerRow(raw({ egn: egn(8, 50, 25, 321) })).ok).toBe(true)
  })

  it('imports a row without a phone, with a warning', () => {
    const result = mapPartnerRow(raw({ phone: '' }))
    expect(result.ok && result.person.warnings).toContain('няма телефон')
  })

  it('finds the МИР of the пълномощно; София needs a district', () => {
    expect(mapPartnerRow(raw({})).ok && (mapPartnerRow(raw({})) as { person: { mir: string } }).person.mir).toBe('03')
    const mladost = mapPartnerRow(raw({ oblast: 'София град', municipalities: 'Младост 3' }))
    expect(mladost.ok && mladost.person.mir).toBe('23')
    const sofia = mapPartnerRow(raw({ oblast: 'София град', municipalities: 'София' }))
    expect(sofia.ok && sofia.person.mir).toBe('')
    expect(sofia.ok && sofia.person.warnings).toContain('няма МИР: София без район (23/24/25)')
    const karlovo = mapPartnerRow(raw({ oblast: 'Пловдив', municipalities: 'Карлово' }))
    expect(karlovo.ok && karlovo.person.mir).toBe('17')
    expect(partnerMir(null)).toBe('')
  })
})

describe('plan', () => {
  const D = egn(70, 1, 1, 1)
  const E = egn(72, 2, 2, 2)
  const rows: PartnerRawRow[] = [
    raw({ line: 2 }),
    raw({ line: 3, email: 'harry+iaz2@hkdobrev.com', egn: B.replace(/^0+/, ''), name: 'Мария Иванова' }),
    raw({ line: 4, submitted: '15 окт 2026 · 8:00' }),
    raw({ line: 5, email: 'harry+iaz3@hkdobrev.com', egn: C }),
    raw({ line: 6, email: 'shared@example.com', egn: D }),
    raw({ line: 7, email: 'shared@example.com', egn: E }),
    raw({ line: 8, email: 'harry+iaz4@hkdobrev.com', egn: '1234567890' }),
  ]

  it('sorts rows into new, already imported, repeated in the file and invalid; one ЕГН is one person', () => {
    const plan = planPartnerImport(rows, [C], [])
    expect(plan.counts).toEqual({ new: 4, already: 1, repeat: 1, invalid: 1, alsoSignup: 0, noMir: 0, covered: 0 })
    expect(plan.rows.find((row) => row.line === 4)).toMatchObject({ kind: 'repeat' })
    expect(plan.rows.find((row) => row.line === 2)).toMatchObject({ kind: 'new' })
    expect(plan.rows.find((row) => row.line === 5)).toMatchObject({ kind: 'already' })
    // Two people on one email are two people: both get a пълномощно.
    const shared = plan.rows.filter((row) => row.email === 'shared@example.com')
    expect(shared.map((row) => row.kind)).toEqual(['new', 'new'])
    expect(shared[0]!.person!.warnings).toContain('имейлът е общ за 2 души във файла')
  })

  it('reports people who are also signups, without merging or touching them', () => {
    const plan = planPartnerImport(rows, [], [
      { email: 'someone@example.com', egn: C },
      { email: 'harry+iaz2@hkdobrev.com', egn: '' },
    ])
    expect(plan.counts.alsoSignup).toBe(2)
    expect(plan.rows.find((row) => row.line === 5)).toMatchObject({ kind: 'new', signup: 'egn' })
    expect(plan.rows.find((row) => row.line === 3)).toMatchObject({ kind: 'new', signup: 'email' })
    const statements = partnerImportStatements(plan, '2026-10-19T19:00:00.000Z', () => 'pp-id')
    expect(statements.every((statement) => statement.sql.startsWith('INSERT INTO partner_people'))).toBe(true)
    expect(statements.map((statement) => statement.sql).join('\n')).not.toMatch(/signups/)
  })

  it('stores a new person only in partner_people, with the МИР for the пълномощно', () => {
    const plan = planPartnerImport(rows, [], [])
    const statements = partnerImportStatements(plan, '2026-10-19T19:00:00.000Z', () => 'pp-id')
    const insert = statements.find((statement) => statement.params.includes('harry+iaz2@hkdobrev.com'))!
    expect(insert.sql).toMatch(/^INSERT INTO partner_people/)
    expect(insert.sql).toMatch(/ON CONFLICT\(partner, egn\) DO NOTHING/)
    expect(insert.params).toEqual([
      'pp-id', IAZ_PARTNER, B, 'harry+iaz2@hkdobrev.com', '0888123456', 'Мария', '', 'Иванова',
      '03', expect.any(String), 'Варна', '', '03', '2026-10-19T04:21:00.000Z', '2026-10-19T19:00:00.000Z', '2026-10-19T19:00:00.000Z', null,
    ])
  })

  it('imports a person whose ЕГН is on an active volunteer, marked „покрит от доброволец“ (never numbered)', () => {
    const plan = planPartnerImport(rows, [], [
      { id: 'sig-active', withdrawn: 0, email: 'other@example.com', egn: C },
      { id: 'sig-gone', withdrawn: 1, email: 'gone@example.com', egn: B },
    ])
    expect(plan.counts.covered).toBe(1)
    const covered = plan.rows.find((row) => row.line === 5)!
    expect(covered).toMatchObject({ kind: 'new', signup: 'egn', coveredBy: 'sig-active' })
    expect(covered.reasons.join(' ')).toContain('покрит от доброволец')
    // A withdrawn volunteer covers nobody.
    expect(plan.rows.find((row) => row.line === 3)!.coveredBy).toBeUndefined()
    const statements = partnerImportStatements(plan, '2026-10-19T19:00:00.000Z', () => 'pp-id')
    const insert = statements.find((statement) => statement.params.includes(C))!
    expect(insert.sql).toMatch(/covered_by_signup_id/)
    expect(insert.params.at(-1)).toBe('sig-active')
    expect(statements.find((statement) => statement.params.includes(B))!.params.at(-1)).toBeNull()
    const preview = previewRows(plan)
    expect(preview.find((row) => row.line === 5)!.covered).toBe(true)
    expect(planSummary(plan)).toContain('Покрити от доброволец (внасят се, но без номер')
  })

  it('is idempotent: the second run of the same file finds everyone already imported', () => {
    const first = planPartnerImport(rows, [], [])
    const imported = first.rows.filter((row) => row.kind === 'new').map((row) => row.person!.egn)
    const second = planPartnerImport(rows, imported, [])
    expect(second.counts.new).toBe(0)
    expect(second.counts.already).toBe(first.counts.new)
    expect(partnerImportStatements(second, '2026-10-19T19:00:00.000Z')).toEqual([])
  })

  it('masks ЕГН and email in the preview', () => {
    const preview = previewRows(planPartnerImport(rows, [], []))
    const row = preview.find((item) => item.line === 2)!
    expect(row.egn).toBe(`******${A.slice(-4)}`)
    expect(row.email).toBe('h***@hkdobrev.com')
    expect(JSON.stringify(preview)).not.toContain(A)
  })

  it('inlines literals safely for the script', () => {
    expect(inlineSql({ sql: 'SELECT ?, ?, ?', params: ["O'Neil", null, 3] })).toBe("SELECT 'O''Neil', NULL, 3;")
  })
})

describe('the „И аз“ import', () => {
  it('has a badge', () => {
    expect(partnerBadge('iaz.bg')).toBe('И аз')
    expect(partnerBadge('IAZ.BG')).toBe('И аз')
    expect(partnerBadge('other.bg')).toBe('')
  })

  it('sends nothing and never writes signups: the import modules load no mail or Brevo code', () => {
    for (const name of ['partner-import.ts', 'partner-import-admin.ts']) {
      const text = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
      expect(text).not.toMatch(/from '\.\/(mail|brevo[\w-]*|admin-brevo|confirm-mail|designation-brevo|designation-bulk\.server)'/)
      expect(text).not.toMatch(/deliverMail|confirm_token = /)
      expect(text).not.toMatch(/(INSERT INTO|UPDATE) signups/)
    }
  })
})

describe('comment column and named МИРs', () => {
  it('keeps the Коментар column in the place note', () => {
    const text = `Име,Имейл,ЕГН,Телефон,Област,Общини,Коментар,Секция\nИван Петров Иванов,a@example.com,${A},888123456,Софийска,"Перник, Кюстендил",Само събота,\n`
    const parsed = parsePartnerCsv(text)
    expect(parsed.rows[0]?.comment).toBe('Само събота')
    const mapped = mapPartnerRow(parsed.rows[0]!)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(placeNote(mapped.person)).toBe('неразпознати: Перник, Кюстендил; коментар: Само събота')
  })

  it('reads МИРs from oblast, municipality, district and free text', () => {
    expect(mirsNamed('София-област')).toEqual(['26'])
    expect(mirsNamed('Кюстендил')).toEqual(['10'])
    expect(mirsNamed('Карлово')).toEqual(['17'])
    expect(mirsNamed('Бих могла близко до София или Плевен')).toEqual(['15', '23', '24', '25'])
  })
})

