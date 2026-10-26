import type { SignupD1 } from './db-core'
import { isPlaceholderEmail } from './designation-section-sql'
import { emptyProfile, placeReady, validEmail, validName, validPhone, type HomePlace, type Profile } from './model'
import { signupColumns } from './record'
import { adultOnElectionDay, mirOf, UNDERAGE_REASON, validEgn } from './rules'
import type { StaffAction } from './staff'

// „Добави доброволец“ on Записвания: staff add a finished signup by hand (someone who cannot or will
// not go through /signup). It mirrors the SQL the team ran by hand on 22–24.10.2026: role section, both
// days, the home place (МИР), consent and submitted set, the e-mail confirmed, the receipt marked
// skipped, a staff note and one signup_audit line with the staff member as actor. It bypasses
// signupsClosed() and the e-mail code on purpose.
//
// No mail, Brevo or confirm-link code is imported here on purpose: nothing is sent, and nothing is
// synced. The search index follows through the signup_fts triggers (db-search.ts).

/** The same right as editing a person or importing people (adminImportPeople, adminUpdatePerson). */
export const ADD_VOLUNTEER_ACTION: StaffAction = 'edit'

/** Marks a record added from this form (the hand-run SQL used the same value). */
export const ADD_VOLUNTEER_SOURCE = 'admin-list'

export const PLACEHOLDER_DOMAIN = 'tibroish.invalid'

const NOTE_MAX = 1000
const PLACEHOLDER_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export interface AddVolunteerInput {
  firstName: string
  middleName: string
  lastName: string
  egn: string
  email: string
  phone: string
  note: string
  place: HomePlace | null
  /** Staff saw the „same names“ warning and still want to add the person. */
  allowNameMatch: boolean
}

export interface ExistingRecord {
  kind: 'signup' | 'partner'
  id: string
  name: string
}

export type AddVolunteerResult =
  | { ok: true; id: string; link: string; email: string; placeholder: boolean; mir: string; message: string }
  | { ok: false; reason: 'invalid'; message: string }
  | { ok: false; reason: 'duplicate'; message: string; existing: ExistingRecord & { link: string } }
  | { ok: false; reason: 'name-match'; message: string; matches: (ExistingRecord & { link: string })[] }

const clip = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

function clipPlace(value: unknown): HomePlace | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const text = (key: string) => {
    const item = clip(raw[key], 160)
    return item || undefined
  }
  const count = (key: string) => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? (raw[key] as number) : null)
  const regionCode = text('regionCode')
  if (!regionCode) return null
  const townId = Number(raw.townId)
  const place: HomePlace = {
    regionCode,
    regionName: text('regionName') ?? '',
    municipalityCode: text('municipalityCode'),
    municipalityName: text('municipalityName'),
    townId: Number.isInteger(townId) && townId > 0 ? townId : undefined,
    townName: text('townName'),
    cityRegionCode: text('cityRegionCode'),
    cityRegionName: text('cityRegionName'),
    sectionPlace: text('sectionPlace'),
    paperCount: count('paperCount'),
    machineCount: count('machineCount'),
    countryCode: text('countryCode'),
    countryName: text('countryName'),
  }
  for (const key of Object.keys(place) as (keyof HomePlace)[]) if (place[key] === undefined) delete place[key]
  return place
}

/** Server-side shape of the form: trimmed, clipped, ЕГН digits only, e-mail lower-case. */
export function parseAddVolunteerInput(input: unknown): AddVolunteerInput {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return {
    firstName: clip(raw.firstName, 80),
    middleName: clip(raw.middleName, 80),
    lastName: clip(raw.lastName, 80),
    egn: String(raw.egn ?? '').replace(/\D/g, '').slice(0, 10),
    email: clip(raw.email, 160).toLowerCase(),
    phone: clip(raw.phone, 40),
    note: clip(raw.note, NOTE_MAX),
    place: clipPlace(raw.place),
    allowNameMatch: raw.allowNameMatch === true,
  }
}

/** The МИР the person belongs to: from the home place, 32 abroad, null when the place does not give one (София без район). */
export function volunteerMir(place: HomePlace | null) {
  if (!place) return null
  if (place.regionCode === '32') return '32'
  return mirOf(place)
}

/** First problem with the form, in Bulgarian, or null. */
export function addVolunteerProblem(input: AddVolunteerInput): string | null {
  if (!validName(input.firstName) || !validName(input.middleName) || !validName(input.lastName)) {
    return 'Попълни трите имена на кирилица (име, презиме, фамилия).'
  }
  if (!/^\d{10}$/.test(input.egn)) return 'ЕГН трябва да е 10 цифри.'
  if (!validEgn(input.egn)) return 'ЕГН не е валидно.'
  if (!adultOnElectionDay(input.egn)) return `Човекът ${UNDERAGE_REASON}.`
  if (!input.place || !placeReady(input.place)) return 'Избери населеното място (област, община, населено място).'
  if (!volunteerMir(input.place)) return 'За София избери района, за да има МИР.'
  if (input.email && (!validEmail(input.email) || isPlaceholderEmail(input.email))) return 'Имейлът не е валиден. Остави го празен, ако няма.'
  if (input.phone && !validPhone(input.phone)) return 'Телефонът не е валиден. Остави го празен, ако няма.'
  return null
}

