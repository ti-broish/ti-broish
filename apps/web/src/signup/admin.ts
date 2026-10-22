import { createServerFn } from '@tanstack/react-start'
import { SECTION_STATE_SQL, isSectionState, sectionCountsFrom, sectionCountsSql, type SectionState } from './section-state'
import { getCookie, getRequestUrl, setCookie } from '@tanstack/react-start/server'
import { brevoSectionsCsv, campaignCsv, distributionWhere, exportWithdrawnGuard, internalCsv, mirFromSection, normalizeSection, OPEN_CALL_SQL, parsePeopleCsv, rosterWhere, type BrevoSectionFields, type RosterFields, type RosterView } from './admin-csv'
import { validateSectionCodesExist } from './abroad-section-validate'
import { lookupSectionPlaces } from './section-places-lookup'
import { sectionPlaceOf } from './section-where'
import { abroadLocation, isAbroadSection, loadAbroadPlaces } from './brevo-location'
import { abroadSectionAddress } from './abroad-section-addresses'
import { CALLBACK_CHUNK, CALLBACK_FILTER_CAP, callbackIds, callbackMessage, callbackSetSql, chunkIds } from './admin-bulk'
import { SIGNUP_VIEWS, clampLimit, clampPage, rosterOrder, searchClause } from './admin-search'
import { parseWithdrawnProcessed, withdrawnProcessedClause, type WithdrawnProcessedFilter } from './admin-unregister'
import { withdrawnCounts } from './withdrawal'
import { currentSearchEngine, isFtsError, useLikeSearch } from './db-search'
import { travelLabelOf } from './admin-assign'
import { NOTES_SQL, notesFromRow } from './admin-notes'
import { PERSON_SQL_BASE } from './admin-person-sql'
import { reservedCode, reservedMessage } from './reserved-sections'
import { reservedMap } from './reserved-sections-db'
import {
  applyStaffEdit,
  buildAdminPerson,
  clipNamedPlaces,
  clipRegionCodes,
  clipStaffText,
  clipTravelStops,
  nextStaffCall,
  parseExperienceChoice,
  parseRadiusChoice,
  parseRoleChoice,
  sealStaffProfile,
  staffTravelText,
  staffWrite,
  type AdminPerson,
} from './admin-progress'
import { auditLines, staffAuditChanges, type AuditLine } from './admin-audit'
import { profileFrom, SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { confirmCodeMail, deliverMail, importConfirmMail, isDevMailHost, staffInviteMail } from './mail'
import { emptyProfile, validEmail, type Profile } from './model'
import { applyRenameTransition, namesChanged, renameMessage, type PersonNames } from './designation-rename'
import { signupColumns } from './record'
import { sessionCookieSecure } from './session-cookie'
import { keepsAnAdmin, parseStaffRole, permissionsFor, roleAllows, staffRoleLabel, type StaffAction, type StaffRole } from './staff'

// Server helpers stay in this file, next to createServerFn. A barrel re-export
// or a shared module that calls getCookie is loaded by the client and breaks /admin.

const VIEWS: RosterView[] = [...SIGNUP_VIEWS]
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

type Database = SignupD1

interface RawPerson {
  id: string
  email: string
  first_name: string
  middle_name: string
  last_name: string
  phone: string
  mir: string
  region: string
  town: string
  place: string
  role: string
  submitted: number
  withdrawn: number
  email_confirmed: number
  imported: number
  draft_section: string
  draft_locked: number
  published_section: string
  egn?: string
  notes: string
  call_requested_at: string
  call_message: string
  cant_reach_section: string
  cant_reach_at: string
  radius: string
  travel_municipalities: string
  region_name: string
  municipality_name: string
  city_region_name: string
  country_name: string
  town_id: number | string | null
  extra_city_regions: string
  distant_region_codes: string
  rounds_first: number
  rounds_runoff: number
  paper_count: number | null
  machine_count: number | null
  withdrawal_processed_at: string
  withdrawal_processed_by: string
  designation_mir?: string | null
  designation_number?: number | string | null
}

type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

async function gate(action: StaffAction): Promise<{ ok: true; db: Database; email: string; role: StaffRole } | Denial> {
  const db = await signupDatabase()
  if (!db) return { ok: false, state: 'nodb', email: '', message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{ email: string; email_confirmed: number }>()
  if (!session) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  if (!session.email_confirmed) return { ok: false, state: 'unconfirmed', email, message: 'Потвърди имейла, за да влезеш в екипа.' }
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role) return { ok: false, state: 'forbidden', email, message: 'Този имейл не е поканен в екипа.' }
  if (!roleAllows(role, action)) return { ok: false, state: 'forbidden', email, message: 'Тази роля няма това право.' }
  return { ok: true, db, email, role }
}

async function listStaff(db: Database) {
  const rows = await db
    .prepare(`SELECT email, role, COALESCE(invited_by, '') AS invited_by FROM staff ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, email`)
    .all<{ email: string; role: string; invited_by: string }>()
  return (rows.results ?? []).flatMap((row) => {
    const role = parseStaffRole(row.role)
    return role ? [{ email: row.email, role, invitedBy: row.invited_by }] : []
  })
}

async function adminCount(db: Database) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM staff WHERE role = 'admin'`).first<{ n: number }>()
  return row?.n ?? 0
}

function viewOf(value: string): RosterView {
  return VIEWS.includes(value as RosterView) ? (value as RosterView) : 'all'
}

function origin() {
  const url = getRequestUrl()
  return `${url.protocol}//${url.host}`
}

function referralCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('')
}

function secretToken() {
  return `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`
}

function sixDigit() {
  return String((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 1_000_000).padStart(6, '0')
}

function parsedJson(value: unknown) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return []
    }
  }
  return value ?? []
}

function asJsonText(value: unknown) {
  if (typeof value === 'string') return value
  if (value == null) return '[]'
  try {
    return JSON.stringify(value)
  } catch {
    return '[]'
  }
}

