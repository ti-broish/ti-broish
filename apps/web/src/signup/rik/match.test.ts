import { describe, expect, it } from 'vitest'
import { matchAll, type RikEntryRow, type RikPerson, type RikSourceHealth } from './match'
import { nameKey } from './normalize'

const NOW = new Date('2026-10-22T12:00:00.000Z')
const RECENT = '2026-10-22T06:00:00.000Z' // 6 h before NOW
const OLD = '2026-10-20T06:00:00.000Z' // 54 h before NOW
const DAY_AGO = '2026-10-21T11:00:00.000Z' // 25 h before NOW: stale under 24 h, pending under the old 36 h

function person(id: string, name: string, patch: Partial<RikPerson> = {}): RikPerson {
  return { id, source: 'signup', mir: '23', number: 501, issuedOn: '19.10.2026', nameKey: nameKey(name), withdrawn: false, signedAt: RECENT, ...patch }
}

let seq = 0
function entry(name: string, patch: Partial<RikEntryRow> = {}): RikEntryRow {
  seq += 1
  return {
    id: `e${seq}`,
    mir: '23',
    kind: 'representative',
    ours: true,
    party: 'ИК Гюров',
    name,
    nameKey: nameKey(name),
    number: 501,
    numberDate: '19.10.2026',
    annulled: false,
    missingSince: null,
    ...patch,
  }
}

const ok = (mir: string): RikSourceHealth => ({ mir, health: 'ok', failures: 0, lastError: '' })
const sources = ['23', '24', '25'].map(ok)

function run(people: RikPerson[], entries: RikEntryRow[], health = sources) {
  return matchAll(people, entries, health, NOW, 2)
}

