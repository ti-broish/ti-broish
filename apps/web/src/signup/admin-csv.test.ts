import { describe, expect, it } from 'vitest'
import {
  BREVO_SECTIONS_HEADERS,
  brevoSectionsCsv,
  campaignCsv,
  csvCell,
  distributionWhere,
  egnLast4,
  internalCsv,
  normalizeBrevoSms,
  parsePeopleCsv,
  parseTakenCsv,
  rosterWhere,
  visibleSection,
  type RosterFields,
} from './admin-csv'

const person: RosterFields = {
  id: '1',
  email: 'ivan@example.com',
  firstName: 'Иван',
  middleName: 'Иванов',
  lastName: 'Иванов',
  phone: '0888123456',
  mir: '23',
  region: '23',
  town: 'гр. София',
  place: 'ул. Пример 1',
  role: 'section',
  submitted: true,
  withdrawn: false,
  emailConfirmed: true,
  imported: false,
  draftSection: '234600199',
  publishedSection: '234600101',
  egn: '0041010002',
  notes: 'Имам кола',
  callRequestedAt: '2026-09-20T10:00:00.000Z',
  callMessage: 'За секцията',
  cantReachSection: '',
  cantReachAt: '',
  staffNote: 'Ще дойде и на двата дни.',
  staffCalledAt: '2026-09-21T10:00:00.000Z',
  staffCalledBy: 'ada@example.com',
}

describe('assignment visibility', () => {
  it('shows only a published section', () => {
    expect(visibleSection(' 234600101 ')).toBe('234600101')
    expect(visibleSection('')).toBeNull()
    expect(visibleSection(null)).toBeNull()
  })

  it('keeps the national number out of both exports', () => {
    expect(egnLast4('0041010002')).toBe('0002')
    const campaign = campaignCsv([person])
    const internal = internalCsv([person])
    expect(campaign).not.toContain('234600199')
    expect(campaign).not.toContain('0041010002')
    expect(campaign).not.toContain('0002')
    expect(campaign).toContain('234600101')
    expect(internal).toContain('234600199')
    expect(internal).toContain('0002')
    expect(internal).not.toContain('0041010002')
    expect(campaign).toContain('Имам кола')
    expect(campaign).toContain('За секцията')
    expect(internal).toContain('Имам кола')
    expect(internal).toContain('Ще дойде и на двата дни.')
    expect(campaign).not.toContain('Ще дойде и на двата дни.')
    expect(internal).toContain(',1,')
    expect(internal).toContain('cant_reach_section')
    const withReach = { ...person, cantReachSection: '234600101', cantReachAt: '2026-10-17T12:00:00.000Z' }
    expect(internalCsv([withReach])).toContain('234600101')
  })
})

describe('roster filters', () => {
  it('separates a published section from a draft and from abroad', () => {
    expect(rosterWhere('assigned', '')).toEqual({ clause: "COALESCE(published_section, '') != ''", binds: [] })
    const unassigned = rosterWhere('unassigned', '')
    const draft = rosterWhere('draft', '')
    expect('clause' in unassigned && unassigned.clause).toContain("published_section, '') = ''")
    expect('clause' in draft && draft.clause).toContain('draft_section')
    expect(rosterWhere('finished', '')).toEqual({ clause: 'COALESCE(submitted, 0) = 1 AND COALESCE(withdrawn, 0) = 0', binds: [] })
    expect(rosterWhere('started', '')).toEqual({ clause: 'COALESCE(submitted, 0) = 0 AND COALESCE(withdrawn, 0) = 0', binds: [] })
    expect(rosterWhere('abroad', '')).toEqual({ clause: "region_code = '32'", binds: [] })
    const calls = rosterWhere('calls', '')
    expect('clause' in calls && calls.clause).toContain('callRequestedAt')
    expect('clause' in calls && calls.clause).toContain('callMessage')
    const queue = rosterWhere('queue', '')
    expect('clause' in queue && queue.clause).toContain('callRequestedAt')
    expect('clause' in queue && queue.clause).toContain('callMessage')
    expect('clause' in queue && queue.clause).toContain("staff_called_at, '') = ''")
    const distribution = distributionWhere('unassigned', '')
    expect('clause' in distribution && distribution.clause).toContain('COALESCE(submitted, 0) = 1')
    expect('clause' in distribution && distribution.clause).toContain('COALESCE(withdrawn, 0) = 0')
    expect(rosterWhere('mir', '3')).toEqual({ clause: 'mir_code = ?', binds: ['03'] })
    expect(rosterWhere('mir', 'София')).toEqual({ error: 'МИР е номер, например 23.' })
  })
})