function townIdOf(value: number | string | null | undefined) {
  const id = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function fieldsOf(row: RawPerson): RosterFields {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    middleName: row.middle_name,
    lastName: row.last_name,
    phone: row.phone,
    mir: row.mir,
    region: row.region,
    town: row.town,
    place: row.place,
    role: row.role,
    submitted: row.submitted === 1,
    withdrawn: row.withdrawn === 1,
    withdrawalProcessedAt: row.withdrawal_processed_at ?? '',
    withdrawalProcessedBy: row.withdrawal_processed_by ?? '',
    emailConfirmed: row.email_confirmed === 1,
    imported: row.imported === 1,
    draftSection: row.draft_section,
    draftLocked: row.draft_locked === 1,
    publishedSection: row.published_section,
    egn: row.egn ?? '',
    ...notesFromRow(row),
    radius: row.radius ?? '',
    travelLabel: travelLabelOf(asJsonText(row.travel_municipalities), row.radius ?? ''),
    regionName: row.region_name ?? '',
    municipality: row.municipality_name ?? '',
    cityRegion: row.city_region_name ?? '',
    countryName: row.country_name ?? '',
    townId: townIdOf(row.town_id),
    extraCityRegions: clipNamedPlaces(parsedJson(row.extra_city_regions)),
    distantRegionCodes: clipRegionCodes(parsedJson(row.distant_region_codes)),
    travelMunicipalities: clipTravelStops(parsedJson(row.travel_municipalities)),
    roundsFirst: row.rounds_first === 1,
    roundsRunoff: row.rounds_runoff === 1,
    paperCount: typeof row.paper_count === 'number' ? row.paper_count : null,
    machineCount: typeof row.machine_count === 'number' ? row.machine_count : null,
    designationMir: row.designation_mir ?? '',
    designationNumber: row.designation_number == null || row.designation_number === '' ? '' : String(row.designation_number),
  }
}

const PERSON_SQL = `${PERSON_SQL_BASE}${NOTES_SQL},
  COALESCE(NULLIF(radius, ''), json_extract(payload, '$.radius'), '') AS radius,
  CASE
    WHEN COALESCE(travel_municipalities, '') NOT IN ('', '[]') THEN travel_municipalities
    ELSE COALESCE(json_extract(payload, '$.travelMunicipalities'), '[]')
  END AS travel_municipalities,
  COALESCE(json_extract(payload, '$.place.regionName'), '') AS region_name,
  COALESCE(NULLIF(municipality_name, ''), json_extract(payload, '$.place.municipalityName'), '') AS municipality_name,
  COALESCE(NULLIF(city_region_name, ''), json_extract(payload, '$.place.cityRegionName'), '') AS city_region_name,
  COALESCE(json_extract(payload, '$.place.countryName'), '') AS country_name,
  json_extract(payload, '$.place.townId') AS town_id,
  CASE
    WHEN COALESCE(extra_city_regions, '') NOT IN ('', '[]') THEN extra_city_regions
    ELSE COALESCE(json_extract(payload, '$.extraCityRegions'), '[]')
  END AS extra_city_regions,
  CASE
    WHEN COALESCE(distant_region_codes, '') NOT IN ('', '[]') THEN distant_region_codes
    ELSE COALESCE(json_extract(payload, '$.distantRegionCodes'), '[]')
  END AS distant_region_codes,
  CASE WHEN rounds_first = 1 OR json_extract(payload, '$.rounds.first') = 1 THEN 1 ELSE 0 END AS rounds_first,
  CASE WHEN rounds_runoff = 1 OR json_extract(payload, '$.rounds.runoff') = 1 THEN 1 ELSE 0 END AS rounds_runoff,
  paper_count,
  machine_count,
  COALESCE(withdrawal_processed_at, '') AS withdrawal_processed_at,
  COALESCE(withdrawal_processed_by, '') AS withdrawal_processed_by,
  COALESCE(designation_mir, '') AS designation_mir,
  designation_number`

function bound(db: Database, sql: string, binds: unknown[]) {
  const statement = db.prepare(sql)
  return binds.length > 0 ? statement.bind(...binds) : statement
}

