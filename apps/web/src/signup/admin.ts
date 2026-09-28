import { createServerFn } from '@tanstack/react-start'
import { getCookie, getRequestUrl, setCookie } from '@tanstack/react-start/server'
import { campaignCsv, internalCsv, normalizeSection, parsePeopleCsv, parseTakenCsv, rosterWhere, type RosterFields, type RosterView } from './admin-csv'
import { clampLimit, clampPage, rosterOrder, searchClause } from './admin-search'
import { currentSearchEngine, isFtsError, useLikeSearch } from './db-search'
import { travelLabelOf } from './admin-assign'
import { NOTES_SQL, notesFromRow } from './admin-notes'
import { PERSON_SQL_BASE } from './admin-person-sql'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { deliverMail, importConfirmMail, staffInviteMail } from './mail'
import { emptyProfile, validEmail, type Profile } from './model'
import { signupColumns } from './record'
import { sessionCookieSecure } from './session-cookie'
import { keepsAnAdmin, parseStaffRole, permissionsFor, roleAllows, staffRoleLabel, type StaffAction, type StaffRole } from './staff'

// Server helpers stay in this file, next to createServerFn. A barrel re-export
// or a shared module that calls getCookie is loaded by the client and breaks /admin.

const VIEWS: RosterView[] = ['all', 'assigned', 'unassigned', 'draft', 'abroad', 'mir', 'calls']
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
  published_section: string
  egn?: string
  notes: string
  call_requested_at: string
  call_message: string
  radius: string
  travel_municipalities: string
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
    emailConfirmed: row.email_confirmed === 1,
    imported: row.imported === 1,
    draftSection: row.draft_section,
    publishedSection: row.published_section,
    egn: row.egn ?? '',
    ...notesFromRow(row),
    radius: row.radius ?? '',
    travelLabel: travelLabelOf(row.travel_municipalities ?? ''),
  }
}

const PERSON_SQL = `${PERSON_SQL_BASE}${NOTES_SQL},
  COALESCE(radius, '') AS radius,
  COALESCE(travel_municipalities, '[]') AS travel_municipalities`

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
  assigned: number
  unassigned: number
  calls: number
  staff: number
}

