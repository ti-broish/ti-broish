import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assignedSection,
  parseCikSections,
  SECTIONS_PEOPLE_HEADERS,
  SECTIONS_PEOPLE_PARTNERS_SQL,
  SECTIONS_PEOPLE_PRIORITY_SQL,
  SECTIONS_PEOPLE_SIGNUPS_SQL,
  SECTIONS_PEOPLE_TAKEN_SQL,
  sectionDeskText,
  sectionsPeopleCsv,
  sectionsPeopleFilename,
  sectionsPeopleRows,
  type SectionsPeoplePartnerRow,
  type SectionsPeopleSignupRow,
  type SectionsPeopleSources,
} from './sections-people-export'

const cookie = { value: '' as string | undefined }
vi.mock('cloudflare:workers', () => ({ env: {} }))
vi.mock('@tanstack/react-start/server', () => ({ getCookie: () => cookie.value }))
vi.mock('./section-places-lookup', () => ({ electionRegionNames: async () => ({ '01': 'Благоевград', '32': 'Извън страната' }) }))
vi.mock('./cik-sections.data', () => ({
  CIK_SECTIONS_AS_OF: '2026-10-25',
  CIK_MUNICIPALITIES: { '0101': 'БЛАГОЕВГРАД|БАНСКО' },
  CIK_ABROAD_MACHINE_SECTIONS: '320021010',
  CIK_SECTIONS: '010100001\tГР.БАНСКО\tСОУ "НЕОФИТ РИЛСКИ", УЛ."ТОДОР АЛЕКСАНДРОВ" №9Б\t630\n010100002\tГР.БАНСКО\tКМЕТСТВО\t120\n010100003\tГР.БАНСКО\tУЧИЛИЩЕ\t',
}))

const signup = (over: Partial<SectionsPeopleSignupRow> = {}): SectionsPeopleSignupRow => ({
  id: 's1',
  first_name: 'Иван',
  middle_name: 'Петров',
  last_name: 'Иванов',
  phone: '0888 000 001',
  email: 'ivan@example.com',
  role: 'section',
  coordinator: 0,
  draft_section: '010100001',
  published_section: '010100001',
  designation_mir: '01',
  designation_number: 7,
  ...over,
})
const partner = (over: Partial<SectionsPeoplePartnerRow> = {}): SectionsPeoplePartnerRow => ({
  id: 'pp-1',
  partner: 'ДБ',
  first_name: 'Мария',
  middle_name: '',
  last_name: 'Георгиева',
  phone: '0888 000 002',
  email: 'maria@example.com',
  section_draft: '010100002',
  section_published: '',
  designation_mir: '01',
  designation_number: null,
  ...over,
})
const cik = parseCikSections(
  '010100001\tГР.БАНСКО\tСОУ\t630\n010100002\tГР.БАНСКО\tКМЕТСТВО\t120\n010100003\tГР.БАНСКО\tУЧИЛИЩЕ\t\n010100004\tГР.БАНСКО\tПОДВИЖНА СИК\t',
  { '0101': 'БЛАГОЕВГРАД|БАНСКО' },
)
const sources = (over: Partial<SectionsPeopleSources> = {}): SectionsPeopleSources => ({
  signups: [],
  partners: [],
  priority: [],
  taken: [],
  cik: (code) => cik.get(code),
  abroad: (code) => (code === '320021010' ? { country: 'Австрия', place: 'Виена - 9-ти Бецирк', address: 'Pasteurgasse 1, 1090 Wien' } : undefined),
  abroadMachine: new Set(['320021010']),
  mirNames: { '01': 'Благоевград', '32': 'Извън страната' },
  ...over,
})
const col = (row: string[], name: (typeof SECTIONS_PEOPLE_HEADERS)[number]) => row[SECTIONS_PEOPLE_HEADERS.indexOf(name)]

