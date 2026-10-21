/**
 * Matches people who hold a пълномощно against the published registers and derives
 * their status and the team's tasks. Pure: the sync loads the rows and writes the result.
 *
 * Mirrors last election's sheet („diff“ + „Задачки“): a row was checked „по име“ (lower case,
 * no spaces or hyphens) and „по номер“ (number/date) against the РИК of the person's МИР, and a
 * person found in another РИК was flagged. The fixes there were: correct the name and send a new
 * пълномощно, drop the person (registered for someone else, member of a СИК, candidate), or send
 * them again / call the РИК when nothing showed up.
 */
import { STALE_AFTER_HOURS, mirLabel } from './config'
import { editDistance } from './normalize'

export type RikStatus =
  | 'registered' // published by the РИК of their МИР under our committee, name and number match
  | 'pending' // not published yet, still within STALE_AFTER_HOURS of signing
  | 'stale' // not published long after the signed пълномощно went out
  | 'not_signed' // has a number but no signed пълномощно yet: nothing to look for
  | 'name_mismatch' // our number is published under a differently written name
  | 'number_mismatch' // the name is published in their РИК under another number or date
  | 'annulled' // their row reads „Анулиран“
  | 'elsewhere' // published for us, but by another РИК
  | 'other_party' // their name is on another party's / committee's register
  | 'withdrawn_registered' // left us, still published
  | 'withdrawn' // left us, not published: nothing to do
  | 'rik_unavailable' // the РИК's register could not be read

export type RikTaskType = 'call_rik' | 'remove_person' | 'fix_data' | 'check_rik'

export const STATUS_LABELS: Record<RikStatus, string> = {
  registered: 'Регистриран',
  pending: 'Чака РИК',
  stale: 'Не е публикуван',
  not_signed: 'Без подписано пълномощно',
  name_mismatch: 'Различно име',
  number_mismatch: 'Различен номер/дата',
  annulled: 'Анулиран',
  elsewhere: 'В друг РИК',
  other_party: 'За друга партия',
  withdrawn_registered: 'Отписан, но регистриран',
  withdrawn: 'Отписан',
  rik_unavailable: 'РИК не се чете',
}

export const TASK_LABELS: Record<RikTaskType, string> = {
  call_rik: 'Обади се на РИК',
  remove_person: 'Махни човека',
  fix_data: 'Поправи данните + ново пълномощно',
  check_rik: 'Провери РИК ръчно',
}

export interface RikPerson {
  id: string
  source: 'signup' | 'partner'
  mir: string
  number: number | null
  /** dd.mm.yyyy on our пълномощно. */
  issuedOn: string
  nameKey: string
  withdrawn: boolean
  /** When the signed пълномощно went to the РИК (first signed upload), ISO; null when not signed. */
  signedAt: string | null
}

export interface RikEntryRow {
  id: string
  mir: string
  kind: 'representative' | 'advocate'
  ours: boolean
  party: string
  name: string
  nameKey: string
  number: number | null
  numberDate: string | null
  annulled: boolean
  missingSince: string | null
}

export interface RikSourceHealth {
  mir: string
  health: 'ok' | 'empty' | 'not_published' | 'error' | 'never' | 'unrecognised'
  failures: number
  lastError: string
}

export interface PersonResult {
  personId: string
  source: RikPerson['source']
  mir: string
  number: number | null
  status: RikStatus
  entryId: string | null
  otherMir: string
  otherParty: string
  detail: string
}

export interface DerivedTask {
  id: string
  personId: string | null
  mir: string
  type: RikTaskType
  reason: string
  detail: string
}

function hoursBetween(fromIso: string, to: Date) {
  const from = Date.parse(fromIso)
  return Number.isFinite(from) ? (to.getTime() - from) / 3_600_000 : 0
}

/** Close enough to be the same person typed differently (one or two letters, a swapped middle name). */
export function looksLikeSamePerson(a: string, b: string) {
  if (!a || !b) return false
  return editDistance(a, b, 4) <= 3
}