async function selectPeople(db: Database, clause: string, binds: string[], limit: number, offset: number, withEgn: boolean, order: string) {
  const egn = withEgn ? ", COALESCE(egn, '') AS egn" : ''
  const result = await bound(
    db,
    `SELECT ${PERSON_SQL}${egn} FROM signups WHERE ${clause} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    binds,
  ).all<RawPerson>()
  return result.results ?? []
}

export interface AdminSummary {
  total: number
  finished: number
  started: number
  assigned: number
  unassigned: number
  calls: number
  queue: number
  staff: number
}

async function summaryOf(db: Database): Promise<AdminSummary> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN COALESCE(submitted, 0) = 1 AND COALESCE(withdrawn, 0) = 0 THEN 1 ELSE 0 END), 0) AS finished,
         COALESCE(SUM(CASE WHEN COALESCE(submitted, 0) = 0 AND COALESCE(withdrawn, 0) = 0 THEN 1 ELSE 0 END), 0) AS started,
         COALESCE(SUM(CASE WHEN COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0 THEN 1 ELSE 0 END), 0) AS assigned,
         COALESCE(SUM(CASE WHEN COALESCE(published_section, '') = '' AND COALESCE(withdrawn, 0) = 0 THEN 1 ELSE 0 END), 0) AS unassigned,
         COALESCE(SUM(CASE WHEN ${OPEN_CALL_SQL} THEN 1 ELSE 0 END), 0) AS calls,
         COALESCE(SUM(CASE WHEN ${OPEN_CALL_SQL} AND COALESCE(staff_called_at, '') = '' THEN 1 ELSE 0 END), 0) AS queue
       FROM signups`,
    )
    .first<{ total: number; finished: number; started: number; assigned: number; unassigned: number; calls: number; queue: number }>()
  const staff = await db.prepare('SELECT COUNT(*) AS n FROM staff').first<{ n: number }>()
  return {
    total: Number(row?.total ?? 0),
    finished: Number(row?.finished ?? 0),
    started: Number(row?.started ?? 0),
    assigned: Number(row?.assigned ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    calls: Number(row?.calls ?? 0),
    queue: Number(row?.queue ?? 0),
    staff: Number(staff?.n ?? 0),
  }
}

function filtered(
  view: string,
  mir: string,
  q: string,
  mode: 'fts' | 'like',
  finishedOnly: boolean,
  publishedOnly = false,
  exportKind?: 'brevo' | 'csv',
  processed?: WithdrawnProcessedFilter,
) {
  const filter = finishedOnly ? distributionWhere(viewOf(view), mir) : rosterWhere(viewOf(view), mir)
  if ('error' in filter) return filter
  const search = searchClause(q, mode)
  const published = publishedOnly
    ? ` AND COALESCE(published_section, '') != '' AND COALESCE(withdrawn, 0) = 0`
    : ''
  const exportGuard = exportKind ? exportWithdrawnGuard(viewOf(view), exportKind) : ''
  const processedGuard = withdrawnProcessedClause(viewOf(view), processed)
  return { clause: `(${filter.clause}) AND (${search.clause})${published}${exportGuard}${processedGuard}`, binds: [...filter.binds, ...search.binds] }
}

async function queryPeople(
  db: Database,
  view: string,
  mir: string,
  q: string,
  limit: number,
  offset: number,
  withEgn: boolean,
  sort: string,
  dir: string,
  finishedOnly = false,
  publishedOnly = false,
  exportKind?: 'brevo' | 'csv',
  sectionState?: SectionState | '',
  processed?: WithdrawnProcessedFilter,
) {
  const run = async (mode: 'fts' | 'like') => {
    const base = filtered(view, mir, q, mode, finishedOnly, publishedOnly, exportKind, processed)
    if ('error' in base) return base
    // Секции: counts per state over the same scope and search, then narrow to the picked state.
    const sectionCounts = sectionState === undefined
      ? undefined
      : sectionCountsFrom(await bound(db, sectionCountsSql(base.clause), base.binds).first<Record<string, unknown>>())
    const filter = sectionState ? { clause: `(${base.clause}) AND (${SECTION_STATE_SQL[sectionState]})`, binds: base.binds } : base
    const total = await bound(db, `SELECT COUNT(*) AS n FROM signups WHERE ${filter.clause}`, filter.binds).first<{ n: number }>()
    const rows = await selectPeople(db, filter.clause, filter.binds, limit, offset, withEgn, rosterOrder(sort, dir))
    return { total: Number(total?.n ?? 0), rows, sectionCounts }
  }
  try {
    return await run(currentSearchEngine())
  } catch (error) {
    if (currentSearchEngine() === 'like' || !isFtsError(error)) throw error
    useLikeSearch()
    return await run('like')
  }
}

/** A staff email is not proof of the mailbox. The code has to match before the session cookie is set. */
export const claimStaffSession = createServerFn({ method: 'POST' })
  .validator((input: { email: string; code?: string }) => input)
  .handler(async ({ data }) => {
    const db = await signupDatabase()
    const email = data.email.trim().toLowerCase()
    const code = (data.code ?? '').trim()
    if (!db) return { ok: false as const, message: 'Няма база за записванията.' }
    if (!validEmail(email)) return { ok: false as const, message: 'Имейлът не е валиден.' }
    const row = await db
      .prepare('SELECT session_token, email_confirmed, email_code FROM signups WHERE lower(email) = ?')
      .bind(email)
      .first<{ session_token: string | null; email_confirmed: number; email_code: string | null }>()
    if (!row?.email_confirmed || !row.session_token) return { ok: false as const, message: 'Няма потвърден профил с този имейл.' }
    const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
    if (!parseStaffRole(member?.role)) return { ok: false as const, message: 'Този имейл не е поканен в екипа.' }
    if (!code) {
      const next = sixDigit()
      const now = new Date().toISOString()
      await db.prepare('UPDATE signups SET email_code = ?, updated_at = ? WHERE lower(email) = ?').bind(next, now, email).run()
      const sent = await deliverMail(confirmCodeMail(email, next))
      if (!sent && !isDevMailHost()) {
        await db.prepare('UPDATE signups SET email_code = NULL WHERE lower(email) = ?').bind(email).run()
        return { ok: false as const, message: 'Писмото не тръгна. Опитай отново след малко.' }
      }
      return {
        ok: false as const,
        needsCode: true as const,
        previewCode: sent ? '' : next,
        message: 'Изпратихме шестцифрен код на този имейл.',
      }
    }
    if (!row.email_code || code !== row.email_code) return { ok: false as const, message: 'Кодът не съвпада.' }
    await db.prepare('UPDATE signups SET email_code = NULL, updated_at = ? WHERE lower(email) = ?').bind(new Date().toISOString(), email).run()
    setCookie(SESSION_COOKIE, row.session_token, {
      httpOnly: true,
      secure: sessionCookieSecure(new URL(getRequestUrl()).hostname),
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
    })
    return { ok: true as const }
  })

export const adminSession = createServerFn({ method: 'POST' })
  .validator(() => ({}))
  .handler(async () => {
    const access = await gate('view')
    if (!access.ok) return access
    return {
      ok: true as const,
      email: access.email,
      role: access.role,
      permissions: permissionsFor(access.role),
      staff: await listStaff(access.db),
      summary: await summaryOf(access.db),
    }
  })

export const adminRoster = createServerFn({ method: 'POST' })
  .validator((input: { view?: string; mir?: string; q?: string; page?: number; limit?: number; sort?: string; dir?: string; finished?: boolean; state?: string; processed?: string }) => ({
    state: input.state === undefined ? undefined : isSectionState(input.state) ? input.state : ('' as const),
    view: input.view ?? 'all',
    mir: input.mir ?? '',
    q: (input.q ?? '').slice(0, 120),
    page: clampPage(input.page),
    limit: clampLimit(input.limit),
    sort: input.sort ?? 'updated',
    dir: input.dir === 'asc' ? 'asc' : 'desc',
    finished: input.finished === true,
    processed: parseWithdrawnProcessed(input.processed),
  }))
  .handler(async ({ data }) => {
    const access = await gate('view')
    if (!access.ok) return access
    const db = access.db
    const queried = await queryPeople(
      db, data.view, data.mir, data.q, data.limit, (data.page - 1) * data.limit, false, data.sort, data.dir, data.finished, false, undefined, data.state, data.processed,
    )
    if ('error' in queried) return { ok: false as const, state: 'forbidden' as const, email: access.email, message: queried.error }
    const people = queried.rows.map(fieldsOf)
    const takenMir = viewOf(data.view) === 'mir' ? data.mir.trim().padStart(2, '0') : ''
    const taken = await db
      .prepare(
        `SELECT section_code, COALESCE(mir_code, '') AS mir_code, COALESCE(place, '') AS place, organisation, COALESCE(note, '') AS note
         FROM taken_sections WHERE (? = '' OR mir_code = ?) ORDER BY created_at DESC LIMIT 200`,
      )
      .bind(takenMir, takenMir)
      .all<{ section_code: string; mir_code: string; place: string; organisation: string; note: string }>()
    return {
      ok: true as const,
      email: access.email,
      role: access.role,
      permissions: permissionsFor(access.role),
      staff: await listStaff(db),
      summary: await summaryOf(db),
      withdrawnCounts: await withdrawnCounts(db),
      total: queried.total,
      sectionCounts: queried.sectionCounts,
      page: data.page,
      limit: data.limit,
      people,
      taken: taken.results ?? [],
    }
  })


export const adminBulkCallback = createServerFn({ method: 'POST' })
  .validator((input: { called?: boolean; scope?: string; ids?: unknown; view?: string; mir?: string; q?: string; processed?: string }) => {
    const picked = callbackIds(Array.isArray(input.ids) ? input.ids : [])
    return {
      called: input.called === true,
      scope: input.scope === 'filter' ? ('filter' as const) : ('ids' as const),
      ids: picked.ids,
      truncated: picked.truncated,
      view: typeof input.view === 'string' ? input.view : 'all',
      mir: typeof input.mir === 'string' ? input.mir.slice(0, 8) : '',
      q: typeof input.q === 'string' ? input.q.slice(0, 120) : '',
      processed: parseWithdrawnProcessed(input.processed),
    }
  })
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const pending = data.called ? "COALESCE(staff_called_at, '') = ''" : "COALESCE(staff_called_at, '') != ''"
    const collect = async (mode: 'fts' | 'like') => {
      if (data.scope === 'ids') {
        if (data.ids.length === 0) return { ids: [] as string[], capped: false }
        const marks = data.ids.map(() => '?').join(', ')
        const rows = await bound(access.db, `SELECT id FROM signups WHERE id IN (${marks}) AND ${pending}`, data.ids).all<{ id: string }>()
        return { ids: (rows.results ?? []).map((row) => row.id), capped: false }
      }
      const filter = filtered(data.view, data.mir, data.q, mode, false, false, undefined, data.processed)
      if ('error' in filter) return filter
      const rows = await bound(
        access.db,
        `SELECT id FROM signups WHERE (${filter.clause}) AND ${pending} ORDER BY updated_at DESC LIMIT ?`,
        [...filter.binds, CALLBACK_FILTER_CAP + 1],
      ).all<{ id: string }>()
      const found = (rows.results ?? []).map((row) => row.id)
      return { ids: found.slice(0, CALLBACK_FILTER_CAP), capped: found.length > CALLBACK_FILTER_CAP }
    }
    let targets: { ids: string[]; capped: boolean } | { error: string }
    try {
      targets = await collect(currentSearchEngine())
    } catch (error) {
      if (currentSearchEngine() === 'like' || !isFtsError(error)) throw error
      useLikeSearch()
      targets = await collect('like')
    }
    if ('error' in targets) return { ok: false as const, message: targets.error }
    const now = new Date().toISOString()
    const at = data.called ? now : ''
    const by = data.called ? access.email : ''
    for (const chunk of chunkIds(targets.ids, CALLBACK_CHUNK)) {
      await bound(access.db, callbackSetSql(data.called, chunk.length), [at, by, now, ...chunk]).run()
    }
    const message = callbackMessage(data.called, targets.ids.length, targets.capped)
    const limitNote = data.truncated ? ' Наведнъж минават до 200 избрани реда. За повече използвай целия изглед.' : ''
    return { ok: true as const, updated: targets.ids.length, capped: targets.capped, message: `${message}${limitNote}` }
  })

