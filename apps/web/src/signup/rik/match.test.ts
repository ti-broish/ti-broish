import { describe, expect, it } from 'vitest'
import { matchAll, type RikEntryRow, type RikPerson, type RikSourceHealth } from './match'
import { nameKey } from './normalize'

const NOW = new Date('2026-10-22T12:00:00.000Z')
const RECENT = '2026-10-22T06:00:00.000Z' // 6 h before NOW
const OLD = '2026-10-20T06:00:00.000Z' // 54 h before NOW

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

  it('pending inside 36 h, stale after → call РИК', () => {
    const fresh = run([person('a', 'Иван Петров Иванов')], [])
    expect(fresh.results[0]!.status).toBe('pending')
    expect(fresh.tasks).toEqual([])
    const stale = run([person('a', 'Иван Петров Иванов', { signedAt: OLD })], [])
    expect(stale.results[0]!.status).toBe('stale')
    expect(stale.tasks).toEqual([expect.objectContaining({ id: 'a:call_rik:not_published', type: 'call_rik', mir: '23' })])
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

  it('a different person under our number → call РИК', () => {
    const { tasks } = run([person('a', 'Яна Данчева Василева')], [entry('Борис Николов Захариев')])
    expect(tasks[0]).toMatchObject({ type: 'call_rik', reason: 'number_taken' })
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
