import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import {
  compareAbroadSections,
  parsePrioritySectionsCsv,
  summarizeCoverage,
  type AbroadPriorityRow,
  type AbroadTierLetter,
} from './abroad-coverage'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

export type AbroadCoverageFilters = {
  country?: string
  city?: string
  tier?: string
}

/** Replace-all upload of Yana's priority_sections.csv (counts only). */
export const adminImportAbroadCoverage = createServerFn({ method: 'POST' })
  .validator((input: { csv: string }) => input)
  .handler(async ({ data }) => {
    if (data.csv.length > 2_000_000) return { ok: false as const, message: 'Файлът е твърде голям.' }
    const access = await gate('edit')
    if (!access.ok) return access
    const parsed = parsePrioritySectionsCsv(data.csv)
    if (parsed.rows.length === 0) {
      return {
        ok: false as const,
        message: parsed.errors[0] ?? 'Няма валидни редове.',
        imported: 0,
        rejected: parsed.rejected,
        errors: parsed.errors.slice(0, 12),
      }
    }
    const db = access.db
    const now = new Date().toISOString()
    await db.prepare('DELETE FROM abroad_priority_sections').run()
    const insert = `INSERT INTO abroad_priority_sections (
             section_code, country, city, place_label, members, tier, tier_letter,
             ppdb_seats, da_seats, ppdb_seats_without_nominee, party_seats_allocated_in_file, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    const statements = parsed.rows.map((row) =>
      db.prepare(insert).bind(
        row.sectionCode,
        row.country,
        row.city,
        row.placeLabel,
        row.members,
        row.tier,
        row.tierLetter,
        row.ppdbSeats,
        row.daSeats,
        row.ppdbSeatsWithoutNominee,
        row.partySeatsAllocatedInFile,
        now,
      ),
    )
    for (let i = 0; i < statements.length; i += 50) {
      await db.batch(statements.slice(i, i + 50))
    }
    const summary = summarizeCoverage(parsed.rows)
    return {
      ok: true as const,
      imported: parsed.imported,
      rejected: parsed.rejected,
      errors: parsed.errors.slice(0, 12),
      summary,
      message: `Записани са ${parsed.imported} секции в чужбина${parsed.rejected ? `, отхвърлени ${parsed.rejected}` : ''}.`,
    }
  })

export const adminAbroadCoverage = createServerFn({ method: 'POST' })
  .validator((input: AbroadCoverageFilters) => input)
  .handler(async ({ data }) => {
    const access = await gate('view')
    if (!access.ok) return access
    const rows = await loadCoverage(access.db, data)
    const all = await loadCoverage(access.db, {})
    return {
      ok: true as const,
      rows,
      summary: summarizeCoverage(all),
      countries: uniqueSorted(all.map((row) => row.country)),
      cities: uniqueSorted(
        all.filter((row) => !data.country || row.country === data.country).map((row) => row.city),
      ),
    }
  })

async function loadCoverage(db: Database, filters: AbroadCoverageFilters): Promise<AbroadPriorityRow[]> {
  const clauses: string[] = []
  const binds: string[] = []
  if (filters.country?.trim()) {
    clauses.push('country = ?')
    binds.push(filters.country.trim())
  }
  if (filters.city?.trim()) {
    clauses.push('city = ?')
    binds.push(filters.city.trim())
  }
  if (filters.tier?.trim()) {
    const letter = filters.tier.trim().charAt(0).toUpperCase()
    if (letter === 'A' || letter === 'B' || letter === 'C' || letter === 'D') {
      clauses.push('tier_letter = ?')
      binds.push(letter)
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const result = await db
    .prepare(
      `SELECT section_code, country, city, place_label, members, tier, tier_letter,
              ppdb_seats, da_seats, ppdb_seats_without_nominee, party_seats_allocated_in_file
       FROM abroad_priority_sections ${where}`,
    )
    .bind(...binds)
    .all<{
      section_code: string
      country: string
      city: string
      place_label: string
      members: number
      tier: string
      tier_letter: string
      ppdb_seats: number
      da_seats: number
      ppdb_seats_without_nominee: number
      party_seats_allocated_in_file: number
    }>()
  const rows = (result.results ?? []).map((row) => ({
    sectionCode: row.section_code,
    country: row.country,
    city: row.city,
    placeLabel: row.place_label,
    members: Number(row.members) || 0,
    tier: row.tier,
    tierLetter: row.tier_letter as AbroadTierLetter,
    ppdbSeats: Number(row.ppdb_seats) || 0,
    daSeats: Number(row.da_seats) || 0,
    ppdbSeatsWithoutNominee: Number(row.ppdb_seats_without_nominee) || 0,
    partySeatsAllocatedInFile: Number(row.party_seats_allocated_in_file) || 0,
  }))
  rows.sort(compareAbroadSections)
  return rows
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'bg'))
}

async function gate(action: StaffAction): Promise<{ ok: true; db: Database; email: string; role: StaffRole } | Denial> {
  const db = await signupDatabase()
  if (!db) return { ok: false, state: 'nodb', email: '', message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const session = await db
    .prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?')
    .bind(token)
    .first<{ email: string; email_confirmed: number }>()
  if (!session) return { ok: false, state: 'signed-out', email: '', message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  if (!session.email_confirmed) return { ok: false, state: 'unconfirmed', email, message: 'Потвърди имейла, за да влезеш в екипа.' }
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role) return { ok: false, state: 'forbidden', email, message: 'Този имейл не е поканен в екипа.' }
  if (!roleAllows(role, action)) return { ok: false, state: 'forbidden', email, message: 'Тази роля няма това право.' }
  return { ok: true, db, email, role }
}