describe('„Секции с хора“ rows', () => {
  it('has the 23.10 columns, in order, and never an ЕГН', () => {
    expect(SECTIONS_PEOPLE_HEADERS.join(',')).toBe(
      'СИК,№ секция,МИР,Област / Държава,Община,Населено място,Адрес,Вид (хартия/машина),Приоритет (R / ниво),Заета от друга организация,Брой хора,Източник,Име,Роля,Телефон,Имейл,Статус на разпределение,Пълномощно (МИР/№)',
    )
    for (const sql of [SECTIONS_PEOPLE_SIGNUPS_SQL, SECTIONS_PEOPLE_PARTNERS_SQL, SECTIONS_PEOPLE_PRIORITY_SQL, SECTIONS_PEOPLE_TAKEN_SQL]) {
      expect(sql).not.toMatch(/egn/i)
      expect(sql.trim()).toMatch(/^SELECT /)
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/i)
    }
    expect(SECTIONS_PEOPLE_SIGNUPS_SQL).toContain('COALESCE(withdrawn, 0) = 0')
    expect(SECTIONS_PEOPLE_PARTNERS_SQL).toContain("COALESCE(p.withdrawn_at, '') = ''")
  })

  it('one row per person; only sections that have someone; published before draft; sorted by code, abroad last', () => {
    const rows = sectionsPeopleRows(
      sources({
        signups: [
          signup({ id: 's2', first_name: 'Аброад', middle_name: '', last_name: 'Човек', draft_section: '', published_section: '320021010', designation_mir: '32', designation_number: 3 }),
          signup(),
          signup({ id: 's3', first_name: 'Борис', middle_name: '', last_name: 'Мобилен', role: 'mobile', coordinator: 1, draft_section: '010100001', published_section: '', designation_number: null }),
          signup({ id: 's4', draft_section: '', published_section: '' }),
        ],
        partners: [partner(), partner({ id: 'pp-2', section_draft: '', section_published: '' })],
        priority: [{ section_code: '010100002', town: '', municipality: '', oblast: '', r: 4.2, level: 'elevated', components: '{}' }],
        taken: [{ section_code: '010100002', organisation: 'И аз' }],
      }),
    )
    expect(rows.map((row) => row[0])).toEqual(['010100001', '010100001', '010100002', '320021010'])
    expect(rows.every((row) => row.length === SECTIONS_PEOPLE_HEADERS.length)).toBe(true)
    // 010100003 (nobody) is not in the file at all.
    expect(rows.some((row) => row[0] === '010100003')).toBe(false)
    const [ivan, boris, maria, abroad] = rows
    expect(ivan).toEqual([
      '010100001', '001', '01 Благоевград', 'БЛАГОЕВГРАД', 'БАНСКО', 'ГР.БАНСКО', 'СОУ', 'машинна', '', '', '2',
      'Ти броиш', 'Иван Петров Иванов', 'секционен (член СИК/застъпник)', '0888 000 001', 'ivan@example.com', 'публикувана', '01/7',
    ])
    expect(col(boris, 'Роля')).toBe('мобилен екип · координатор')
    expect(col(boris, 'Статус на разпределение')).toBe('чернова')
    expect(col(boris, 'Пълномощно (МИР/№)')).toBe('')
    expect(col(maria, 'Източник')).toBe('И аз (ДБ)')
    expect(col(maria, 'Вид (хартия/машина)')).toBe('хартия')
    expect(col(maria, 'Приоритет (R / ниво)')).toBe('4.2 / повишен')
    expect(col(maria, 'Заета от друга организация')).toBe('И аз')
    expect(col(maria, 'Брой хора')).toBe('1')
    expect(abroad.slice(0, 8)).toEqual(['320021010', '010', '32 Извън страната', 'Австрия', '', 'Виена - 9-ти Бецирк', 'Pasteurgasse 1, 1090 Wien', 'машинна'])
  })

  it('names a different pending draft next to a published section', () => {
    expect(assignedSection('010100001', '010100002')).toEqual({ code: '010100001', status: 'публикувана (чернова друга: 010100002)' })
    expect(assignedSection('', ' 01 01 00 002 ')).toEqual({ code: '010100002', status: 'чернова' })
    expect(assignedSection('', '')).toEqual({ code: '', status: '' })
  })

  it('paper or machine like the 23.10 file', () => {
    const none = new Set<string>()
    expect(sectionDeskText('010100001', cik.get('010100001'), undefined, none)).toBe('машинна')
    expect(sectionDeskText('010100002', cik.get('010100002'), undefined, none)).toBe('хартия')
    expect(sectionDeskText('010100004', cik.get('010100004'), undefined, none)).toBe('хартия')
    const pri = { section_code: '010100003', town: '', municipality: '', oblast: '', r: 1, level: 'watch', components: '{"mode":"x"}' }
    expect(sectionDeskText('010100003', cik.get('010100003'), pri, none)).toBe('машинна')
    expect(sectionDeskText('010100003', cik.get('010100003'), undefined, none)).toBe('неизвестно')
    expect(sectionDeskText('320010003', undefined, undefined, none)).toBe('хартия')
  })

  it('UTF-8 BOM CSV and a Sofia-dated file name', () => {
    const csv = sectionsPeopleCsv(sectionsPeopleRows(sources({ signups: [signup()] })))
    expect(csv.startsWith('\uFEFFСИК,№ секция,')).toBe(true)
    expect(csv.trim().split('\n')).toHaveLength(2)
    expect(sectionsPeopleFilename(new Date('2026-10-24T22:30:00Z'))).toBe('tibroish-sekcii-s-hora-2026-10-25.csv')
  })
})

