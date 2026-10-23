// „Експорт И аз“ server function. Kept apart from partner-sections-admin.ts, which must import no
// Brevo module: this one only borrows the Brevo sync's place helpers to fill SECTION_TOWN/ADDRESS.
import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { PARTNER_EXPORT_SQL, partnerExportCode, partnerExportCsv, type ExportPlace, type PartnerExportRow } from './partner-export'
import { abroadLocation, isAbroadSection, loadAbroadPlaces } from './brevo-location'
import { abroadSectionAddress } from './abroad-section-addresses'
import { electionRegionNames, lookupSectionPlaces } from './section-places-lookup'
import { parseStaffRole, roleAllows, type StaffAction, type StaffRole } from './staff'

type Database = SignupD1
type Denial = { ok: false; state: 'signed-out' | 'unconfirmed' | 'forbidden' | 'nodb'; email: string; message: string }

/**
 * „Експорт И аз“ (admins only): every active „И аз“ person, live from D1, with the section's town and
 * address from the same sources as the Brevo sync (API for Bulgaria, abroad list + MFA for МИР 32).
 * No ЕГН. Read-only: nothing is written and nothing goes to Brevo or e-mail.
 */
export const adminPartnerExport = createServerFn({ method: 'POST' })
  .handler(async () => {
    const access = await gate('exportInternal')
    if (!access.ok) return access
    const db = access.db
    const rows = ((await db.prepare(PARTNER_EXPORT_SQL).all<PartnerExportRow>()).results ?? [])
    const codes = [...new Set(rows.map(partnerExportCode).filter(Boolean))]
    const domestic = codes.filter((code) => !isAbroadSection(code))
    const found = domestic.length > 0 ? await lookupSectionPlaces(domestic) : {}
    const abroad = await loadAbroadPlaces(db, codes)
    const places: Record<string, ExportPlace> = {}
    for (const code of codes) {
      if (isAbroadSection(code)) places[code] = { town: abroadLocation(abroad.get(code), {}, code), address: abroadSectionAddress(code) }
      else {
        const spot = found[code] ?? { address: '', area: '', town: '' }
        places[code] = { town: (spot.town ?? '').trim(), address: spot.address ?? '' }
      }
    }
    const mirNames = await electionRegionNames()
    const stamp = new Date().toISOString().slice(0, 10)
    return { ok: true as const, csv: partnerExportCsv(rows, places, mirNames), count: rows.length, filename: `iaz-brevo-export-${stamp}.csv` }
  })

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
