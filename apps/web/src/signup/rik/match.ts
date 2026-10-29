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
import { editDistance, nameKey } from './normalize'

export type RikStatus =
  | 'registered' // published by the РИК of their МИР under our committee, name and number match
  | 'pending' // not published yet, still within STALE_AFTER_HOURS of submission
  | 'stale' // not published long after the signed пълномощно went out
  | 'not_signed' // has a number but no signed пълномощно yet: nothing to look for
  | 'name_mismatch' // our number is published under a differently written name
  | 'number_mismatch' // the name is published in their РИК under another number or date
  | 'annulled' // their row reads „Анулиран“
  | 'elsewhere' // published for us, but by another РИК
  | 'other_party' // their name is on another party's / committee's register
  | 'withdrawn_registered' // left us, still published
  | 'withdrawn' // left us, not published: nothing to do
  | 'duplicate' // same ЕГН keeps another number with us: never call the РИК for this one
  | 'rik_unavailable' // the РИК's register could not be read
  | 'renamed' // we changed the name after it went to the РИК: send a correction (old name still accepted)
  | 'taken_external' // our number is published for someone who is not ours: the number is taken, give a new one

export type RikTaskType = 'call_rik' | 'remove_person' | 'fix_data' | 'check_rik' | 'fix_name' | 'self_identity' | 'renumber' | 'possible_match'

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
  withdrawn_registered: 'За заличаване в РИК',
  withdrawn: 'Отписан',
  duplicate: 'Дубликат',
  rik_unavailable: 'РИК не се чете',
  renamed: 'Сменено име — подай поправка',
  taken_external: 'Номерът е зает външно',
}

export const TASK_LABELS: Record<RikTaskType, string> = {
  call_rik: 'Обади се на РИК',
  remove_person: 'Махни човека',
  fix_data: 'Поправи данните + ново пълномощно',
  check_rik: 'Провери РИК ръчно',
  fix_name: 'Поправи името в РИК',
  self_identity: 'Смяна име/ЕГН – нов документ',
  renumber: 'Нов номер (зает външно)',
  possible_match: 'Възможно съвпадение',
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
  /** Same ЕГН keeps another of our numbers: no „call the РИК“ task; if published, ask the РИК to annul it. */
  duplicate?: boolean
  /** When the signed пълномощно went to the РИК (first signed upload), ISO; null when not signed. */
  signedAt: string | null
  /**
   * Names the РИК may still have for this person: we renamed them after the пълномощно went to the
   * РИК (designation_renames.rik_correction). Until the register shows the new name the person reads
   * „renamed“ with a „fix_name“ task, and a row under any of these names counts as theirs.
   */
  previousNames?: string[]
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
  /** The register page the row was read from (optional: only the external-number step needs it). */
  sourceUrl?: string
}

export interface RikSourceHealth {
  mir: string
  /**
   * „warning“: the last run failed once; the last good read (lastGoodHealth) still counts.
   * „blocked“: the site answered with a challenge/403/429; its people are not re-derived at all.
   */
  health: 'ok' | 'empty' | 'not_published' | 'warning' | 'blocked' | 'error' | 'never' | 'unrecognised'
  failures: number
  lastError: string
  /** Health of the last successful read; '' when it never succeeded. */
  lastGoodHealth?: string
  /**
   * When our пълномощни actually went to this РИК (ISO, rik_sources.submitted_at); null when not set.
   * The „call the РИК“ clock starts at the later of this and the person's signedAt.
   */
  submittedAt?: string | null
}

const GOOD_HEALTH = new Set(['ok', 'empty', 'not_published'])

/**
 * The health to classify people by. A РИК in „warning“ (one failed run) keeps its last good
 * state, so one bad hour at CIK does not turn its people into „РИК не се чете“.
 */