// ---- access: only admins (exportInternal) get the file
const fake = {
  sessions: new Map<string, { email: string; email_confirmed: number }>(),
  staff: new Map<string, { role: string }>(),
  queries: [] as string[],
}
function fakeDb() {
  return {
    prepare(sql: string) {
      fake.queries.push(sql)
      const all = async () => {
        if (sql === SECTIONS_PEOPLE_SIGNUPS_SQL) return { results: [signup()] }
        if (sql === SECTIONS_PEOPLE_PARTNERS_SQL) return { results: [partner()] }
        return { results: [] }
      }
      return {
        all,
        bind(...args: unknown[]) {
          return {
            all,
            async first() {
              if (sql.includes('WHERE session_token')) return fake.sessions.get(String(args[0])) ?? null
              if (sql.includes('FROM staff')) return fake.staff.get(String(args[0])) ?? null
              throw new Error(`unexpected ${sql}`)
            },
          }
        },
      }
    },
  }
}
vi.mock('./db-core', () => ({ SESSION_COOKIE: 'tb_session', signupDatabase: async () => fakeDb() }))

function signInAs(role: string | null, email = `${role ?? 'none'}@example.com`, confirmed = 1) {
  cookie.value = `s-${email}`
  fake.sessions.set(cookie.value, { email, email_confirmed: confirmed })
  if (role) fake.staff.set(email, { role })
}

describe('„Секции с хора“ access', () => {
  beforeEach(() => {
    cookie.value = undefined
    fake.sessions.clear()
    fake.staff.clear()
    fake.queries = []
  })
  const run = async () => (await import('./sections-people-export.server')).handleSectionsPeopleExport()
  const readsPeople = () => fake.queries.some((sql) => sql === SECTIONS_PEOPLE_SIGNUPS_SQL || sql === SECTIONS_PEOPLE_PARTNERS_SQL)

  it('signed out, unconfirmed, not staff, viewer or editor: no file and no people query', async () => {
    expect(await run()).toMatchObject({ ok: false, state: 'signed-out' })
    signInAs(null, 'stranger@example.com')
    expect(await run()).toMatchObject({ ok: false, state: 'forbidden' })
    signInAs('admin', 'unconfirmed@example.com', 0)
    expect(await run()).toMatchObject({ ok: false, state: 'unconfirmed' })
    for (const role of ['viewer', 'editor']) {
      signInAs(role)
      expect(await run()).toMatchObject({ ok: false, state: 'forbidden' })
    }
    expect(readsPeople()).toBe(false)
  })

  it('an admin gets the CSV of sections with people', async () => {
    signInAs('admin')
    const result = await run()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result).toMatchObject({ people: 2, ours: 1, partners: 1, sections: 2 })
    expect(result.filename).toMatch(/^tibroish-sekcii-s-hora-\d{4}-\d{2}-\d{2}\.csv$/)
    const lines = result.csv.trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('010100001,001,01 Благоевград,БЛАГОЕВГРАД,БАНСКО,ГР.БАНСКО')
    expect(result.csv).not.toMatch(/egn|ЕГН/i)
    expect(fake.queries.every((sql) => /^\s*SELECT /.test(sql))).toBe(true)
  })
})
