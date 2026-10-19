import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { normalizeSection } from './admin-csv'
import { scoreSectionSuggestions } from './admin-assign'
import { scoreAbroadSuggestions } from './abroad-distribute'
import type { AbroadTierLetter } from './abroad-coverage'
import { isSpecialBulgariaSection } from './stationary-sections'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows } from './staff'

type Database = SignupD1

export const adminSuggest = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const access = await gate('edit')
    if (!access.ok) return access
    const db = access.db
    const row = await db
      .prepare(
        `SELECT id, email, payload,
          COALESCE(mir_code, '') AS mir,
          COALESCE(region_code, '') AS region,
          COALESCE(town_name, '') AS town,
          COALESCE(municipality_name, '') AS municipality,
          COALESCE(section_place, '') AS place,
          COALESCE(radius, '') AS radius,
          COALESCE(travel_municipalities, '[]') AS travel_municipalities
         FROM signups WHERE id = ?`,
      )
      .bind(data.id)
      .first<{
        id: string
        email: string
        payload: string
        mir: string
        region: string
        town: string
        municipality: string
        place: string
        radius: string
        travel_municipalities: string
      }>()
    if (!row) return { ok: false as const, message: 'Няма такова записване.' }

    const place = placeFromPayload(row.payload)
    const abroad = row.region === '32' || row.mir === '32' || place.regionCode === '32'

    if (abroad) {
      return suggestAbroad(db, row, place)
    }

    const townId = place.townId
    if (!townId) {
      return {
        ok: true as const,
        suggestions: [],
        message: 'Няма избран град в записването, затова няма предложения.',
      }
    }

    let sections: Array<{ id: string; place: string }> = []
    try {
      sections = await loadPollingSections(townId, place.cityRegionCode)
    } catch {
      return { ok: false as const, message: 'Не можах да заредя секциите от API.' }
    }

    const blocked = await blockedSectionCodes(db, row.id)
    const suggestions = scoreSectionSuggestions(
      sections,
      {
        mir: row.mir,
        town: row.town,
        municipality: row.municipality,
        place: row.place,
        radius: row.radius,
        travelMunicipalities: row.travel_municipalities,
      },
      blocked,
      8,
    )
    return { ok: true as const, suggestions, message: suggestions.length ? '' : 'Няма свободни секции в този град.' }
  })