describe('csv import', () => {
  it('reads taken sections and people, including a quoted comma', () => {
    const taken = parseTakenCsv('секция,организация,място\n234600101,"Друга, организация",ул. Пример 1\n')
    expect(taken.errors).toEqual([])
    expect(taken.rows).toEqual([
      { sectionCode: '234600101', mirCode: '23', place: 'ул. Пример 1', organisation: 'Друга, организация', note: '' },
    ])
    const people = parsePeopleCsv('име,презиме,фамилия,имейл,телефон\nИван,Иванов,Иванов,Ivan@Example.com,0888123456\nлош ред,,,\n')
    expect(people.rows).toHaveLength(1)
    expect(people.rows[0]?.email).toBe('ivan@example.com')
    expect(people.errors).toEqual(['Ред 3: имейлът не е валиден.'])
  })
})

describe('normalizeBrevoSms', () => {
  it('normalizes Bulgarian and international phones to +E.164', () => {
    expect(normalizeBrevoSms('0888 123 456')).toBe('+359888123456')
    expect(normalizeBrevoSms('359888123456')).toBe('+359888123456')
    expect(normalizeBrevoSms('00359888123456')).toBe('+359888123456')
    expect(normalizeBrevoSms('+44 7123 456789')).toBe('+447123456789')
    expect(normalizeBrevoSms('888123456')).toBe('+359888123456')
    expect(normalizeBrevoSms('')).toBe('')
    expect(normalizeBrevoSms('12')).toBe('')
    expect(normalizeBrevoSms('not-a-phone')).toBe('')
  })
})

describe('csvCell injection guard', () => {
  it('leaves a valid E.164 SMS alone and still quotes formula risks', () => {
    expect(csvCell('+359888123456')).toBe('+359888123456')
    expect(csvCell('=cmd')).toBe("'=cmd")
    expect(csvCell('+hack')).toBe("'+hack")
    expect(csvCell('@sum')).toBe("'@sum")
  })
})

describe('brevoSectionsCsv', () => {
  it('writes the Brevo header with BOM and only the published section', () => {
    const csv = brevoSectionsCsv([
      {
        email: ' Ivan@Example.com ',
        firstName: 'Иван',
        lastName: 'Иванов',
        phone: '0888 123 456',
        mir: '23',
        publishedSection: '234600101',
        sectionAddress: 'СУ Пример, ул. "Витоша", ж.к. Младост',
        sectionPlace: 'гр.София',
        role: 'section',
        sectionPublished: true,
      },
    ])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.replace(/^\uFEFF/, '').trimEnd().split('\n')
    expect(lines[0]).toBe(BREVO_SECTIONS_HEADERS.join(','))
    expect(lines[0]).toBe(
      'EMAIL,FIRSTNAME,LASTNAME,SMS,MIR,SECTION_ID,SECTION_CODE,SECTION_ID_TEXT,SECTION_ADDRESS,SECTION_PLACE,ROLE,SECTION_PUBLISHED',
    )
    expect(csv).toContain('ivan@example.com')
    expect(csv).toContain('+359888123456')
    expect(csv).toContain('234600101')
    expect(csv).not.toContain('234600199')
    expect(csv).toContain('true')
    expect(csv).toContain('Представител')
    expect(csv).toContain('"СУ Пример, ул. ""Витоша"", ж.к. Младост"')
    expect(csv).toContain('гр.София')
  })

  it('quotes addresses with newlines and marks unpublished rows false', () => {
    const csv = brevoSectionsCsv([
      {
        email: 'a@example.com',
        firstName: 'А',
        lastName: 'Б',
        phone: '',
        mir: '',
        publishedSection: '',
        sectionAddress: 'ред1\nред2',
        sectionPlace: '',
        role: 'mobile',
        sectionPublished: false,
      },
    ])
    expect(csv).toContain('"ред1\nред2"')
    expect(csv).toContain(',false')
    expect(csv.split('\n')[1]).not.toMatch(/,\d{9},/)
  })
})