/** `bez-imeil-<8 random>@tibroish.invalid`: the stand-in address for a volunteer without an e-mail. */
export function placeholderEmail(random: (size: number) => Uint8Array = (size) => crypto.getRandomValues(new Uint8Array(size))) {
  const suffix = [...random(8)].map((byte) => PLACEHOLDER_ALPHABET[byte % PLACEHOLDER_ALPHABET.length]).join('')
  return `bez-imeil-${suffix}@${PLACEHOLDER_DOMAIN}`
}

export function recordLink(record: Pick<ExistingRecord, 'kind' | 'id'>) {
  return record.kind === 'partner' ? `/admin/iaz/${record.id}` : `/admin/signups/${record.id}`
}

const SIGNUP_NAME = `trim(COALESCE(json_extract(payload, '$.firstName'), '') || ' ' || COALESCE(json_extract(payload, '$.middleName'), '') || ' ' || COALESCE(json_extract(payload, '$.lastName'), ''))`
const PARTNER_NAME = `trim(first_name || ' ' || middle_name || ' ' || last_name)`
const EGN_KEY = (column: string) => `REPLACE(TRIM(COALESCE(${column}, '')), ' ', '')`

/** A record that already has this ЕГН (either table) or e-mail (either table). Withdrawn ones count too. */
export const ADD_VOLUNTEER_DUPLICATE_SQL = `SELECT kind, id, name, field FROM (
  SELECT 'signup' AS kind, id, ${SIGNUP_NAME} AS name, 'egn' AS field, 0 AS rank FROM signups WHERE ?1 != '' AND ${EGN_KEY('egn')} = ?1
  UNION ALL
  SELECT 'partner', id, ${PARTNER_NAME}, 'egn', 1 FROM partner_people WHERE ?1 != '' AND ${EGN_KEY('egn')} = ?1
  UNION ALL
  SELECT 'signup', id, ${SIGNUP_NAME}, 'email', 2 FROM signups WHERE ?2 != '' AND email = ?2
  UNION ALL
  SELECT 'partner', id, ${PARTNER_NAME}, 'email', 3 FROM partner_people WHERE ?2 != '' AND lower(trim(email)) = ?2
) ORDER BY rank LIMIT 1`

/** Exact same three names (either table): a warning, not a refusal. */
export const ADD_VOLUNTEER_NAME_SQL = `SELECT kind, id, name FROM (
  SELECT 'signup' AS kind, id, ${SIGNUP_NAME} AS name FROM signups
  WHERE trim(COALESCE(json_extract(payload, '$.firstName'), '')) = ?1
    AND trim(COALESCE(json_extract(payload, '$.middleName'), '')) = ?2
    AND trim(COALESCE(json_extract(payload, '$.lastName'), '')) = ?3
  UNION ALL
  SELECT 'partner', id, ${PARTNER_NAME} FROM partner_people
  WHERE trim(first_name) = ?1 AND trim(middle_name) = ?2 AND trim(last_name) = ?3
) LIMIT 5`

export const ADD_VOLUNTEER_INSERT_SQL = `INSERT INTO signups (
  id, email, session_token, referral_code, referred_by, source, egn, role,
  rounds_first, rounds_runoff, experience, region_code, mir_code, municipality_name, town_name,
  city_region_code, city_region_name, section_place, paper_count, machine_count, radius,
  extra_city_regions, distant_region_codes, travel_municipalities, has_car, car_seats, has_drone,
  coordinator, payload, email_confirmed, consent, submitted, withdrawn, notes, imported,
  signup_mail_at, staff_note, draft_locked, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'skipped', ?, 0, ?, ?)`

export const ADD_VOLUNTEER_AUDIT_SQL = `INSERT INTO signup_audit (id, signup_id, actor, field, before_text, after_text, created_at)
VALUES (?, ?, ?, 'staff_note', '', ?, ?)`

const REFERRAL_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function referralCode() {
  return [...crypto.getRandomValues(new Uint8Array(6))].map((byte) => REFERRAL_ALPHABET[byte % REFERRAL_ALPHABET.length]).join('')
}

function sofiaDate(at: Date) {
  return new Intl.DateTimeFormat('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Sofia' }).format(at).replace(/\s*г\.?$/, '')
}

/** The staff note on the record: the team's own note, then how and when the person was added. */
export function staffNoteFor(input: Pick<AddVolunteerInput, 'note' | 'phone'>, placeholder: boolean, at: Date) {
  const parts = [input.note.trim(), `Добавен от екипа в админа („Добави доброволец“) на ${sofiaDate(at)}.`]
  if (placeholder) parts.push('Няма имейл: адресът е заместител (@tibroish.invalid), не е истински.')
  if (!input.phone.trim()) parts.push('Няма телефон.')
  return parts.filter(Boolean).join(' ')
}