function task(person: RikPerson, type: RikTaskType, reason: string, detail: string): DerivedTask {
  return { id: `${person.id}:${type}:${reason}`, personId: person.id, mir: person.mir, type, reason, detail }
}

/**
 * One person against all entries. `byMirNumber` holds our committee's representative rows by
 * „МИР:number“, `byKey` every kept row by name key.
 */
export function classifyPerson(
  person: RikPerson,
  index: { byMirNumber: Map<string, RikEntryRow[]>; byKey: Map<string, RikEntryRow[]> },
  sources: Map<string, RikSourceHealth>,
  now: Date,
): { result: PersonResult; tasks: DerivedTask[] } {
  const base = { personId: person.id, source: person.source, mir: person.mir, number: person.number }
  const live = (rows: RikEntryRow[] | undefined) => (rows ?? []).filter((row) => !row.missingSince && row.kind === 'representative')
  const sameKey = live(index.byKey.get(person.nameKey))
  const ownByName = sameKey.filter((row) => row.ours && row.mir === person.mir && !row.annulled)
  const ownByNumber = person.number == null ? [] : live(index.byMirNumber.get(`${person.mir}:${person.number}`))
  const otherParty = sameKey.filter((row) => !row.ours)
  const otherMir = sameKey.filter((row) => row.ours && row.mir !== person.mir && !row.annulled)
  const tasks: DerivedTask[] = []
  const result = (status: RikStatus, extra: Partial<PersonResult> = {}): PersonResult => ({
    ...base,
    status,
    entryId: null,
    otherMir: '',
    otherParty: '',
    detail: '',
    ...extra,
  })

  const exact = ownByNumber.find((row) => !row.annulled && row.nameKey === person.nameKey) ?? null
  const registered = exact ?? null

  if (person.withdrawn) {
    const published = registered ?? ownByName[0] ?? null
    if (published) {
      tasks.push(task(person, 'remove_person', 'withdrawn', `Отписан от нас, но е в регистъра на РИК ${person.mir}. Поискай РИК да го заличи.`))
      return { result: result('withdrawn_registered', { entryId: published.id }), tasks }
    }
    return { result: result('withdrawn'), tasks }
  }

  // Double registrations are a problem whatever the own РИК says.
  if (otherParty.length > 0) {
    const first = otherParty[0]!
    const where = `РИК ${first.mir} (${mirLabel(first.mir)})`
    tasks.push(
      task(person, 'remove_person', 'other_party', `Регистриран и за „${first.party}“ в ${where}. Махни го от нашите или нека оттегли другото.`),
    )
    return { result: result('other_party', { entryId: registered?.id ?? null, otherMir: first.mir, otherParty: first.party }), tasks }
  }

  if (registered) {
    const dateNote =
      registered.numberDate && person.issuedOn && registered.numberDate !== person.issuedOn
        ? `РИК е записал дата ${registered.numberDate}, пълномощното е от ${person.issuedOn}.`
        : ''
    return { result: result('registered', { entryId: registered.id, detail: dateNote }), tasks }
  }

  const health = sources.get(person.mir)
  if (!health || health.health === 'error' || health.health === 'unrecognised') {
    return { result: result('rik_unavailable', { detail: health?.lastError ?? '' }), tasks }
  }

  if (person.signedAt == null) {
    // Nothing went to the РИК yet; still flag a name we already see somewhere else.
    if (otherMir.length > 0) {
      const first = otherMir[0]!
      tasks.push(task(person, 'remove_person', 'other_rik', `Вече е регистриран от нас в РИК ${first.mir} (${mirLabel(first.mir)}). Махни го от едното място.`))
      return { result: result('elsewhere', { entryId: first.id, otherMir: first.mir }), tasks }
    }
    return { result: result('not_signed'), tasks }
  }

  // Our number in their РИК, under another name.
  const numberRow = ownByNumber.find((row) => !row.annulled) ?? null
  if (numberRow) {
    if (looksLikeSamePerson(numberRow.nameKey, person.nameKey)) {
      tasks.push(
        task(person, 'fix_data', 'name', `РИК е публикувал „${numberRow.name}“ под № ${person.number}. Поправи името (по лична карта) и подпишете ново пълномощно.`),
      )
      return { result: result('name_mismatch', { entryId: numberRow.id, detail: numberRow.name }), tasks }
    }
    tasks.push(task(person, 'call_rik', 'number_taken', `Под № ${person.number} РИК е публикувал друг човек („${numberRow.name}“).`))
    return { result: result('name_mismatch', { entryId: numberRow.id, detail: numberRow.name }), tasks }
  }

  // Their name in their РИК, under another number/date.
  if (ownByName.length > 0) {
    const row = ownByName[0]!
    tasks.push(
      task(person, 'call_rik', 'number', `РИК го е публикувал с „${row.name}“ и № „${row.number ?? '—'}${row.numberDate ? `/${row.numberDate}` : ''}“, а пълномощното е № ${person.number}/${person.issuedOn}.`),
    )
    return { result: result('number_mismatch', { entryId: row.id }), tasks }
  }

  const annulled = ownByNumber.find((row) => row.annulled) ?? null
  if (annulled) {
    tasks.push(
      task(person, 'call_rik', 'annulled', `№ ${person.number} е „Анулиран“ в РИК ${person.mir}. Разбери защо (член на СИК, имена различни от НБД „Население“, друга партия) и поправи или махни.`),
    )
    return { result: result('annulled', { entryId: annulled.id }), tasks }
  }

  if (otherMir.length > 0) {
    const first = otherMir[0]!
    tasks.push(task(person, 'remove_person', 'other_rik', `Регистриран от нас в РИК ${first.mir} (${mirLabel(first.mir)}), не в РИК ${person.mir}. Махни го от едното място.`))
    return { result: result('elsewhere', { entryId: first.id, otherMir: first.mir }), tasks }
  }

  if (hoursBetween(person.signedAt, now) >= STALE_AFTER_HOURS) {
    tasks.push(
      task(person, 'call_rik', 'not_published', `Подписаното пълномощно № ${person.number} е подадено преди повече от ${STALE_AFTER_HOURS} ч., а РИК ${person.mir} още не го е публикувал.`),
    )
    return { result: result('stale'), tasks }
  }
  return { result: result('pending'), tasks }
}