/** Load roster people + section places as BrevoSectionFields (shared by CSV, campaign, sync). */
export async function loadBrevoSectionFields(
  db: Database,
  input: { view: string; mir: string; q: string; publishedOnly: boolean; finishedOnly?: boolean; limit?: number },
): Promise<BrevoSectionFields[] | { error: string }> {
  const people: RosterFields[] = []
  const cap = input.limit ?? 5000
  for (let offset = 0; people.length < cap; offset += 400) {
    const chunk = await queryPeople(
      db,
      input.view,
      input.mir,
      input.q,
      Math.min(400, cap - people.length),
      offset,
      false,
      'updated',
      'desc',
      input.finishedOnly === true,
      input.publishedOnly,
      'brevo',
    )
    if ('error' in chunk) return { error: chunk.error }
    people.push(...chunk.rows.map(fieldsOf))
    if (chunk.rows.length < 400) break
  }
  const codes = [...new Set(people.map((person) => normalizeSection(person.publishedSection)).filter((code) => /^\d{9}$/.test(code)))]
  const townIdsByCode: Record<string, number[]> = {}
  for (const person of people) {
    const section = normalizeSection(person.publishedSection)
    if (!/^\d{9}$/.test(section) || !person.townId) continue
    const list = townIdsByCode[section] ?? []
    if (!list.includes(person.townId)) list.push(person.townId)
    townIdsByCode[section] = list
  }
  const places = await lookupSectionPlaces(codes.filter((code) => !isAbroadSection(code)), townIdsByCode)
  const abroad = await loadAbroadPlaces(db, codes)
  const links = await designationLinks(db, people.map((person) => person.id))
  return people.map((person) => {
    const section = normalizeSection(person.publishedSection)
    const spot = places[section] ?? { address: '', area: '', town: '' }
    const published = /^\d{9}$/.test(section)
    const sectionPlace = isAbroadSection(section) ? abroadLocation(abroad.get(section), {}, section) : sectionPlaceOf(spot)
    const sectionAddress = isAbroadSection(section) ? abroadSectionAddress(section) : spot.address
    return {
      email: person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      phone: person.phone,
      mir: person.mir || mirFromSection(section),
      publishedSection: section,
      sectionAddress,
      sectionPlace,
      role: person.role,
      sectionPublished: published,
      palnomoshtnoUrl: links.get(person.id) ?? '',
    }
  })
}

/**
 * Section fields for Brevo by signup id (same address/place lookup as the Секции sync),
 * so the пълномощно update can send them with DOCUMENT_URL.
 */
export async function loadBrevoSectionFieldsForIds(db: Database, ids: string[]) {
  const rows: Array<{
    id: string
    first_name: string
    last_name: string
    mir: string
    role: string
    published_section: string
    town_id: number | string | null
    town_name: string | null
    country_name: string | null
  }> = []
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90)
    if (chunk.length === 0) continue
    const found = await db
      .prepare(
        `SELECT id,
          COALESCE(json_extract(payload, '$.firstName'), '') AS first_name,
          COALESCE(json_extract(payload, '$.lastName'), '') AS last_name,
          COALESCE(mir_code, '') AS mir,
          COALESCE(role, '') AS role,
          COALESCE(published_section, '') AS published_section,
          json_extract(payload, '$.place.townId') AS town_id,
          COALESCE(NULLIF(town_name, ''), json_extract(payload, '$.place.townName'), '') AS town_name,
          COALESCE(json_extract(payload, '$.place.countryName'), '') AS country_name
        FROM signups WHERE id IN (${chunk.map(() => '?').join(', ')}) AND COALESCE(withdrawn, 0) = 0`,
      )
      .bind(...chunk)
      .all<(typeof rows)[number]>()
    rows.push(...(found.results ?? []))
  }
  const townIdsByCode: Record<string, number[]> = {}
  const codes = new Set<string>()
  for (const row of rows) {
    const section = normalizeSection(row.published_section ?? '')
    if (!/^\d{9}$/.test(section)) continue
    codes.add(section)
    const townId = townIdOf(row.town_id)
    if (!townId) continue
    const list = townIdsByCode[section] ?? []
    if (!list.includes(townId)) list.push(townId)
    townIdsByCode[section] = list
  }
  const domestic = [...codes].filter((code) => !isAbroadSection(code))
  const places = domestic.length > 0 ? await lookupSectionPlaces(domestic, townIdsByCode) : {}
  const abroad = await loadAbroadPlaces(db, [...codes])
  const out = new Map<
    string,
    { firstName: string; lastName: string; mir: string; publishedSection: string; sectionAddress: string; sectionPlace: string; location: string; role: string }
  >()
  for (const row of rows) {
    const section = normalizeSection(row.published_section ?? '')
    if (!/^\d{9}$/.test(section)) continue
    const spot = places[section] ?? { address: '', area: '', town: '' }
    const sectionPlace = isAbroadSection(section)
      ? abroadLocation(abroad.get(section), { townName: String(row.town_name ?? ''), countryName: String(row.country_name ?? '') }, section)
      : sectionPlaceOf(spot)
    out.set(row.id, {
      firstName: String(row.first_name ?? ''),
      lastName: String(row.last_name ?? ''),
      mir: String(row.mir ?? '') || mirFromSection(section),
      publishedSection: section,
      sectionAddress: isAbroadSection(section) ? abroadSectionAddress(section) : (spot.address ?? ''),
      sectionPlace,
      location: sectionPlace,
      role: String(row.role ?? ''),
    })
  }
  return out
}

