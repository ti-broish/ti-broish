import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auditLines, describeAudit } from './admin-audit'
import { EGN_REVEAL_FIELD, canRevealEgn, egnLast4, egnRevealPath, maskEgn, sameOriginReveal } from './egn-reveal'
import { permissionsFor } from './staff'

const cookie = { value: '' as string | undefined }
vi.mock('cloudflare:workers', () => ({ env: {} }))
vi.mock('@tanstack/react-start/server', () => ({ getCookie: () => cookie.value }))

// Synthetic test number with a valid check digit; not a real person.
const TEST_EGN = '8103045115'

type Staff = { email: string; role: string }
const fake = {
  sessions: new Map<string, { email: string; email_confirmed: number }>(),
  staff: new Map<string, Staff>(),
  signups: new Map<string, { id: string; egn: string | null }>(),
  partners: new Map<string, { id: string; egn: string }>(),
  audit: [] as unknown[][],
  auditFails: false,
}

function fakeDb() {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes('WHERE session_token')) return fake.sessions.get(String(args[0])) ?? null
              if (sql.includes('FROM staff')) return fake.staff.get(String(args[0])) ?? null
              if (sql.includes('FROM partner_people')) return fake.partners.get(String(args[0])) ?? null
              if (sql.includes('FROM signups')) return fake.signups.get(String(args[0])) ?? null
              throw new Error(`unexpected ${sql}`)
            },
            async run() {
              if (!sql.startsWith('INSERT INTO signup_audit')) throw new Error(`unexpected ${sql}`)
              if (fake.auditFails) throw new Error('D1 down')
              fake.audit.push(args)
              return { success: true }
            },
          }
        },
      }
    },
  }
}

vi.mock('./db-core', () => ({ SESSION_COOKIE: 'tb_session', signupDatabase: async () => fakeDb() }))

function post(personId: string, headers: Record<string, string> = { origin: 'https://tibroish.bg', 'sec-fetch-site': 'same-origin' }) {
  return new Request(`https://tibroish.bg${egnRevealPath(personId)}`, { method: 'POST', headers })
}

async function reveal(personId: string, headers?: Record<string, string>) {
  const { serveEgnReveal } = await import('./egn-reveal-admin')
  return serveEgnReveal(post(personId, headers), personId)
}

function signInAs(role: string | null, email = `${role ?? 'none'}@example.com`) {
  cookie.value = `s-${email}`
  fake.sessions.set(cookie.value, { email, email_confirmed: 1 })
  if (role) fake.staff.set(email, { email, role })
}

describe('„Покажи ЕГН“ permission (pure)', () => {
  it('is for admins only', () => {
    expect(canRevealEgn('admin')).toBe(true)
    expect(canRevealEgn('editor')).toBe(false)
    expect(canRevealEgn('viewer')).toBe(false)
    expect(canRevealEgn(null)).toBe(false)
    expect(permissionsFor('admin').revealEgn).toBe(true)
    expect(permissionsFor('editor').revealEgn).toBe(false)
  })

  it('masks to the last four digits', () => {
    expect(egnLast4(` ${TEST_EGN} `)).toBe('5115')
    expect(egnLast4('')).toBe('')
    expect(egnLast4(null)).toBe('')
    expect(maskEgn('5115')).toBe('••••••5115')
    expect(maskEgn('')).toBe('')
    expect(maskEgn(TEST_EGN)).toBe('')
  })

  it('accepts only same-origin requests', () => {
    const h = (values: Record<string, string>) => new Headers(values)
    const url = 'https://tibroish.bg/admin/signups/x/egn'
    expect(sameOriginReveal(h({ origin: 'https://tibroish.bg' }), url)).toBe(true)
    expect(sameOriginReveal(h({ origin: 'https://tibroish.bg', 'sec-fetch-site': 'same-origin' }), url)).toBe(true)
    expect(sameOriginReveal(h({ origin: 'https://evil.example' }), url)).toBe(false)
    expect(sameOriginReveal(h({ origin: 'https://tibroish.bg', 'sec-fetch-site': 'cross-site' }), url)).toBe(false)
    expect(sameOriginReveal(h({}), url)).toBe(false)
    expect(sameOriginReveal(h({ origin: 'null' }), url)).toBe(false)
  })

  it('shows a reveal in the history without the number', () => {
    const [line] = auditLines([{ id: 'a', actor: 'admin@example.com', field: EGN_REVEAL_FIELD, before_text: '', after_text: 'показано на екрана', created_at: '2026-10-21T09:00:00.000Z' }])
    expect(line?.field).toBe('egn_revealed')
    expect(describeAudit('egn_revealed', '', 'показано на екрана')).toBe('ЕГН: показано на екрана')
  })
})

describe('POST /admin/signups/:id/egn', () => {
  beforeEach(() => {
    fake.sessions.clear()
    fake.staff.clear()
    fake.signups.clear()
    fake.partners.clear()
    fake.audit = []
    fake.auditFails = false
    cookie.value = undefined
    fake.signups.set('s-1', { id: 's-1', egn: TEST_EGN })
    fake.signups.set('s-none', { id: 's-none', egn: null })
    fake.partners.set('pp-1', { id: 'pp-1', egn: TEST_EGN })
  })

  it('gives an admin the number, audits who and when, and is never cached', async () => {
    signInAs('admin')
    const response = await reveal('s-1')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const body = (await response.json()) as { ok: boolean; egn: string; audit: { actor: string; field: string; before: string; after: string } }
    expect(body.ok).toBe(true)
    expect(body.egn).toBe(TEST_EGN)
    expect(body.audit).toMatchObject({ actor: 'admin@example.com', field: 'egn_revealed' })
    expect(fake.audit).toHaveLength(1)
    const [, signupId, actor, field, before, after] = fake.audit[0]!
    expect([signupId, actor, field]).toEqual(['s-1', 'admin@example.com', 'egn_revealed'])
    expect(`${before}${after}`).not.toContain(TEST_EGN)
  })

  it('works for „И аз“ partner people too', async () => {
    signInAs('admin')
    const response = await reveal('pp-1')
    expect(response.status).toBe(200)
    expect(((await response.json()) as { egn: string }).egn).toBe(TEST_EGN)
    expect(fake.audit[0]?.[1]).toBe('pp-1')
  })

  it.each(['editor', 'viewer'])('refuses a %s with 403 and writes nothing', async (role) => {
    signInAs(role)
    const response = await reveal('s-1')
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.text()).not.toContain(TEST_EGN)
    expect(fake.audit).toHaveLength(0)
  })

  it('refuses someone outside the team (403) and a signed-out request (401)', async () => {
    signInAs(null, 'volunteer@example.com')
    expect((await reveal('s-1')).status).toBe(403)
    cookie.value = undefined
    expect((await reveal('s-1')).status).toBe(401)
    expect(fake.audit).toHaveLength(0)
  })

  it('refuses a cross-site request even from an admin', async () => {
    signInAs('admin')
    const response = await reveal('s-1', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })
    expect(response.status).toBe(403)
    expect(fake.audit).toHaveLength(0)
  })

  it('answers 404 for no person or no ЕГН, and shows nothing when the audit fails', async () => {
    signInAs('admin')
    expect((await reveal('missing')).status).toBe(404)
    expect((await reveal('s-none')).status).toBe(404)
    expect((await reveal('bad id!')).status).toBe(404)
    fake.auditFails = true
    const failed = await reveal('s-1')
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toContain(TEST_EGN)
  })
})