export function buildIndex(entries: RikEntryRow[]) {
  const byMirNumber = new Map<string, RikEntryRow[]>()
  const byKey = new Map<string, RikEntryRow[]>()
  for (const entry of entries) {
    if (entry.ours && entry.kind === 'representative' && entry.number != null) {
      const key = `${entry.mir}:${entry.number}`
      byMirNumber.set(key, [...(byMirNumber.get(key) ?? []), entry])
    }
    if (entry.nameKey) byKey.set(entry.nameKey, [...(byKey.get(entry.nameKey) ?? []), entry])
  }
  return { byMirNumber, byKey }
}

/** РИК-level tasks: a register that keeps failing or stops looking like a register. */
export function sourceTasks(sources: RikSourceHealth[], threshold: number): DerivedTask[] {
  return sources
    .filter((source) => (source.health === 'error' && source.failures >= threshold) || source.health === 'unrecognised')
    .map((source) => ({
      id: `rik:${source.mir}:check_rik`,
      personId: null,
      mir: source.mir,
      type: 'check_rik' as const,
      reason: source.health,
      detail: `Регистърът на РИК ${source.mir} (${mirLabel(source.mir)}) не се чете автоматично: ${source.lastError || 'страницата не прилича на регистър'}. Провери сайта ръчно.`,
    }))
}

export function matchAll(people: RikPerson[], entries: RikEntryRow[], sources: RikSourceHealth[], now: Date, threshold: number) {
  const index = buildIndex(entries)
  const health = new Map(sources.map((source) => [source.mir, source]))
  const results: PersonResult[] = []
  const tasks: DerivedTask[] = []
  for (const person of people) {
    const one = classifyPerson(person, index, health, now)
    results.push(one.result)
    tasks.push(...one.tasks)
  }
  tasks.push(...sourceTasks(sources, threshold))
  return { results, tasks }
}