describe('classification mirrors last election’s sheet', () => {
  it('registered: number and name match in the own РИК, whatever the spelling style', () => {
    const { results, tasks } = run([person('a', 'Иван Петров Иванов')], [entry('ИВАН ПЕТРОВ ИВАНОВ')])
    expect(results[0]).toMatchObject({ status: 'registered', entryId: expect.any(String) })
    expect(tasks).toEqual([])
  })

  it('registered with a date note when the РИК typed another date', () => {
    const { results } = run([person('a', 'Иван Петров Иванов')], [entry('Иван Петров Иванов', { numberDate: '20.10.2026' })])
    expect(results[0]!.status).toBe('registered')
    expect(results[0]!.detail).toContain('20.10.2026')
  })

  it('pending inside 24 h, stale after → call РИК', () => {
    const fresh = run([person('a', 'Иван Петров Иванов')], [])
    expect(fresh.results[0]!.status).toBe('pending')
    expect(fresh.tasks).toEqual([])
    const stale = run([person('a', 'Иван Петров Иванов', { signedAt: DAY_AGO })], [])
    expect(stale.results[0]!.status).toBe('stale')
    expect(stale.tasks).toEqual([expect.objectContaining({ id: 'a:call_rik:not_published', type: 'call_rik', mir: '23' })])
    expect(stale.tasks[0]!.detail).toContain('24 ч.')
  })

  it('the clock starts at the МИР’s submitted_at when that is later than the signed upload', () => {
    const submitted = (submittedAt: string | null) => [{ ...ok('23'), submittedAt }]
    const reset = run([person('a', 'Иван Петров Иванов', { signedAt: OLD })], [], submitted('2026-10-22T06:41:00.000Z'))
    expect(reset.results[0]!.status).toBe('pending')
    expect(reset.tasks).toEqual([])
    // An older submission does not hold back the person's own clock.
    const older = run([person('a', 'Иван Петров Иванов', { signedAt: DAY_AGO })], [], submitted('2026-10-19T00:00:00.000Z'))
    expect(older.results[0]!.status).toBe('stale')
    // 24 h after the submission the call comes.
    const later = matchAll([person('a', 'Иван Петров Иванов', { signedAt: OLD })], [], submitted('2026-10-22T06:41:00.000Z'), new Date('2026-10-23T06:41:00.000Z'), 2)
    expect(later.results[0]!.status).toBe('stale')
    // A registered person is untouched by it.
    const registered = run([person('a', 'Иван Петров Иванов', { signedAt: OLD })], [entry('Иван Петров Иванов')], submitted('2026-10-22T06:41:00.000Z'))
    expect(registered.results[0]!.status).toBe('registered')
  })

  it('a РИК that has published nothing yet: waiting, no call per person', () => {
    for (const health of ['empty', 'not_published'] as const) {
      const { results, tasks } = run([person('a', 'Иван Петров Иванов', { signedAt: OLD })], [], [{ mir: '23', health, failures: 0, lastError: '' }])
      expect(results[0]).toMatchObject({ status: 'pending', detail: 'РИК 23 още не е публикувал регистъра.' })
      expect(tasks).toEqual([])
    }
  })

  it('not signed yet: nothing to chase', () => {
    const { results, tasks } = run([person('a', 'Иван Петров Иванов', { signedAt: null })], [])
    expect(results[0]!.status).toBe('not_signed')
    expect(tasks).toEqual([])
  })

  it('name typo under our number → fix data + new пълномощно', () => {
    const { results, tasks } = run([person('a', 'Яна Данчева Василева')], [entry('Яна Данчева Вссилева')])
    expect(results[0]!.status).toBe('name_mismatch')
    expect(tasks[0]).toMatchObject({ type: 'fix_data', reason: 'name' })
    expect(tasks[0]!.detail).toContain('Вссилева')
  })

  it('another of our people under our number → call РИК (a mix-up between ours)', () => {
    const { results, tasks } = run(
      [person('a', 'Яна Данчева Василева'), person('b', 'Борис Николов Захариев', { number: 502 })],
      [entry('Борис Николов Захариев')],
    )
    expect(results[0]).toMatchObject({ personId: 'a', status: 'name_mismatch' })
    expect(tasks.find((task) => task.personId === 'a')).toMatchObject({ type: 'call_rik', reason: 'number_taken' })
  })

  it('someone who is none of ours under our number → „зает външно“: a new number, even before signing (the 01/515 case)', () => {
    for (const signedAt of [RECENT, null]) {
      const { results, tasks } = run([person('a', 'Яна Данчева Василева', { signedAt })], [entry('Борис Николов Захариев')])
      expect(results[0]).toMatchObject({ status: 'taken_external', entryId: expect.any(String), detail: 'Борис Николов Захариев' })
      expect(tasks).toEqual([expect.objectContaining({ id: 'a:renumber:external', type: 'renumber', reason: 'external', mir: '23' })])
      expect(tasks[0]!.detail).toContain('№ 23/501 е зает външно в РИК 23')
    }
  })

  it('a name typo under our number stays a name fix, never „зает външно“', () => {
    const { results } = run([person('a', 'Яна Данчева Василева', { signedAt: null })], [entry('Яна Данчева Вссилева')])
    expect(results[0]!.status).toBe('not_signed')
  })

  it('withdrawn „И аз“ duplicate of an active volunteer: the volunteer’s row is not theirs (the 03/515, 17/506 case)', () => {
    const { results, tasks } = run(
      [person('s-1', 'Иван Петров Иванов', { number: 504 }), person('pp-1', 'Иван Петров Иванов', { source: 'partner', number: 515, withdrawn: true })],
      [entry('Иван Петров Иванов', { number: 504 })],
    )
    const byId = new Map(results.map((row) => [row.personId, row]))
    expect(byId.get('s-1')!.status).toBe('registered')
    expect(byId.get('pp-1')!.status).toBe('withdrawn')
    expect(tasks).toEqual([])
  })

  it('withdrawn and published under another number nobody of ours holds → still „за заличаване“', () => {
    const { results } = run([person('a', 'Иван Петров Иванов', { withdrawn: true })], [entry('Иван Петров Иванов', { number: 777 })])
    expect(results[0]!.status).toBe('withdrawn_registered')
  })

  it('a row in the МИР a person moved away from is still theirs (ledger history), not external', () => {
    const people = [person('a', 'Иван Петров Иванов', { mir: '24', number: 640 }), person('x', 'Друга Някоя Жена')]
    const entries = [entry('Иван Петров Иванов')]
    const without = matchAll(people, entries, sources, NOW, 2)
    expect(without.results.find((row) => row.personId === 'x')!.status).toBe('taken_external')
    const withHistory = matchAll(people, entries, sources, NOW, 2, { ledgerMirs: new Map([['a', new Set(['23', '24'])]]) })
    expect(withHistory.results.find((row) => row.personId === 'x')!.status).toBe('name_mismatch')
    expect(withHistory.tasks.find((task) => task.personId === 'x')).toMatchObject({ type: 'call_rik', reason: 'number_taken' })
  })

  it('name published under another number → call РИК', () => {
    const { results, tasks } = run([person('a', 'Иван Петров Иванов')], [entry('Иван Петров Иванов', { number: 777 })])
    expect(results[0]!.status).toBe('number_mismatch')
    expect(tasks[0]).toMatchObject({ type: 'call_rik', reason: 'number' })
  })

  it('„Анулиран“ under our number → call РИК to find out why', () => {
    const { results, tasks } = run([person('a', 'Иван Петров Иванов')], [entry('Анулиран', { annulled: true })])
    expect(results[0]!.status).toBe('annulled')
    expect(tasks[0]).toMatchObject({ type: 'call_rik', reason: 'annulled' })
  })

  it('found in another РИК for us („Намерен в друг РИК“) → remove from one place', () => {
    const { results, tasks } = run([person('a', 'Иван Петров Иванов')], [entry('Иван Петров Иванов', { mir: '24', number: 640 })])
    expect(results[0]).toMatchObject({ status: 'elsewhere', otherMir: '24' })
    expect(tasks[0]).toMatchObject({ type: 'remove_person', reason: 'other_rik' })
  })

  it('registered for another party → remove person, even when also registered with us', () => {
    const { results, tasks } = run(
      [person('a', 'Иван Петров Иванов')],
      [entry('Иван Петров Иванов'), entry('Иван Петров Иванов', { ours: false, party: 'ДРУГА ПАРТИЯ', mir: '25', number: 3 })],
    )
    expect(results[0]).toMatchObject({ status: 'other_party', otherParty: 'ДРУГА ПАРТИЯ', otherMir: '25' })
    expect(tasks).toEqual([expect.objectContaining({ type: 'remove_person', reason: 'other_party' })])
  })

  it('withdrawn but published → remove person; withdrawn and absent → nothing', () => {
    const published = run([person('a', 'Иван Петров Иванов', { withdrawn: true })], [entry('Иван Петров Иванов')])
    expect(published.results[0]!.status).toBe('withdrawn_registered')
    expect(published.tasks[0]).toMatchObject({ type: 'remove_person', reason: 'withdrawn' })
    const gone = run([person('a', 'Иван Петров Иванов', { withdrawn: true })], [])
    expect(gone.results[0]!.status).toBe('withdrawn')
    expect(gone.tasks).toEqual([])
  })

  it('duplicate (same ЕГН keeps another number) never gets „call the РИК“; if published, ask to annul that number', () => {
    const quiet = run([person('pp-1', 'Иван Петров Иванов', { source: 'partner', number: 515, signedAt: OLD, duplicate: true })], [])
    expect(quiet.results[0]!.status).toBe('duplicate')
    expect(quiet.tasks).toEqual([])
    const published = run(
      [person('s-1', 'Иван Петров Иванов', { number: 504 }), person('pp-1', 'Иван Петров Иванов', { source: 'partner', number: 515, duplicate: true })],
      [entry('Иван Петров Иванов', { number: 504 }), entry('Иван Петров Иванов', { number: 515 })],
    )
    const byId = new Map(published.results.map((row) => [row.personId, row]))
    expect(byId.get('s-1')!.status).toBe('registered')
    expect(byId.get('pp-1')!.status).toBe('duplicate')
    expect(published.tasks.filter((task) => task.personId === 'pp-1')).toEqual([
      expect.objectContaining({ type: 'remove_person', reason: 'duplicate', detail: expect.stringContaining('№ 515') }),
    ])
    expect(published.tasks.some((task) => task.type === 'call_rik')).toBe(false)
  })

  it('rows that disappeared from the register do not count', () => {
    const { results } = run([person('a', 'Иван Петров Иванов')], [entry('Иван Петров Иванов', { missingSince: RECENT })])
    expect(results[0]!.status).toBe('pending')
  })

  it('advocates rows never stand in for the representatives register', () => {
    const { results } = run([person('a', 'Иван Петров Иванов')], [entry('Иван Петров Иванов', { kind: 'advocate' })])
    expect(results[0]!.status).toBe('pending')
  })

  it('a РИК that cannot be read → unknown for its people and a „check РИК“ task after 2 failures', () => {
    const broken: RikSourceHealth[] = [{ mir: '23', health: 'error', failures: 2, lastError: 'HTTP 503' }]
    const { results, tasks } = run([person('a', 'Иван Петров Иванов')], [], broken)
    expect(results[0]!.status).toBe('rik_unavailable')
    expect(tasks).toEqual([expect.objectContaining({ id: 'rik:23:check_rik', type: 'check_rik', personId: null })])
    const once = run([person('a', 'Иван Петров Иванов')], [], [{ ...broken[0]!, failures: 1 }])
    expect(once.tasks).toEqual([])
  })

  it('„И аз“ partner people are matched the same way', () => {
    const { results } = run([person('pp-1', 'Ина Иванова Петрова', { source: 'partner', mir: '24', number: 610 })], [entry('Ина Иванова Петрова', { mir: '24', number: 610 })])
    expect(results[0]).toMatchObject({ source: 'partner', status: 'registered' })
  })

  it('task ids are stable, so re-running never duplicates', () => {
    const one = run([person('a', 'Иван Петров Иванов', { signedAt: OLD })], [])
    const two = run([person('a', 'Иван Петров Иванов', { signedAt: OLD })], [])
    expect(one.tasks.map((t) => t.id)).toEqual(two.tasks.map((t) => t.id))
  })
})

