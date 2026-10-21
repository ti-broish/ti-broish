import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isOurCommittee } from './config'
import { isAnnulledName, parseNumberWithDate } from './normalize'
import { decodeCfEmail, electionBaseOf, parseContacts, parseRegisterBatch, parseRegisterList, parseRikIndex } from './parse'

// Real pages from the CIK platform (ns202604, pvrns2021, pvr2026), names replaced with made-up ones.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('register list pages', () => {
  it('РИК 01, one growing batch per party', () => {
    const page = parseRegisterList(fixture('rik01-ns202604-list.html'), 'https://rik01.cik.bg/ns202604/registers/register_p')
    expect(page.empty).toBe(false)
    expect(page.unrecognised).toBe(false)
    expect(page.batches).toHaveLength(10)
    expect(page.batches[1]).toMatchObject({ listNo: '2/15.04.2026', url: 'https://rik01.cik.bg/ns202604/registers/register_p?id=7134' })
    expect(page.batches[1]!.party).toContain('ДЕМОКРАТИЧНА БЪЛГАРИЯ')
    expect(page.pages).toEqual([])
  })
  it('РИК 02, a batch per decision for the same party', () => {
    const page = parseRegisterList(fixture('rik02-ns202604-list-batches.html'), 'https://rik02.cik.bg/ns202604/registers/register_p')
    const ours = page.batches.filter((batch) => /ДЕМОКРАТИЧНА БЪЛГАРИЯ/.test(batch.party))
    expect(ours.length).toBe(7)
    expect(new Set(ours.map((batch) => batch.url)).size).toBe(7)
  })
  it('pvr2026 before anything is published', () => {
    const page = parseRegisterList(fixture('rik01-pvr2026-list-empty.html'), 'https://rik01.cik.bg/pvr2026/registers/register_p')
    expect(page).toMatchObject({ empty: true, batches: [], unrecognised: false })
  })
  it('CIK abroad list with <time> dates and path ids', () => {
    const page = parseRegisterList(fixture('cik-ns202604-abroad-list.html'), 'https://www.cik.bg/bg/ns19.04.2026/registers/register_p')
    expect(page.batches[0]).toMatchObject({ listNo: '1/15.04.2026', url: 'https://www.cik.bg/bg/ns19.04.2026/registers/register_p/7166' })
  })
  it('advocates list with decision links, and an empty one', () => {
    const page = parseRegisterList(fixture('rik23-ns202604-advocates-list.html'), 'https://rik23.cik.bg/ns202604/registers/advocates')
    expect(page.batches[0]).toMatchObject({ url: 'https://rik23.cik.bg/ns202604/registers/advocates/8422', decisions: ['Решение № 125-НС/16.04.2026'] })
    const empty = parseRegisterList(fixture('rik01-pvr2026-advocates-empty.html'), 'https://rik01.cik.bg/pvr2026/registers/advocates')
    expect(empty).toMatchObject({ empty: true, batches: [] })
  })
  it('follows paging links inside the content, not the calendar', () => {
    const html = `<div class="col-md-8"><ul class="breadcrumb"></ul><table class="table table-striped"><tr><td>1/01.10.2026</td><td><a href="/pvr2026/registers/register_p?id=1">ИК Гюров</a></td></tr></table>
      <ul class="pagination"><li><a href="/pvr2026/registers/register_p?page=2">2</a></li></ul></div><div class="calendar-col"><a href="/pvr2026/calendar/2026-10-06?page=3">6</a></div>`
    const page = parseRegisterList(html, 'https://rik05.cik.bg/pvr2026/registers/register_p')
    expect(page.pages).toEqual(['https://rik05.cik.bg/pvr2026/registers/register_p?page=2'])
    expect(page.batches[0]!.url).toBe('https://rik05.cik.bg/pvr2026/registers/register_p?id=1')
  })
  it('flags a page that is not a register', () => {
    expect(parseRegisterList('<html><body>Поддръжка</body></html>', 'https://rik05.cik.bg/pvr2026/registers/register_p').unrecognised).toBe(true)
  })
})

