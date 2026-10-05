import { describe, expect, it } from 'vitest'
import { campaignCsv, distributionWhere, egnLast4, internalCsv, parsePeopleCsv, parseTakenCsv, rosterWhere, visibleSection, type RosterFields } from './admin-csv'

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