export function effectiveHealth(source: RikSourceHealth | undefined): RikSourceHealth | undefined {
  if (!source || (source.health !== 'warning' && source.health !== 'blocked')) return source
  const good = source.lastGoodHealth ?? ''
  return { ...source, health: GOOD_HEALTH.has(good) ? (good as RikSourceHealth['health']) : 'error' }
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

/** Where the „not published“ clock starts: the later of the signed upload and the МИР's submission. */
export function clockStart(signedAt: string, submittedAt: string | null | undefined) {
  if (!submittedAt) return signedAt
  const signed = Date.parse(signedAt)
  const submitted = Date.parse(submittedAt)
  if (!Number.isFinite(submitted)) return signedAt
  return Number.isFinite(signed) && signed >= submitted ? signedAt : submittedAt
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

/** The person's name keys: the current one and any the РИК may still have (renamed). */
export function personKeys(person: RikPerson) {
  return [person.nameKey, ...(person.previousNames ?? []).map((name) => nameKey(name))].filter(Boolean)
}

export interface MatchIndex {
  byMirNumber: Map<string, RikEntryRow[]>
  byKey: Map<string, RikEntryRow[]>
  /** Our numbered people (incl. withdrawn) by every МИР they hold or held a number in. */
  peopleByMir: Map<string, RikPerson[]>
  /** Our numbered people by their current „МИР:number“. */
  holders: Map<string, RikPerson[]>
}

/**
 * Name first: which of our people a register row is about. A row belongs to one of ours when the
 * name looks like (≤ 3 edits) someone who holds or held a number in that МИР, whatever the number.
 * Nobody → the row is someone outside our database („външен“).
 */
export function ownersOf(row: RikEntryRow, index: MatchIndex) {
  if (!row.nameKey || row.annulled) return []
  return (index.peopleByMir.get(row.mir) ?? []).filter((person) => personKeys(person).some((key) => looksLikeSamePerson(key, row.nameKey)))
}

/** A row with the name of another of our active people who holds exactly that number: theirs, not this person's. */
function claimedByOther(row: RikEntryRow, person: RikPerson, index: MatchIndex) {
  if (row.number == null) return false
  return (index.holders.get(`${row.mir}:${row.number}`) ?? []).some(
    (other) => other.id !== person.id && !other.withdrawn && personKeys(other).some((key) => looksLikeSamePerson(key, row.nameKey)),
  )
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
  index: MatchIndex,
  sources: Map<string, RikSourceHealth>,
  now: Date,
): { result: PersonResult; tasks: DerivedTask[] } {
  const base = { personId: person.id, source: person.source, mir: person.mir, number: person.number }
  const live = (rows: RikEntryRow[] | undefined) => (rows ?? []).filter((row) => !row.missingSince && row.kind === 'representative')
  const oldKeys = (person.previousNames ?? []).map((name) => nameKey(name)).filter((key) => key && key !== person.nameKey)
  const sameKey = live([person.nameKey, ...oldKeys].flatMap((key) => index.byKey.get(key) ?? []))
  // A row under the same name but another number that another of our people holds (the same human
  // kept as a withdrawn „И аз“ duplicate, say) is theirs: it never counts for this person.
  const ownByName = sameKey.filter((row) => row.ours && row.mir === person.mir && !row.annulled && !claimedByOther(row, person, index))
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

  if (person.duplicate) {
    const published = registered ?? ownByName.find((row) => row.number === person.number) ?? null
    if (published) {
      tasks.push(
        task(person, 'remove_person', 'duplicate', `Дубликат: същото ЕГН има друг наш № в РИК ${person.mir}. Поискай РИК да анулира № ${person.number}.`),
      )
    }
    return { result: result('duplicate', { entryId: published?.id ?? null }), tasks }
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

  // Renamed after the РИК got the old name: one correction task until the register shows the new name.
  if (person.previousNames?.length) {
    const oldName = person.previousNames[0]!
    const published =
      ownByNumber.find((row) => !row.annulled && oldKeys.includes(row.nameKey)) ??
      ownByName.find((row) => oldKeys.includes(row.nameKey)) ??
      ownByNumber.find((row) => !row.annulled) ??
      null
    const where = published ? `РИК ${person.mir} го има като „${published.name}“` : `РИК ${person.mir} го е получил като „${oldName}“`
    tasks.push(
      task(person, 'fix_name', 'renamed', `Сменено име: ${where} под № ${person.number}. Подай поправка с новото име и новото подписано пълномощно.`),
    )
    return { result: result('renamed', { entryId: published?.id ?? null, detail: oldName }), tasks }
  }

  // Our number is published for someone who is none of ours (name first, not number first): the
  // number was issued outside our numbering. A new number is the fix, before anything is sent.
  const isMine = (row: RikEntryRow) => personKeys(person).some((key) => looksLikeSamePerson(key, row.nameKey))
  const takenRow = ownByNumber.find((row) => !row.annulled && !isMine(row) && ownersOf(row, index).length === 0) ?? null
  if (takenRow && !ownByNumber.some((row) => !row.annulled && isMine(row))) {
    const published = `${takenRow.number ?? person.number}${takenRow.numberDate ? `/${takenRow.numberDate}` : ''}`
    tasks.push(
      task(
        person,
        'renumber',
        'external',
        `№ ${person.mir}/${person.number} е зает външно в РИК ${person.mir}: регистърът го показва за „${takenRow.name}“ (№ ${published}), който не е от нашите. Дай нов номер и подпишете ново пълномощно.`,
      ),
    )
    return { result: result('taken_external', { entryId: takenRow.id, detail: takenRow.name }), tasks }
  }

  const health = effectiveHealth(sources.get(person.mir))
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

  // A РИК that has not published its register at all yet is not chased per person: that would be
  // one call per person for one fact. Only once the РИК publishes (any party) does „not there“ count.
  if (health.health !== 'ok') {
    return { result: result('pending', { detail: `РИК ${person.mir} още не е публикувал регистъра.` }), tasks }
  }
  if (hoursBetween(clockStart(person.signedAt, health.submittedAt), now) >= STALE_AFTER_HOURS) {
    tasks.push(
      task(person, 'call_rik', 'not_published', `Подписаното пълномощно № ${person.number} е подадено преди повече от ${STALE_AFTER_HOURS} ч., а РИК ${person.mir} още не го е публикувал.`),
    )
    return { result: result('stale'), tasks }
  }
  return { result: result('pending'), tasks }
}

/**
 * `ledgerMirs`: person id → every МИР they ever held a number in (designation_numbers), so a row in
 * the МИР they moved away from is still recognised as theirs.
 */
export function buildIndex(entries: RikEntryRow[], people: RikPerson[] = [], ledgerMirs: Map<string, Set<string>> = new Map()): MatchIndex {
  const byMirNumber = new Map<string, RikEntryRow[]>()
  const byKey = new Map<string, RikEntryRow[]>()
  for (const entry of entries) {
    if (entry.ours && entry.kind === 'representative' && entry.number != null) {
      const key = `${entry.mir}:${entry.number}`
      byMirNumber.set(key, [...(byMirNumber.get(key) ?? []), entry])
    }
    if (entry.nameKey) byKey.set(entry.nameKey, [...(byKey.get(entry.nameKey) ?? []), entry])
  }
  const peopleByMir = new Map<string, RikPerson[]>()
  const holders = new Map<string, RikPerson[]>()
  for (const person of people) {
    for (const mir of new Set([person.mir, ...(ledgerMirs.get(person.id) ?? [])])) peopleByMir.set(mir, [...(peopleByMir.get(mir) ?? []), person])
    if (person.number != null) {
      const key = `${person.mir}:${person.number}`
      holders.set(key, [...(holders.get(key) ?? []), person])
    }
  }
  return { byMirNumber, byKey, peopleByMir, holders }
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

export function matchAll(
  people: RikPerson[],
  entries: RikEntryRow[],
  sources: RikSourceHealth[],
  now: Date,
  threshold: number,
  options: { ledgerMirs?: Map<string, Set<string>>; everyone?: RikPerson[] } = {},
) {
  // `everyone`: all our numbered people for name matching, also those whose МИР is frozen this run.
  const index = buildIndex(entries, options.everyone ?? people, options.ledgerMirs)
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