/** Stored power of attorney links by signup id, in chunks under D1's bound-parameter limit. */
async function designationLinks(db: Database, ids: string[]) {
  const links = new Map<string, string>()
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90)
    if (chunk.length === 0) continue
    const rows = await db
      .prepare(`SELECT id, COALESCE(designation_pdf_url, '') AS url FROM signups WHERE id IN (${chunk.map(() => '?').join(', ')}) AND COALESCE(designation_pdf_url, '') != ''`)
      .bind(...chunk)
      .all<{ id: string; url: string }>()
    for (const row of rows.results ?? []) links.set(row.id, row.url)
  }
  return links
}

export const adminExport = createServerFn({ method: 'POST' })
  .validator((input: { view: string; mir: string; kind: string; q?: string; processed?: string }) => ({
    view: input.view,
    mir: input.mir,
    kind: input.kind === 'brevo-sections' || input.kind === 'campaign' || input.kind === 'internal' ? input.kind : 'campaign',
    q: (input.q ?? '').slice(0, 120),
    processed: parseWithdrawnProcessed(input.processed),
  }))
  .handler(async ({ data }) => {
    const sections = data.kind === 'brevo-sections'
    const campaign = data.kind === 'campaign'
    const access = await gate(campaign || sections ? 'exportCampaign' : 'exportInternal')
    if (!access.ok) return access
    const db = access.db
    const stamp = new Date().toISOString().slice(0, 10)
    if (sections) {
      const rows = await loadBrevoSectionFields(db, {
        view: data.view,
        mir: data.mir,
        q: data.q,
        publishedOnly: true,
      })
      if ('error' in rows) return { ok: false as const, message: rows.error }
      return { ok: true as const, csv: brevoSectionsCsv(rows), filename: `ti-broish-brevo-sekcii-${stamp}.csv` }
    }
    const people: RosterFields[] = []
    for (let offset = 0; people.length < 5000; offset += 400) {
      const chunk = await queryPeople(
        db,
        data.view,
        data.mir,
        data.q,
        400,
        offset,
        !campaign,
        'updated',
        'desc',
        false,
        false,
        'csv',
        undefined,
        data.processed,
      )
      if ('error' in chunk) return { ok: false as const, message: chunk.error }
      people.push(...chunk.rows.map(fieldsOf))
      if (chunk.rows.length < 400) break
    }
    const exported = campaign ? people.map((person) => ({ ...person, egn: '', draftSection: '' })) : people
    const csv = campaign ? campaignCsv(exported) : internalCsv(exported)
    return { ok: true as const, csv, filename: campaign ? `ti-broish-brevo-${stamp}.csv` : `ti-broish-ekip-${stamp}.csv` }
  })

export const adminImportPeople = createServerFn({ method: 'POST' })
  .validator((input: { csv: string }) => input)
  .handler(async ({ data }) => {
    if (data.csv.length > 500_000) return { ok: false as const, message: 'Файлът е твърде голям.' }
    const access = await gate('edit')
    if (!access.ok) return access
    const parsed = parsePeopleCsv(data.csv)
    if (parsed.rows.length > 500) return { ok: false as const, message: 'Най-много 500 души наведнъж.' }
    const db = access.db
    const sectionCheck = await validateSectionCodesExist(
      db,
      parsed.rows.map((row) => row.section).filter(Boolean),
    )
    const links: { email: string; link: string }[] = []
    let imported = 0
    let skipped = 0
    let mailed = 0
    const errors = [...parsed.errors]
    for (const code of sectionCheck.unknown) {
      errors.push(`Секция ${code} не е в данните за секции.`)
    }
    const reserved = await reservedMap(db)
    for (const person of parsed.rows) {
      if (person.section && !sectionCheck.valid.has(normalizeSection(person.section))) {
        skipped += 1
        continue
      }
      const reservedBy = person.section ? reserved.get(reservedCode(person.section)) : undefined
      if (reservedBy) {
        errors.push(`${person.email}: ${reservedMessage(reservedCode(person.section), reservedBy)}`)
        skipped += 1
        continue
      }
      try {
        const result = await importPerson(db, person)
        if (!result) {
          skipped += 1
          errors.push(`${person.email}: вече има записване.`)
          continue
        }
        imported += 1
        const sent = await deliverMail(importConfirmMail(person.email, result.link))
        if (sent) mailed += 1
        else if (links.length < 30) links.push({ email: person.email, link: result.link })
      } catch {
        skipped += 1
        errors.push(`${person.email}: не можа да се запише.`)
      }
    }
    return { ok: true as const, imported, skipped, mailed, links, errors: errors.slice(0, 8) }
  })

export const adminResendImports = createServerFn({ method: 'POST' })
  .validator((input: { limit: number }) => input)
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const limit = Math.min(100, Math.max(1, Math.floor(data.limit || 100)))
    const rows = await db
      .prepare(
        `SELECT email, confirm_token FROM signups
         WHERE COALESCE(imported, 0) = 1 AND COALESCE(email_confirmed, 0) = 0 AND COALESCE(confirm_token, '') != ''
         ORDER BY updated_at DESC LIMIT ${limit}`,
      )
      .all<{ email: string; confirm_token: string }>()
    let mailed = 0
    const links: { email: string; link: string }[] = []
    for (const row of rows.results ?? []) {
      const link = `${origin()}/potvardi?token=${row.confirm_token}`
      const sent = await deliverMail(importConfirmMail(row.email, link))
      if (sent) mailed += 1
      else if (links.length < 30) links.push({ email: row.email, link })
    }
    return { ok: true as const, mailed, pending: (rows.results ?? []).length, links }
  })

