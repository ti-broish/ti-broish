import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { SESSION_COOKIE, signupDatabase, type SignupD1 } from './db-core'
import { parseStaffRole, roleAllows, type StaffAction } from './staff'
import {
  buildCards,
  LEDGER_PEOPLE_SQL,
  NUMBER_LOOKUP_SQL,
  parseNumberQuery,
  peopleFrom,
  PERSON_LEDGER_SQL,
  REGISTER_BASES_SQL,
  REGISTER_FOR_NUMBER_SQL,
  registerUrlsFrom,
  sortHistory,
  type LedgerRow,
  type NumberCard,
  type RegisterRow,
} from './number-lookup'

type Denial = { ok: false; message: string }

async function gate(action: StaffAction): Promise<{ ok: true; db: SignupD1 } | Denial> {
  const db = await signupDatabase()
  if (!db) return { ok: false, message: 'Няма база за записванията.' }
  const token = getCookie(SESSION_COOKIE)
  if (!token) return { ok: false, message: 'Влез с потвърдения си имейл.' }
  const session = await db.prepare('SELECT email, email_confirmed FROM signups WHERE session_token = ?').bind(token).first<{ email: string; email_confirmed: number }>()
  if (!session || !session.email_confirmed) return { ok: false, message: 'Влез с потвърдения си имейл.' }
  const member = await db.prepare('SELECT role FROM staff WHERE email = ?').bind(session.email.trim().toLowerCase()).first<{ role: string }>()
  const role = parseStaffRole(member?.role)
  if (!role || !roleAllows(role, action)) return { ok: false, message: 'Тази роля няма това право.' }
  return { ok: true, db }
}

/** A missing table (fresh database before bootstrap / the first РИК sync) reads as empty. */
async function rows<T>(db: SignupD1, sql: string, ...binds: unknown[]): Promise<T[]> {
  try {
    return (await db.prepare(sql).bind(...binds).all<T>()).results ?? []
  } catch (error) {
    if (/no such table/i.test(String(error))) return []
    throw error
  }
}

async function cardsFor(db: SignupD1, ledger: LedgerRow[], register: RegisterRow[]) {
  const ids = [...new Set(ledger.map((row) => row.person_id).filter((id): id is string => !!id))]
  const people = ids.length ? peopleFrom(await rows(db, LEDGER_PEOPLE_SQL, JSON.stringify(ids))) : new Map()
  const urls = registerUrlsFrom(await rows(db, REGISTER_BASES_SQL))
  return buildCards(ledger, register, people, urls)
}

export type NumberLookupResult = { ok: true; query: { mir: string; number: number } | null; cards: NumberCard[] } | Denial

/** Search by number („23/514“ or „514“) for the admin people search. Read-only. */
export const adminNumberLookup = createServerFn({ method: 'POST' })
  .validator((input: { q: string }) => ({ q: String(input?.q ?? '').slice(0, 20) }))
  .handler(async ({ data }): Promise<NumberLookupResult> => {
    const query = parseNumberQuery(data.q)
    if (!query) return { ok: true, query: null, cards: [] }
    const access = await gate('view')
    if (!access.ok) return access
    const ledger = await rows<LedgerRow>(access.db, NUMBER_LOOKUP_SQL, query.number, query.mir)
    const register = await rows<RegisterRow>(access.db, REGISTER_FOR_NUMBER_SQL, query.number, query.mir)
    return { ok: true, query, cards: await cardsFor(access.db, ledger, register) }
  })

export type NumberHistoryResult = { ok: true; cards: NumberCard[] } | Denial

/** „История на номера“ for one person (signup or „И аз“), oldest first. Read-only. */
export const adminNumberHistory = createServerFn({ method: 'POST' })
  .validator((input: { personId: string }) => ({ personId: String(input?.personId ?? '').slice(0, 80) }))
  .handler(async ({ data }): Promise<NumberHistoryResult> => {
    const access = await gate('view')
    if (!access.ok) return access
    const ledger = sortHistory(await rows<LedgerRow>(access.db, PERSON_LEDGER_SQL, data.personId))
    const register: RegisterRow[] = []
    for (const row of ledger) register.push(...(await rows<RegisterRow>(access.db, REGISTER_FOR_NUMBER_SQL, row.number, row.mir)))
    return { ok: true, cards: await cardsFor(access.db, ledger, register) }
  })