describe('register batch pages: one fixture per format', () => {
  const read = (file: string, url = 'https://rik.example/registers/register_p?id=1') => parseRegisterBatch(fixture(file), url)
  const shapes = (rows: { number: string }[]) => rows.map((row) => parseNumberWithDate(row.number))

  it('РИК 01: „501/…“, „001/… г.“, „№1001/…г.“ mixed, calendar table ignored', () => {
    const page = read('rik01-ns202604-detail-mixed-numbers.html')
    expect(page.party).toContain('ДЕМОКРАТИЧНА БЪЛГАРИЯ')
    expect(page.headers).toEqual(['Упълномощени представители на партия, коалиция или инициативен комитет', '№ и дата на пълномощното'])
    expect(page.rows).toHaveLength(180)
    const parsed = shapes(page.rows)
    expect(parsed.every((p) => p.number != null && p.date != null)).toBe(true)
    expect(parsed.some((p) => p.raw.startsWith('№'))).toBe(true)
  })
  it('РИК 02: bare numbers without a date', () => {
    const page = read('rik02-ns202604-detail-bare-numbers.html')
    expect(page.rows.length).toBe(90)
    const parsed = shapes(page.rows)
    expect(parsed.filter((p) => p.date == null && p.number != null).length).toBe(90)
    expect(page.rows.filter((row) => isAnnulledName(row.name)).length).toBeGreaterThan(0)
  })
  it('РИК 05: „№ 12 / 07.04.2026“', () => {
    const parsed = shapes(read('rik05-ns202604-detail-no-prefix.html').rows)
    expect(parsed).toHaveLength(255)
    expect(parsed.every((p) => p.number != null && p.date != null)).toBe(true)
  })
  it('РИК 17: capitals and „501 / …“', () => {
    const page = read('rik17-ns202604-detail-caps-spaced.html')
    expect(page.rows.some((row) => row.name === row.name.toUpperCase())).toBe(true)
    expect(shapes(page.rows).every((p) => p.number != null && p.date != null)).toBe(true)
  })
  it('РИК 18: other organisations’ series („Рз-12/… год.“)', () => {
    const parsed = shapes(read('rik18-ns202604-detail-org-prefix.html').rows)
    expect(parsed.filter((p) => p.prefix).length).toBeGreaterThan(10)
  })
  it('РИК 23: one growing table of 548 rows with „Анулиран“ rows and 4-digit numbers', () => {
    const page = read('rik23-ns202604-detail-annulled.html')
    expect(page.rows).toHaveLength(548)
    expect(page.rows.filter((row) => isAnnulledName(row.name)).length).toBeGreaterThan(50)
    expect(shapes(page.rows).some((p) => (p.number ?? 0) >= 1000)).toBe(true)
  })
  it('РИК 23 (2021): „1234 от 06.11.2021 г.“', () => {
    const parsed = shapes(read('rik23-pvrns2021-detail-ot-format.html').rows)
    expect(parsed.filter((p) => p.raw.includes(' от ')).every((p) => p.number != null && p.date != null)).toBe(true)
  })
  it('РИК 01 (2021): two-digit years', () => {
    const parsed = shapes(read('rik01-pvrns2021-detail-short-year.html').rows)
    expect(parsed.filter((p) => /\.\d{2}$/.test(p.raw)).every((p) => p.date?.endsWith('.2021'))).toBe(true)
  })
  it('РИК 25: a batch emptied after a merge', () => {
    const page = read('rik25-ns202604-detail-emptied-batch.html')
    expect(page).toMatchObject({ rows: [], empty: true, unrecognised: false })
  })
  it('CIK abroad batch', () => {
    const page = read('cik-ns202604-abroad-detail.html', 'https://www.cik.bg/bg/ns19.04.2026/registers/register_p/7166')
    expect(page.headers[0]).toBe('Упълномощени представители на партия или коалиция')
    expect(page.rows).toHaveLength(102)
  })
  it('advocates batch: name and certificate number', () => {
    const page = read('rik23-ns202604-advocates-detail.html')
    expect(page.headers).toEqual(['Собствено, бащино и фамилно име на регистрирани застъпници', '№ на удостоверение'])
    expect(page.rows.map((row) => row.number)).toEqual(['1-1/16.04.2026', '1-2/16.04.2026'])
  })
})

describe('CIK index of РИК sites and contacts', () => {
  it('lists 31 РИК with their election base', () => {
    const entries = parseRikIndex(fixture('cik-pvr2026-rik-index.html'), 'https://www.cik.bg/bg/pvr2026/rik')
    expect(entries).toHaveLength(31)
    expect(entries[0]).toMatchObject({ mir: '01', name: 'Благоевград', homeUrl: 'https://rik01.cik.bg/', contactsUrl: 'https://rik01.cik.bg/pvr2026/contacts' })
    expect(electionBaseOf(entries[22]!, 'pvr2026')).toBe('https://rik23.cik.bg/pvr2026')
  })
  it('reads phones and the protected email', () => {
    const contacts = parseContacts(fixture('rik23-pvr2026-contacts.html'))
    expect(contacts.phones.length).toBeGreaterThan(0)
    expect(contacts.email).toContain('@')
    expect(contacts.address).toContain('Алабин')
    const plovdiv = parseContacts(fixture('rik17-pvr2026-contacts.html'))
    expect(plovdiv.phones).toEqual(['+359 32 000 001', '+359 88 000 0002', '+359 88 000 0003', '+359 88 000 0004'])
    expect(plovdiv.email).toBe('rik@example.bg')
    expect(parseContacts(fixture('rik18-pvr2026-contacts.html')).phones).toEqual(['0888 000 000'])
    expect(decodeCfEmail('1d6f74765d78657c706d7178337f7a')).toBe('rik@example.bg')
  })
})

describe('our committee', () => {
  it('matches the full and short names', () => {
    expect(isOurCommittee('Инициативен комитет за издигане на кандидатурата на Андрей Атанасов Гюров за президент и Георги Димитров Кандев за вицепрезидент')).toBe(true)
    expect(isOurCommittee('ИК АНДРЕЙ ГЮРОВ')).toBe(true)
    expect(isOurCommittee('ИК за Кандев')).toBe(true)
    expect(isOurCommittee('ГЕРБ-СДС')).toBe(false)
  })
})