async function gate(action: 'edit') {
  const db = await signupDatabase()
  if (!db) return { ok: false as const, state: 'nodb' as const, email: '', message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false as const, state: 'signed-out' as const, email: '', message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{ email: string; email_confirmed: number }>()
  if (!session) return { ok: false as const, state: 'signed-out' as const, email: '', message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  if (!session.email_confirmed) return { ok: false as const, state: 'unconfirmed' as const, email, message: 'Потвърди имейла, за да влезеш в екипа.' }
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role) return { ok: false as const, state: 'forbidden' as const, email, message: 'Този имейл не е поканен в екипа.' }
  if (!roleAllows(role, action)) return { ok: false as const, state: 'forbidden' as const, email, message: 'Тази роля няма това право.' }
  return { ok: true as const, db, email, role }
}

async function blockedSectionCodes(db: Database, personId: string) {
  const blocked = new Set<string>()
  const taken = await db.prepare('SELECT section_code FROM taken_sections').all<{ section_code: string }>()
  for (const row of taken.results ?? []) blocked.add(normalizeSection(row.section_code))
  const used = await db
    .prepare(
      `SELECT COALESCE(draft_section, '') AS draft_section, COALESCE(published_section, '') AS published_section
       FROM signups WHERE id != ? AND COALESCE(withdrawn, 0) = 0`,
    )
    .bind(personId)
    .all<{ draft_section: string; published_section: string }>()
  for (const row of used.results ?? []) {
    if (row.draft_section) blocked.add(normalizeSection(row.draft_section))
    if (row.published_section) blocked.add(normalizeSection(row.published_section))
  }
  return blocked
}

async function loadPollingSections(townId: number, cityRegionCode?: string) {
  const API = 'https://api.tibroish.bg'
  const query = cityRegionCode
    ? `sections?town=${townId}&city_region=${encodeURIComponent(cityRegionCode)}`
    : `sections?town=${townId}`
  const response = await fetch(`${API}/${query}`, {
    headers: { Accept: 'application/json', 'Accept-Language': 'bg-BG' },
  })
  if (!response.ok) throw new Error(`sections ${response.status}`)
  const rows = (await response.json()) as Array<{
    id: string | number
    place: string
    votersCount?: number
    voters_count?: number
    isMachine?: boolean
    is_machine?: boolean
  }>
  return rows.flatMap((row) => {
    const id = String(row.id)
    if (isSpecialBulgariaSection(id)) return []
    return [{
      id,
      place: row.place ?? '',
      votersCount: typeof row.votersCount === 'number' ? row.votersCount : typeof row.voters_count === 'number' ? row.voters_count : null,
      isMachine: typeof row.isMachine === 'boolean' ? row.isMachine : typeof row.is_machine === 'boolean' ? row.is_machine : null,
    }]
  })
}

function placeFromPayload(payload: string): {
  townId?: number
  cityRegionCode?: string
  regionCode?: string
  countryName?: string
  townName?: string
  countryCode?: string
} {
  try {
    const parsed = JSON.parse(payload) as {
      place?: {
        townId?: number
        cityRegionCode?: string
        regionCode?: string
        countryName?: string
        townName?: string
        countryCode?: string
      }
    }
    return {
      townId: typeof parsed.place?.townId === 'number' ? parsed.place.townId : undefined,
      cityRegionCode: parsed.place?.cityRegionCode,
      regionCode: parsed.place?.regionCode,
      countryName: parsed.place?.countryName,
      townName: parsed.place?.townName,
      countryCode: parsed.place?.countryCode,
    }
  } catch {
    return {}
  }
}

async function suggestAbroad(
  db: Database,
  row: { id: string; town: string; place: string },
  place: { townId?: number; countryName?: string; townName?: string; countryCode?: string },
) {
  const city = (row.town || place.townName || '').trim()
  if (!city && !place.townId) {
    return {
      ok: true as const,
      suggestions: [],
      message: 'Няма избран град в записването, затова няма предложения.',
    }
  }

  const priority = await db
    .prepare(
      `SELECT section_code, country, city, place_label, tier_letter
       FROM abroad_priority_sections`,
    )
    .all<{ section_code: string; country: string; city: string; place_label: string; tier_letter: string }>()

  let sections = (priority.results ?? []).map((item) => ({
    id: normalizeSection(item.section_code),
    country: item.country,
    city: item.city,
    placeLabel: item.place_label,
    tierLetter: item.tier_letter as AbroadTierLetter,
    capacity: 1,
  }))

  if (sections.length === 0 && place.townId) {
    try {
      const polling = await loadPollingSections(place.townId)
      sections = polling.map((item) => ({
        id: normalizeSection(item.id),
        country: place.countryName ?? '',
        city,
        placeLabel: item.place,
        tierLetter: 'D' as AbroadTierLetter,
        capacity: 1,
      }))
    } catch {
      return { ok: false as const, message: 'Не можах да заредя секциите от API.' }
    }
  }

  const blocked = await blockedSectionCodes(db, row.id)
  const scored = scoreAbroadSuggestions(
    sections,
    { countryName: place.countryName ?? '', cityName: city },
    blocked,
    8,
  )
  const suggestions = scored.map((item) => ({
    id: item.id,
    place: `${item.city}${item.placeLabel ? ` · ${item.placeLabel}` : ''} · tier ${item.tierLetter}`,
    score: item.score,
    reason: item.reason,
    desk: 'unknown' as const,
  }))
  return {
    ok: true as const,
    suggestions,
    message: suggestions.length ? '' : 'Няма свободни секции за този град в чужбина.',
  }
}
