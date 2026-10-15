import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { normalizeSection } from './admin-csv'
import { SESSION_COOKIE, signupDatabase } from './db-core'
import { parseStaffRole, roleAllows } from './staff'
import {
  addressTownIds,
  assembleDirectory,
  readSectionPlaces,
  readTownRefs,
  sectionSpot,
  type RegionSource,
  type SectionSpot,
  type TownRef,
} from './section-where'

const API = 'https://api.tibroish.bg'
const HEADERS = { Accept: 'application/json', 'Accept-Language': 'bg-BG' }

let regionCache: RegionSource[] | null = null
const townCache = new Map<string, TownRef[]>()
const sectionCache = new Map<number, Array<{ id: string; place: string }>>()

export const adminSectionPlaces = createServerFn({ method: 'POST' })
  .validator((input: { codes?: string[]; townIds?: number[] }) => ({
    codes: [...new Set((input.codes ?? []).map((code) => normalizeSection(String(code))).filter((code) => /^\d{9}$/.test(code)))].slice(0, 200),
    townIds: [...new Set((input.townIds ?? []).filter((id) => Number.isInteger(id) && id > 0))].slice(0, 40),
  }))
  .handler(async ({ data }) => {
    const access = await gate()
    if (!access.ok) return access
    if (data.codes.length === 0) return { ok: true as const, places: {} as Record<string, SectionSpot> }
    const directory = await directoryFor(data.codes, data.townIds)
    const places: Record<string, SectionSpot> = {}
    for (const code of data.codes) places[code] = sectionSpot(code, directory)
    return { ok: true as const, places }
  })

async function directoryFor(codes: string[], townIds: number[]) {
  const regions = await loadRegions()
  const pairs = [...new Set(codes.flatMap((code) => {
    const mir = code.slice(0, 2)
    const municipality = code.slice(2, 4)
    return mir && municipality ? [`${mir}:${municipality}`] : []
  }))].slice(0, 40)
  const towns = (await pool(pairs, 6, loadTowns)).flat()
  const firstWave = townIds.slice(0, 40)
  const first = await pool(firstWave, 6, loadSections)
  const found = new Set(first.flat().map((section) => section.id.replace(/\D/g, '')))
  const extra = addressTownIds(codes, [], towns, found).filter((id) => !firstWave.includes(id))
  const second = await pool(extra, 6, loadSections)
  return assembleDirectory({ regions, towns, sections: [...first.flat(), ...second.flat()] })
}

async function loadRegions() {
  if (regionCache) return regionCache
  const payload = await getJson<RegionSource[]>('election_regions')
  if (!payload) return []
  regionCache = payload
  return payload
}

async function loadTowns(pair: string) {
  const cached = townCache.get(pair)
  if (cached) return cached
  const [mir, municipality] = pair.split(':')
  const payload = await getJson<unknown>(`towns?country=000&election_region=${mir}&municipality=${municipality}`)
  const refs = readTownRefs(mir, municipality, payload)
  if (payload) townCache.set(pair, refs)
  return refs
}

async function loadSections(townId: number) {
  const cached = sectionCache.get(townId)
  if (cached) return cached
  const payload = await getJson<unknown>(`sections?town=${townId}`)
  const places = readSectionPlaces(payload)
  if (payload) sectionCache.set(townId, places)
  return places
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${API}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(12_000) })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index] as T)
    }
  }
  if (items.length === 0) return results
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

async function gate() {
  const db = await signupDatabase()
  if (!db) return { ok: false as const, message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false as const, message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{ email: string; email_confirmed: number }>()
  if (!session?.email_confirmed) return { ok: false as const, message: 'Влез с потвърдения си имейл.' }
  const email = session.email.trim().toLowerCase()
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(email).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role || !roleAllows(role, 'view')) return { ok: false as const, message: 'Този имейл не е поканен в екипа.' }
  return { ok: true as const }
}
