import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

const SECTION = '162200155'
const SELF = { id: 'e2e-selfw', email: 'selfw.one-e2e@example.com', session: 'e2e-selfw-session' }
const NEXT = { id: 'e2e-selfw-next', email: 'selfw.next-e2e@example.com', session: 'e2e-selfw-next-session' }
const ADMIN = { id: 'e2e-selfw-admin', email: 'selfw.admin-e2e@example.com', session: 'e2e-selfw-admin-session' }

function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

test.describe('self-withdraw on /profil frees the section', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test.afterAll(() => {
    wranglerLocal([
      '--command',
      `DELETE FROM signup_audit WHERE signup_id IN ('${SELF.id}', '${NEXT.id}');
       DELETE FROM signups WHERE id IN ('${SELF.id}', '${NEXT.id}', '${ADMIN.id}');
       DELETE FROM staff WHERE email = '${ADMIN.email}';`,
    ])
  })

  test('„Оттегли записването“ frees the seat with audit, the seat is assignable again, and „Върни“ does not bring it back', async ({ page, browser }) => {
    test.setTimeout(90_000)
    await signIn(page, SELF.session)
    await page.goto('/profil')
    await expect(page.getByRole('heading', { name: SECTION })).toBeVisible({ timeout: 30_000 })
    // One read after the save answers: polling the local SQLite through wrangler would lock it for the other worker.
    const withdrawSaved = savedWith(page, 'saveSignup')
    await page.getByRole('button', { name: 'Оттегли записването' }).click()
    await expect(page.getByRole('heading', { name: 'Записването е оттеглено' })).toBeVisible()
    await expect(page.getByText('Мястото се освобождава.')).toBeVisible()
    await withdrawSaved
    const [row] = d1(
      `SELECT withdrawn, withdrawn_at, withdrawn_reason, draft_section, published_section, published_at, draft_locked, designation_number,
              json_extract(payload, '$.withdrawnByAdmin') AS by_admin FROM signups WHERE id = '${SELF.id}'`,
    )
    expect(row).toMatchObject({ withdrawn: 1, withdrawn_reason: 'self', draft_section: null, published_section: null, published_at: null, draft_locked: 0, designation_number: 777, by_admin: 0 })
    expect(String(row!.withdrawn_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const audit = d1(`SELECT actor, field, before_text, after_text FROM signup_audit WHERE signup_id = '${SELF.id}'`)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor: SELF.email, field: 'withdrawn', before_text: `Активен · публикувана ${SECTION}` })
    expect(String(audit[0]!.after_text)).toContain(`Оттегли се от профила · освободена публикувана ${SECTION} · Brevo`)

    // The freed seat can be drafted for someone else without a „вече е публикувана“ block.
    // A separate browser for the admin, so the volunteer's saved profile stays theirs.
    const adminContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' })
    const admin = await adminContext.newPage()
    await signIn(admin, ADMIN.session)
    await admin.goto(`/admin/sections?q=${encodeURIComponent(NEXT.email)}`)
    const input = admin.getByLabel(`Чернова за ${NEXT.email}`)
    await expect(input).toBeVisible({ timeout: 30_000 })
    await input.fill(SECTION)
    const drafted = savedWith(admin, 'adminDraft')
    await input.locator('xpath=ancestor::form[1]').getByRole('button', { name: 'Запази', exact: true }).click()
    await drafted
    await expect(admin.getByText(/Секцията вече е/)).toHaveCount(0)
    expect(d1(`SELECT draft_section FROM signups WHERE id = '${NEXT.id}'`)[0]).toMatchObject({ draft_section: SECTION })
    await adminContext.close()

    // „Върни записването“ clears the withdrawal but never hands the seat back.
    await page.goto('/profil')
    // The saved profile renders before the session load; a click before that load finishes is not saved.
    await page.waitForLoadState('networkidle')
    const returned = savedWith(page, 'saveSignup')
    await page.getByRole('button', { name: 'Върни записването' }).click()
    await returned
    expect(d1(`SELECT withdrawn, withdrawn_at, withdrawn_by, published_section FROM signups WHERE id = '${SELF.id}'`)[0]).toMatchObject({ withdrawn: 0, withdrawn_at: null, withdrawn_by: null, published_section: null })
    expect(d1(`SELECT field FROM signup_audit WHERE signup_id = '${SELF.id}' ORDER BY created_at`).map((item) => item.field)).toEqual(['withdrawn', 'restored'])
  })
})