async function summaryOf(db: Database): Promise<AdminSummary> {
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN COALESCE(published_section, '') != '' THEN 1 ELSE 0 END), 0) AS assigned,
         COALESCE(SUM(CASE WHEN COALESCE(published_section, '') = '' AND COALESCE(withdrawn, 0) = 0 THEN 1 ELSE 0 END), 0) AS unassigned,
         COALESCE(SUM(CASE WHEN COALESCE(json_extract(payload, '$.callRequestedAt'), '') != '' AND COALESCE(withdrawn, 0) = 0 THEN 1 ELSE 0 END), 0) AS calls
       FROM signups`,
    )
    .first<{ total: number; assigned: number; unassigned: number; calls: number }>()
  const staff = await db.prepare('SELECT COUNT(*) AS n FROM staff').first<{ n: number }>()
  return {
    total: Number(row?.total ?? 0),
    assigned: Number(row?.assigned ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    calls: Number(row?.calls ?? 0),
    staff: Number(staff?.n ?? 0),
  }
}

function filtered(view: string, mir: string, q: string, mode: 'fts' | 'like') {
  const filter = rosterWhere(viewOf(view), mir)
  if ('error' in filter) return filter
  const search = searchClause(q, mode)
  return { clause: `(${filter.clause}) AND (${search.clause})`, binds: [...filter.binds, ...search.binds] }
}

async function queryPeople(db: Database, view: string, mir: string, q: string, limit: number, offset: number, withEgn: boolean, sort: string, dir: string) {
  const run = async (mode: 'fts' | 'like') => {
    const filter = filtered(view, mir, q, mode)
    if ('error' in filter) return filter
    const total = await bound(db, `SELECT COUNT(*) AS n FROM signups WHERE ${filter.clause}`, filter.binds).first<{ n: number }>()
    const rows = await selectPeople(db, filter.clause, filter.binds, limit, offset, withEgn, rosterOrder(sort, dir))
    return { total: Number(total?.n ?? 0), rows }
  }
  try {
    return await run(currentSearchEngine())
  } catch (error) {
    if (currentSearchEngine() === 'like' || !isFtsError(error)) throw error
    useLikeSearch()
    return await run('like')
  }
}

export const claimStaffSession = createServerFn({ method: 'POST' })
  .validator((input: { email: string }) => input)
  .handler(async ({ data }) => {
    const db = await signupDatabase()
    const email = data.email.trim().toLowerCase()
    if (!db) return { ok: false as const, message: 'Няма база за записванията.' }
    if (!validEmail(email)) return { ok: false as const, message: 'Имейлът не е валиден.' }
    const row = await db
      .prepare('SELECT session_token, email_confirmed FROM signups WHERE lower(email) = ?')
      .bind(email)
      .first<{ session_token: string | null; email_confirmed: number }>()
    if (!row?.email_confirmed || !row.session_token) return { ok: false as const, message: 'Няма потвърден профил с този имейл.' }
    const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
    if (!parseStaffRole(member?.role)) return { ok: false as const, message: 'Този имейл не е поканен в екипа.' }
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
  .validator((input: { view?: string; mir?: string; q?: string; page?: number; limit?: number; sort?: string; dir?: string }) => ({
    view: input.view ?? 'all',
    mir: input.mir ?? '',
    q: (input.q ?? '').slice(0, 120),
    page: clampPage(input.page),
    limit: clampLimit(input.limit),
    sort: input.sort ?? 'updated',
    dir: input.dir === 'asc' ? 'asc' : 'desc',
  }))
  .handler(async ({ data }) => {
    const access = await gate('view')
    if (!access.ok) return access
    const db = access.db
    const queried = await queryPeople(db, data.view, data.mir, data.q, data.limit, (data.page - 1) * data.limit, false, data.sort, data.dir)
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
      total: queried.total,
      page: data.page,
      limit: data.limit,
      people,
      taken: taken.results ?? [],
    }
  })

export const adminExport = createServerFn({ method: 'POST' })
  .validator((input: { view: string; mir: string; kind: string; q?: string }) => ({
    view: input.view,
    mir: input.mir,
    kind: input.kind,
    q: (input.q ?? '').slice(0, 120),
  }))
  .handler(async ({ data }) => {
    const access = await gate(data.kind === 'campaign' ? 'exportCampaign' : 'exportInternal')
    if (!access.ok) return access
    const db = access.db
    const people: RosterFields[] = []
    for (let offset = 0; people.length < 5000; offset += 400) {
      const chunk = await queryPeople(db, data.view, data.mir, data.q, 400, offset, data.kind !== 'campaign', 'updated', 'desc')
      if ('error' in chunk) return { ok: false as const, message: chunk.error }
      people.push(...chunk.rows.map(fieldsOf))
      if (chunk.rows.length < 400) break
    }
    const campaign = data.kind === 'campaign'
    const exported = campaign ? people.map((person) => ({ ...person, egn: '', draftSection: '' })) : people
    const csv = campaign ? campaignCsv(exported) : internalCsv(exported)
    const stamp = new Date().toISOString().slice(0, 10)
    return { ok: true as const, csv, filename: campaign ? `ti-broish-brevo-${stamp}.csv` : `ti-broish-ekip-${stamp}.csv` }
  })

export const adminDraft = createServerFn({ method: 'POST' })
  .validator((input: { id: string; section: string }) => input)
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const section = normalizeSection(data.section).slice(0, 32)
    await db.prepare(`UPDATE signups SET draft_section = NULLIF(?, ''), updated_at = ? WHERE id = ?`).bind(section, new Date().toISOString(), data.id).run()
    const taken = section
      ? await db.prepare('SELECT organisation FROM taken_sections WHERE section_code = ?').bind(section).first<{ organisation: string }>()
      : null
    return { ok: true as const, warning: taken ? `Секцията е заета от ${taken.organisation}.` : '' }
  })

export const adminPublish = createServerFn({ method: 'POST' })
  .validator((input: { view: string; mir: string }) => input)
  .handler(async ({ data }) => {
    const access = await gate('publish')
    if (!access.ok) return access
    const db = access.db
    const filter = rosterWhere(viewOf(data.view), data.mir)
    if ('error' in filter) return { ok: false as const, message: filter.error }
    const pending = `COALESCE(draft_section, '') != '' AND COALESCE(draft_section, '') != COALESCE(published_section, '')`
    const count = await bound(db, `SELECT COUNT(*) AS n FROM signups WHERE (${filter.clause}) AND ${pending}`, filter.binds).first<{ n: number }>()
    const now = new Date().toISOString()
    await bound(db, `UPDATE signups SET published_section = draft_section, published_at = ?, updated_at = ? WHERE (${filter.clause}) AND ${pending}`, [now, now, ...filter.binds]).run()
    return { ok: true as const, published: count?.n ?? 0 }
  })

export const adminImportTaken = createServerFn({ method: 'POST' })
  .validator((input: { csv: string }) => input)
  .handler(async ({ data }) => {
    if (data.csv.length > 500_000) return { ok: false as const, message: 'Файлът е твърде голям.' }
    const access = await gate('edit')
    if (!access.ok) return access
    const parsed = parseTakenCsv(data.csv)
    if (parsed.rows.length > 2000) return { ok: false as const, message: 'Най-много 2000 секции наведнъж.' }
    const db = access.db
    const now = new Date().toISOString()
    for (const row of parsed.rows) {
      await db
        .prepare(
          `INSERT INTO taken_sections (section_code, mir_code, place, organisation, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(section_code) DO UPDATE SET
             mir_code = excluded.mir_code, place = excluded.place, organisation = excluded.organisation, note = excluded.note`,
        )
        .bind(row.sectionCode, row.mirCode, row.place, row.organisation, row.note, now)
        .run()
    }
    return { ok: true as const, imported: parsed.rows.length, errors: parsed.errors.slice(0, 8) }
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
    const links: { email: string; link: string }[] = []
    let imported = 0
    let skipped = 0
    let mailed = 0
    const errors = [...parsed.errors]
    for (const person of parsed.rows) {
      try {
        const result = await importPerson(db, person)
        if (!result) {
          skipped += 1
          errors.push(`${person.email}: вече има запис.`)
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

async function importPerson(db: Database, person: { firstName: string; middleName: string; lastName: string; email: string; phone: string; mir: string; place: string; note: string; role: string }) {
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
  if (existing) {
    await db
      .prepare(
        `UPDATE signups SET payload = ?, confirm_token = ?, mir_code = COALESCE(NULLIF(?, ''), mir_code),
           section_place = COALESCE(NULLIF(?, ''), section_place), role = COALESCE(NULLIF(?, ''), role), notes = ?, updated_at = ?
         WHERE email = ? AND COALESCE(email_confirmed, 0) = 0 AND COALESCE(imported, 0) = 1`,
      )
      .bind(columns.payload, token, columns.mirCode, columns.sectionPlace, columns.role, columns.notes, now, person.email)
      .run()
    return { link }
  }
  await db
    .prepare(
      `INSERT INTO signups (
         id, email, session_token, referral_code, payload, email_confirmed, withdrawn, imported, confirm_token,
         mir_code, section_place, role, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      person.email,
      crypto.randomUUID(),
      referral,
      columns.payload,
      token,
      columns.mirCode,
      columns.sectionPlace,
      columns.role,
      columns.notes,
      now,
      now,
    )
    .run()
  return { link }
}

function columnsFor(
  current: string,
  person: { firstName: string; middleName: string; lastName: string; email: string; phone: string; mir: string; place: string; note: string; role: string },
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
  if (person.place) {
    profile.place = {
      regionCode: person.mir ? person.mir.padStart(2, '0') : (parsed.place?.regionCode ?? ''),
      regionName: parsed.place?.regionName ?? '',
      sectionPlace: person.place,
    }
  }
  return signupColumns(profile)
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
