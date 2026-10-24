// „Секции с хора“ (admins only, the exportInternal right like „Експорт И аз“). Server only.
// Read-only: four SELECTs (people with a section, then priority and reservations for just those
// codes); addresses and voters come from the bundled CIK fixture, abroad from the MFA table.
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { mfaAbroadSection } from './abroad-section-addresses'
import { electionRegionNames } from './section-places-lookup'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'
import {
  parseCikSections,
  SECTIONS_PEOPLE_PARTNERS_SQL,
  SECTIONS_PEOPLE_PRIORITY_SQL,
  SECTIONS_PEOPLE_SIGNUPS_SQL,
  SECTIONS_PEOPLE_TAKEN_SQL,
  sectionsPeopleCodes,
  sectionsPeopleCsv,
  sectionsPeopleFilename,
  sectionsPeopleRows,
  type CikSection,
  type SectionsPeoplePartnerRow,
  type SectionsPeoplePriorityRow,
  type SectionsPeopleSignupRow,
} from './sections-people-export'

type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

let cikCache: { sections: Map<string, CikSection>; machines: Set<string> } | null = null

async function cikData() {
  if (cikCache) return cikCache
  const data = await import('./cik-sections.data')
  cikCache = {
    sections: parseCikSections(data.CIK_SECTIONS, data.CIK_MUNICIPALITIES),
    machines: new Set(data.CIK_ABROAD_MACHINE_SECTIONS.split(' ').filter(Boolean)),
  }
  return cikCache
}

async function mirNamesOrEmpty(): Promise<Record<string, string>> {
  try {
    return await electionRegionNames()
  } catch {
    return {}
  }
}

/** Gate, then build the file. */
export async function handleSectionsPeopleExport() {
  const access = await gate('exportInternal')
  if (!access.ok) return access
  const db = access.db
  const [signups, partners] = await Promise.all([
    db.prepare(SECTIONS_PEOPLE_SIGNUPS_SQL).all<SectionsPeopleSignupRow>(),
    db.prepare(SECTIONS_PEOPLE_PARTNERS_SQL).all<SectionsPeoplePartnerRow>(),
  ])
  const signupRows = signups.results ?? []
  const partnerRows = partners.results ?? []
  const codes = sectionsPeopleCodes(signupRows, partnerRows)
  const json = JSON.stringify(codes)
  const [priority, taken, cik, mirNames] = await Promise.all([
    codes.length ? db.prepare(SECTIONS_PEOPLE_PRIORITY_SQL).bind(json).all<SectionsPeoplePriorityRow>() : Promise.resolve({ results: [] }),
    codes.length ? db.prepare(SECTIONS_PEOPLE_TAKEN_SQL).bind(json).all<{ section_code: string; organisation: string }>() : Promise.resolve({ results: [] }),
    cikData(),
    mirNamesOrEmpty(),
  ])
  const rows = sectionsPeopleRows({
    signups: signupRows,
    partners: partnerRows,
    priority: (priority.results ?? []) as SectionsPeoplePriorityRow[],
    taken: (taken.results ?? []) as Array<{ section_code: string; organisation: string }>,
    cik: (code) => cik.sections.get(code),
    abroad: (code) => mfaAbroadSection(code),
    abroadMachine: cik.machines,
    mirNames,
  })
  const ours = rows.filter((row) => row[11] === 'Ти броиш').length
  return {
    ok: true as const,
    csv: sectionsPeopleCsv(rows),
    filename: sectionsPeopleFilename(),
    people: rows.length,
    ours,
    partners: rows.length - ours,
    sections: codes.length,
  }
}

async function gate(action: StaffAction): Promise<{ ok: true; db: SignupD1; email: string; role: StaffRole } | Denial> {
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