/** Resolves when a call to the server function `name` (e.g. saveSignup) has answered. */
function savedWith(page: Page, name: string) {
  return page.waitForResponse(
    (response) => {
      const match = response.url().match(/\/_serverFn\/([^/?]+)/)
      if (!match || response.request().method() !== 'POST') return false
      const id = Buffer.from(match[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
      return id.includes(`"export":"${name}`)
    },
    { timeout: 20_000 },
  )
}

async function signIn(page: Page, session: string) {
  await page.context().clearCookies()
  await page.context().addCookies([{ name: 'tb_session', value: session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
}

function payload(first: string, last: string, email: string) {
  return JSON.stringify({
    firstName: first,
    middleName: 'Тестова',
    lastName: last,
    phone: '0888555111',
    email,
    role: 'section',
    rounds: { first: true, runoff: true },
    radius: 'settlement',
    consent: true,
    submitted: true,
    emailConfirmed: true,
    place: { regionCode: '16', regionName: 'Пловдив', municipalityName: 'Пловдив', townName: 'гр. Пловдив', sectionPlace: 'ул. Оттегляне 1' },
  })
}

function seed() {
  const row = (person: typeof SELF, first: string, last: string, egnValue: string, section: string, number: string) =>
    `('${person.id}', '${person.email}', '${person.session}', '${person.id.replace(/-/g, '').slice(0, 12)}', '${payload(first, last, person.email)}', 1, 1, 0, 1, '${egnValue}', 'section',
      '16', '16', 'гр. Пловдив', 'ул. Оттегляне 1', ${section}, ${section}, ${section ? "datetime('now')" : 'NULL'}, 1, 1, 'settlement', ${number}, datetime('now'), datetime('now'))`
  const sql = `
DELETE FROM signup_audit WHERE signup_id IN ('${SELF.id}', '${NEXT.id}');
DELETE FROM signups WHERE id IN ('${SELF.id}', '${NEXT.id}', '${ADMIN.id}');
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, consent, withdrawn, submitted, egn, role,
  mir_code, region_code, town_name, section_place, draft_section, published_section, published_at, rounds_first, rounds_runoff, radius,
  designation_number, created_at, updated_at)
VALUES
  ${row(SELF, 'Оттеглящ', 'Самичък', egn(80, 5, 5, 515), `'${SECTION}'`, '777')},
  ${row(NEXT, 'Следващ', 'Желаещ', egn(81, 6, 6, 616), 'NULL', 'NULL')},
  ${row(ADMIN, 'Админ', 'Оттегляне', '', 'NULL', 'NULL')};
UPDATE signups SET signup_mail_at = 'skipped' WHERE id IN ('${SELF.id}', '${NEXT.id}', '${ADMIN.id}');
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${ADMIN.email}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';
`
  wranglerLocal(['--command', sql])
}

const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

function d1(sql: string): Array<Record<string, unknown>> {
  const output = wranglerLocal(['--json', '--command', sql])
  const parsed = JSON.parse(output.slice(output.indexOf('['))) as Array<{ results?: Array<Record<string, unknown>> }>
  return parsed.flatMap((item) => item.results ?? [])
}

/** Local D1 through wrangler, retried while another spec holds the SQLite lock. */
function wranglerLocal(args: string[]) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', ...args], { cwd: WEB_DIR, stdio: 'pipe' }).toString()
    } catch (error) {
      if (attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}