/** The finished profile, as /signup would have saved it. */
export function volunteerProfile(input: AddVolunteerInput, email: string, referral: string): Profile {
  return {
    ...emptyProfile(),
    firstName: input.firstName,
    middleName: input.middleName,
    lastName: input.lastName,
    email,
    phone: input.phone,
    emailConfirmed: true,
    egn: input.egn,
    role: 'section',
    mobileTeam: false,
    rounds: { first: true, runoff: true },
    place: input.place,
    radius: 'settlement',
    referralCode: referral,
    source: ADD_VOLUNTEER_SOURCE,
    consent: true,
    submitted: true,
  }
}

function duplicateMessage(field: string, existing: ExistingRecord) {
  const who = existing.name ? ` (${existing.name})` : ''
  const where = existing.kind === 'partner' ? 'човек от „И аз“' : 'записване'
  if (field === 'email') return `Вече има ${where} с този имейл${who}. Отвори го и го редактирай там.`
  return `Вече има ${where} с това ЕГН${who}. Не добавяме втори запис; отвори съществуващия.`
}

async function findDuplicate(db: SignupD1, egn: string, email: string) {
  return db.prepare(ADD_VOLUNTEER_DUPLICATE_SQL).bind(egn, email).first<ExistingRecord & { field: string }>()
}

/**
 * Creates the finished record (or refuses). The caller checks the staff role first; `actor` is the
 * staff e-mail that goes into the audit line. Sends nothing.
 */
export async function addStaffVolunteer(db: SignupD1, input: AddVolunteerInput, actor: string, at = new Date()): Promise<AddVolunteerResult> {
  const problem = addVolunteerProblem(input)
  if (problem) return { ok: false, reason: 'invalid', message: problem }
  const duplicate = await findDuplicate(db, input.egn, input.email)
  if (duplicate) {
    const existing = { kind: duplicate.kind, id: duplicate.id, name: duplicate.name ?? '' }
    return { ok: false, reason: 'duplicate', message: duplicateMessage(duplicate.field, existing), existing: { ...existing, link: recordLink(existing) } }
  }
  if (!input.allowNameMatch) {
    const found = await db.prepare(ADD_VOLUNTEER_NAME_SQL).bind(input.firstName, input.middleName, input.lastName).all<ExistingRecord>()
    const matches = (found.results ?? []).map((row) => ({ kind: row.kind, id: row.id, name: row.name ?? '', link: recordLink(row) }))
    if (matches.length) {
      return {
        ok: false,
        reason: 'name-match',
        message: 'Има запис със същите три имена, но с друго ЕГН. Провери дали не е същият човек. Ако е друг, добави го въпреки това.',
        matches,
      }
    }
  }
  const placeholder = !input.email
  let email = input.email
  if (placeholder) {
    email = placeholderEmail()
    for (let attempt = 0; attempt < 3 && (await findDuplicate(db, '', email)); attempt += 1) email = placeholderEmail()
  }
  const id = crypto.randomUUID()
  const now = at.toISOString()
  const referral = referralCode()
  const columns = signupColumns(volunteerProfile(input, email, referral))
  const mir = volunteerMir(input.place)!
  const staffNote = staffNoteFor(input, placeholder, at)
  try {
    await db.batch([
      db.prepare(ADD_VOLUNTEER_INSERT_SQL).bind(
        id,
        columns.email,
        crypto.randomUUID(),
        referral,
        null,
        columns.source,
        columns.egn,
        columns.role,
        columns.roundsFirst,
        columns.roundsRunoff,
        columns.experience,
        columns.regionCode,
        mir,
        columns.municipalityName,
        columns.townName,
        columns.cityRegionCode,
        columns.cityRegionName,
        columns.sectionPlace,
        columns.paperCount,
        columns.machineCount,
        columns.radius,
        columns.extraCityRegions,
        columns.distantRegionCodes,
        columns.travelMunicipalities,
        columns.hasCar,
        columns.carSeats,
        columns.hasDrone,
        columns.coordinator,
        columns.payload,
        columns.emailConfirmed,
        columns.consent,
        columns.submitted,
        columns.withdrawn,
        columns.notes,
        staffNote,
        now,
        now,
      ),
      db.prepare(ADD_VOLUNTEER_AUDIT_SQL).bind(crypto.randomUUID(), id, actor, staffNote, now),
    ])
  } catch (error) {
    // A parallel add with the same e-mail (UNIQUE) lands here.
    const again = await findDuplicate(db, input.egn, input.email)
    if (again) {
      const existing = { kind: again.kind, id: again.id, name: again.name ?? '' }
      return { ok: false, reason: 'duplicate', message: duplicateMessage(again.field, existing), existing: { ...existing, link: recordLink(existing) } }
    }
    console.warn('addStaffVolunteer', error instanceof Error ? error.message : error)
    return { ok: false, reason: 'invalid', message: 'Записът не можа да се създаде. Опитай пак.' }
  }
  return {
    ok: true,
    id,
    link: recordLink({ kind: 'signup', id }),
    email,
    placeholder,
    mir,
    message: `Добавен е като завършил записването (МИР ${mir}). Не е изпратено писмо. „Номерирай“ на Пълномощни ще му даде номер.`,
  }
}