describe('renamed after the РИК got the old name', () => {
  const renamed = () => person('g', 'Гергана Начева-Лазарова', { mir: '02', number: 509, previousNames: ['Гергана Начева Начаева-Лазарова'] })

  it('not in the register yet: „Сменено име“ with a fix_name task', () => {
    const { results, tasks } = run([renamed()], [], [ok('02')])
    expect(results[0]).toMatchObject({ status: 'renamed', detail: 'Гергана Начева Начаева-Лазарова' })
    expect(tasks).toEqual([expect.objectContaining({ id: 'g:fix_name:renamed', type: 'fix_name', mir: '02' })])
  })

  it('register shows the old name: still renamed, linked to that row, no name-mismatch', () => {
    const { results, tasks } = run([renamed()], [entry('ГЕРГАНА НАЧЕВА НАЧАЕВА-ЛАЗАРОВА', { mir: '02', number: 509 })], [ok('02')])
    expect(results[0]).toMatchObject({ status: 'renamed', entryId: expect.any(String) })
    expect(tasks.map((t) => t.type)).toEqual(['fix_name'])
  })

  it('register shows the new name: registered and the task is gone', () => {
    const { results, tasks } = run([renamed()], [entry('Гергана Начева-Лазарова', { mir: '02', number: 509 })], [ok('02')])
    expect(results[0]!.status).toBe('registered')
    expect(tasks).toEqual([])
  })
})