async function importPerson(
  db: Database,
  person: {
    firstName: string
    middleName: string
    lastName: string
    email: string
    phone: string
    mir: string
    place: string
    note: string
    role: string
    section: string
    country: string
    city: string
  },
) {
  const existing = await db
    .prepare('SELECT email_confirmed, imported, payload, referral_code FROM signups WHERE email = ?')
    .bind(person.email)
    .first<{ email_confirmed: number | null; imported: number | null; payload: string; referral_code: string | null }>()
  if (existing && (existing.email_confirmed === 1 || !existing.imported)) return null
  const token = secretToken()
  const now = new Date().toISOString()
  const referral = existing?.referral_code || referralCode()
  const columns = columnsFor(existing?.payload ?? '', person, referral)
  const link = `${origin()}/potvardi?token=${token}`
  const draftSection = normalizeSection(person.section).slice(0, 32)
  // Draft only — same columns as adminDraft; never publishes; never assignment mail.
  if (existing) {
    await db
      .prepare(
        `UPDATE signups SET payload = ?, confirm_token = ?, mir_code = COALESCE(NULLIF(?, ''), mir_code),
           region_code = COALESCE(NULLIF(?, ''), region_code),
           town_name = COALESCE(NULLIF(?, ''), town_name),
           section_place = COALESCE(NULLIF(?, ''), section_place), role = COALESCE(NULLIF(?, ''), role), notes = ?,
           draft_section = CASE WHEN ? != '' THEN ? ELSE draft_section END,
           draft_locked = CASE WHEN ? != '' THEN 1 ELSE draft_locked END,
           updated_at = ?
         WHERE email = ? AND COALESCE(email_confirmed, 0) = 0 AND COALESCE(imported, 0) = 1`,
      )
      .bind(
        columns.payload,
        token,
        columns.mirCode,
        columns.regionCode,
        columns.townName,
        columns.sectionPlace,
        columns.role,
        columns.notes,
        draftSection,
        draftSection,
        draftSection,
        now,
        person.email,
      )
      .run()
    return { link, draftSection }
  }
  await db
    .prepare(
      `INSERT INTO signups (
         id, email, session_token, referral_code, payload, email_confirmed, withdrawn, imported, confirm_token,
         mir_code, region_code, town_name, section_place, role, notes, draft_section, draft_locked, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      person.email,
      crypto.randomUUID(),
      referral,
      columns.payload,
      token,
      columns.mirCode,
      columns.regionCode,
      columns.townName,
      columns.sectionPlace,
      columns.role,
      columns.notes,
      draftSection,
      draftSection ? 1 : 0,
      now,
      now,
    )
    .run()
  return { link, draftSection }
}

function columnsFor(
  current: string,
  person: {
    firstName: string
    middleName: string
    lastName: string
    email: string
    phone: string
    mir: string
    place: string
    note: string
    role: string
    section: string
    country: string
    city: string
  },
  referral: string,
) {
  let parsed: Partial<Profile> = {}
  if (current) {
    try {
      parsed = JSON.parse(current) as Partial<Profile>
    } catch {
      parsed = {}
    }
  }
  const abroad = Boolean(person.country) || mirFromSection(person.section) === '32' || person.mir.padStart(2, '0') === '32'
  const regionCode = abroad ? '32' : person.mir ? person.mir.padStart(2, '0') : (parsed.place?.regionCode ?? '')
  const mirCode = abroad ? '32' : person.mir ? person.mir.padStart(2, '0') : null
  const profile = {
    ...emptyProfile(),
    ...parsed,
    firstName: person.firstName || parsed.firstName || '',
    middleName: person.middleName || parsed.middleName || '',
    lastName: person.lastName || parsed.lastName || '',
    email: person.email,
    phone: person.phone || parsed.phone || '',
    notes: person.note || parsed.notes || '',
    referralCode: referral,
    egn: '',
    assignedSection: null,
    role: person.role === 'mobile' || person.role === 'section' ? person.role : (parsed.role ?? null),
  }
  delete (profile as Profile & { draftSection?: unknown }).draftSection
  if (person.place || person.country || person.city || abroad) {
    profile.place = {
      regionCode: regionCode || (parsed.place?.regionCode ?? ''),
      regionName: abroad ? 'Извън страната' : (parsed.place?.regionName ?? ''),
      townName: person.city || parsed.place?.townName || '',
      sectionPlace: person.place || person.city || parsed.place?.sectionPlace || '',
      countryName: person.country || parsed.place?.countryName || '',
      countryCode: parsed.place?.countryCode,
    }
  }
  const columns = signupColumns(profile)
  // mirOf() is null for region 32; Чужбина import still stores mir_code=32.
  if (abroad) return { ...columns, regionCode: '32', mirCode: '32', townName: person.city || columns.townName }
  if (mirCode) return { ...columns, mirCode }
  return columns
}

export const adminInvite = createServerFn({ method: 'POST' })
  .validator((input: { email: string; role: string }) => input)
  .handler(async ({ data }) => {
    const access = await gate('invite')
    if (!access.ok) return access
    const email = data.email.trim().toLowerCase()
    const role = parseStaffRole(data.role)
    if (!validEmail(email) || !role) return { ok: false as const, message: 'Нужни са валиден имейл и роля.' }
    const current = await access.db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
    const currentRole = parseStaffRole(current?.role)
    if (currentRole && !keepsAnAdmin(await adminCount(access.db), currentRole, role)) {
      return { ok: false as const, message: 'Трябва да остане поне един админ.' }
    }
    const now = new Date().toISOString()
    await access.db
      .prepare(
        `INSERT INTO staff (email, role, invited_by, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by`,
      )
      .bind(email, role, access.email, now)
      .run()
    const sent = await deliverMail(staffInviteMail(email, staffRoleLabel(role), `${origin()}/admin`))
    return { ok: true as const, sent, message: sent ? `Поканата е изпратена на ${email}.` : `${email} е в екипа. Писмото още не тръгва, кажи им да влязат с този имейл.` }
  })

export const adminStaffRole = createServerFn({ method: 'POST' })
  .validator((input: { email: string; role: string }) => input)
  .handler(async ({ data }) => {
    const access = await gate('invite')
    if (!access.ok) return access
    const email = data.email.trim().toLowerCase()
    const role = parseStaffRole(data.role)
    if (!role) return { ok: false as const, message: 'Непозната роля.' }
    const current = await access.db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
    const currentRole = parseStaffRole(current?.role)
    if (!currentRole) return { ok: false as const, message: 'Този имейл не е в екипа.' }
    if (!keepsAnAdmin(await adminCount(access.db), currentRole, role)) return { ok: false as const, message: 'Трябва да остане поне един админ.' }
    await access.db.prepare('UPDATE staff SET role = ?, invited_by = ? WHERE email = ?').bind(role, access.email, email).run()
    return { ok: true as const, message: `${email} вече е ${staffRoleLabel(role)}.` }
  })

export const adminStaffRemove = createServerFn({ method: 'POST' })
  .validator((input: { email: string }) => input)
  .handler(async ({ data }) => {
    const access = await gate('invite')
    if (!access.ok) return access
    const email = data.email.trim().toLowerCase()
    const current = await access.db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
    const currentRole = parseStaffRole(current?.role)
    if (!currentRole) return { ok: false as const, message: 'Този имейл не е в екипа.' }
    if (!keepsAnAdmin(await adminCount(access.db), currentRole, null)) return { ok: false as const, message: 'Трябва да остане поне един админ.' }
    await access.db.prepare('DELETE FROM staff WHERE email = ?').bind(email).run()
    return { ok: true as const, message: `${email} вече не е в екипа.` }
  })

interface StoredPersonRow {
  id: string
  email: string
  payload: string
  referral_code: string | null
  referred_by: string | null
  source: string | null
  egn: string | null
  published_section: string | null
  submitted: number
  withdrawn: number
  withdrawn_at: string
  withdrawn_by: string
  withdrawn_reason: string
  withdrawn_note: string
  withdrawal_processed_at: string
  withdrawal_processed_by: string
  email_confirmed: number
  imported: number
  draft_section: string
  notes: string
  staff_note: string
  staff_called_at: string
  staff_called_by: string
  rounds_first: number | null
  rounds_runoff: number | null
  role: string
  experience: string
  town_name: string
  section_place: string
  radius: string
  designation_number: number | string | null
  designation_issued_at: string | null
  designation_pdf_url: string | null
}

const PERSON_DETAIL_SQL = `SELECT id, email, payload,
  referral_code, referred_by, source, egn, published_section,
  COALESCE(submitted, 0) AS submitted,
  COALESCE(withdrawn, 0) AS withdrawn,
  COALESCE(withdrawn_at, '') AS withdrawn_at,
  COALESCE(withdrawn_by, '') AS withdrawn_by,
  COALESCE(withdrawn_reason, '') AS withdrawn_reason,
  COALESCE(withdrawn_note, '') AS withdrawn_note,
  COALESCE(withdrawal_processed_at, '') AS withdrawal_processed_at,
  COALESCE(withdrawal_processed_by, '') AS withdrawal_processed_by,
  COALESCE(email_confirmed, 0) AS email_confirmed,
  COALESCE(imported, 0) AS imported,
  COALESCE(draft_section, '') AS draft_section,
  COALESCE(notes, '') AS notes,
  COALESCE(staff_note, '') AS staff_note,
  COALESCE(staff_called_at, '') AS staff_called_at,
  COALESCE(staff_called_by, '') AS staff_called_by,
  rounds_first,
  rounds_runoff,
  COALESCE(role, '') AS role,
  COALESCE(experience, '') AS experience,
  COALESCE(town_name, '') AS town_name,
  COALESCE(section_place, '') AS section_place,
  COALESCE(radius, '') AS radius,
  designation_number,
  COALESCE(designation_issued_at, '') AS designation_issued_at,
  COALESCE(designation_pdf_url, '') AS designation_pdf_url
FROM signups WHERE id = ?`

function personIdOk(id: string) {
  return /^[\w-]{1,80}$/.test(id)
}

function openedPerson(row: StoredPersonRow, previousSection = ''): AdminPerson {
  const profile = profileFrom({
    id: row.id,
    payload: row.payload,
    referral_code: row.referral_code,
    referred_by: row.referred_by,
    source: row.source,
    egn: row.egn,
    published_section: row.published_section,
  })
  const sealed = sealStaffProfile(profile, row.payload, {
    email: row.email,
    submitted: row.submitted === 1,
    withdrawn: row.withdrawn === 1,
    emailConfirmed: row.email_confirmed === 1,
    notes: row.notes,
    role: row.role,
    experience: row.experience,
    roundsFirst: row.rounds_first,
    roundsRunoff: row.rounds_runoff,
  })
  return buildAdminPerson(sealed, personExtra(row, row.staff_note, row.staff_called_at, row.staff_called_by, previousSection))
}

function personExtra(
  row: StoredPersonRow,
  staffNote: string,
  staffCalledAt: string,
  staffCalledBy: string,
  previousSection = '',
) {
  return {
    id: row.id,
    town: row.town_name,
    place: row.section_place,
    radius: row.radius,
    imported: row.imported === 1,
    draftSection: row.draft_section,
    publishedSection: row.published_section ?? '',
    hasEgn: Boolean(row.egn?.replace(/\D/g, '')),
    staffNote,
    staffCalledAt,
    staffCalledBy,
    designationNumber: row.designation_number == null || row.designation_number === '' ? '' : String(row.designation_number),
    designationIssuedAt: row.designation_issued_at ?? '',
    designationPdfUrl: row.designation_pdf_url ?? '',
    withdrawnAt: row.withdrawn_at ?? '',
    withdrawnBy: row.withdrawn_by ?? '',
    withdrawnReason: row.withdrawn_reason ?? '',
    withdrawnNote: row.withdrawn_note ?? '',
    withdrawalProcessedAt: row.withdrawal_processed_at ?? '',
    withdrawalProcessedBy: row.withdrawal_processed_by ?? '',
    previousSection,
  }
}

async function loadStoredPerson(db: Database, id: string) {
  if (!personIdOk(id)) return null
  return db.prepare(PERSON_DETAIL_SQL).bind(id).first<StoredPersonRow>()
}

async function loadAudit(db: Database, signupId: string): Promise<AuditLine[]> {
  const rows = await db
    .prepare(
      `SELECT id, actor, field, before_text, after_text, created_at
       FROM signup_audit WHERE signup_id = ? ORDER BY created_at DESC, id DESC LIMIT 30`,
    )
    .bind(signupId)
    .all<{ id: string; actor: string; field: string; before_text: string; after_text: string; created_at: string }>()
  return auditLines(rows.results ?? [])
}

async function previousSectionFromAudit(db: Database, signupId: string) {
  const row = await db
    .prepare(
      `SELECT after_text FROM signup_audit
       WHERE signup_id = ? AND field = 'withdrawn'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .bind(signupId)
    .first<{ after_text: string }>()
  if (!row?.after_text) return ''
  const published = row.after_text.match(/освободена публикувана\s+([A-Z0-9]+)/i)
  if (published?.[1]) return published[1]
  const draft = row.after_text.match(/освободена чернова\s+([A-Z0-9]+)/i)
  return draft?.[1] ?? ''
}

export const adminPerson = createServerFn({ method: 'POST' })
  .validator((input: { id?: string }) => ({ id: clipStaffText(input.id ?? '', 80) }))
  .handler(async ({ data }) => {
    const access = await gate('view')
    if (!access.ok) return access
    const row = await loadStoredPerson(access.db, data.id)
    if (!row) return { ok: false as const, message: 'Няма такъв човек.' }
    try {
      const previousSection = row.withdrawn === 1 ? await previousSectionFromAudit(access.db, row.id) : ''
      return { ok: true as const, person: openedPerson(row, previousSection), changes: await loadAudit(access.db, row.id) }
    } catch {
      return { ok: false as const, message: 'Този запис не се чете.' }
    }
  })

export const adminUpdatePerson = createServerFn({ method: 'POST' })
  .validator((input: {
    id?: string
    firstName?: string
    middleName?: string
    lastName?: string
    phone?: string
    role?: string
    roundsFirst?: boolean
    roundsRunoff?: boolean
    experience?: string
    called?: boolean
    staffNote?: string
    radius?: string
    extraCityRegions?: unknown
    distantRegionCodes?: unknown
    travelMunicipalities?: unknown
  }) => ({
    id: clipStaffText(input.id ?? '', 80),
    firstName: clipStaffText(input.firstName ?? '', 80),
    middleName: clipStaffText(input.middleName ?? '', 80),
    lastName: clipStaffText(input.lastName ?? '', 80),
    phone: clipStaffText(input.phone ?? '', 40),
    role: clipStaffText(input.role ?? '', 20),
    roundsFirst: input.roundsFirst === true,
    roundsRunoff: input.roundsRunoff === true,
    experience: clipStaffText(input.experience ?? '', 20),
    called: input.called === true,
    staffNote: clipStaffText(input.staffNote ?? '', 4000),
    radius: clipStaffText(input.radius ?? '', 20),
    extraCityRegions: clipNamedPlaces(input.extraCityRegions),
    distantRegionCodes: clipRegionCodes(input.distantRegionCodes),
    travelMunicipalities: clipTravelStops(input.travelMunicipalities),
  }))
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const row = await loadStoredPerson(access.db, data.id)
    if (!row) return { ok: false as const, message: 'Няма такъв човек.' }
    let edited
    let beforeNote = ''
    let beforeRole: ReturnType<typeof parseRoleChoice> = null
    let beforeFirst = false
    let beforeRunoff = false
    let beforeTravel = ''
    let beforeNames: PersonNames = { firstName: '', middleName: '', lastName: '' }
    try {
      const profile = profileFrom({
        id: row.id,
        payload: row.payload,
        referral_code: row.referral_code,
        referred_by: row.referred_by,
        source: row.source,
        egn: row.egn,
        published_section: row.published_section,
      })
      const sealed = sealStaffProfile(profile, row.payload, {
        email: row.email,
        submitted: row.submitted === 1,
        withdrawn: row.withdrawn === 1,
        emailConfirmed: row.email_confirmed === 1,
        notes: row.notes,
        role: row.role,
        experience: row.experience,
        roundsFirst: row.rounds_first,
        roundsRunoff: row.rounds_runoff,
      })
      beforeNote = row.staff_note
      beforeRole = sealed.role
      beforeFirst = sealed.rounds.first
      beforeRunoff = sealed.rounds.runoff
      beforeTravel = staffTravelText(sealed)
      beforeNames = { firstName: sealed.firstName, middleName: sealed.middleName, lastName: sealed.lastName }
      const radius = parseRadiusChoice(data.radius, sealed.place)
      edited = applyStaffEdit(sealed, {
        firstName: data.firstName,
        middleName: data.middleName,
        lastName: data.lastName,
        phone: data.phone,
        role: parseRoleChoice(data.role),
        roundsFirst: data.roundsFirst,
        roundsRunoff: data.roundsRunoff,
        experience: parseExperienceChoice(data.experience),
        ...(radius
          ? {
              radius,
              extraCityRegions: data.extraCityRegions,
              distantRegionCodes: data.distantRegionCodes,
              travelMunicipalities: data.travelMunicipalities,
            }
          : {}),
      })
    } catch {
      return { ok: false as const, message: 'Този запис не се чете.' }
    }
    const now = new Date().toISOString()
    const call = nextStaffCall({ at: row.staff_called_at, by: row.staff_called_by }, data.called, access.email, now)
    const write = staffWrite(edited, call, data.staffNote)
    await access.db
      .prepare(
        `UPDATE signups SET
           role = ?, rounds_first = ?, rounds_runoff = ?, experience = ?,
           radius = ?, extra_city_regions = ?, distant_region_codes = ?, travel_municipalities = ?,
           payload = ?, notes = ?, staff_note = ?, staff_called_at = ?, staff_called_by = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        write.role,
        write.roundsFirst,
        write.roundsRunoff,
        write.experience,
        write.radius,
        write.extraCityRegions,
        write.distantRegionCodes,
        write.travelMunicipalities,
        write.payload,
        write.notes,
        write.staffNote,
        write.staffCalledAt,
        write.staffCalledBy,
        now,
        row.id,
      )
      .run()
    // A new name on an existing пълномощно: same number, sign again, and a РИК correction if it went out.
    const afterNames = { firstName: edited.firstName, middleName: edited.middleName, lastName: edited.lastName }
    const renamed = namesChanged(beforeNames, afterNames)
      ? await applyRenameTransition(access.db, { table: 'signups', id: row.id, before: beforeNames, after: afterNames, actor: access.email, now })
      : null
    const audited = staffAuditChanges(
      { role: beforeRole, roundsFirst: beforeFirst, roundsRunoff: beforeRunoff, staffNote: beforeNote, travel: beforeTravel },
      { role: edited.role, roundsFirst: edited.rounds.first, roundsRunoff: edited.rounds.runoff, staffNote: write.staffNote, travel: staffTravelText(edited) },
    )
    for (const change of audited) {
      await access.db
        .prepare(
          `INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), row.id, access.email, change.field, change.before, change.after, now)
        .run()
    }
    return {
      ok: true as const,
      changes: await loadAudit(access.db, row.id),
      person: buildAdminPerson(edited, personExtra(row, write.staffNote, write.staffCalledAt, write.staffCalledBy)),
      ...(renamed?.resign ? { message: renameMessage(renamed, renamed.number, renamed.mir).trim() } : {}),
    }
  })
