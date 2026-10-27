import { execFileSync } from 'node:child_process'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { seedProfile } from './helpers'

const STAFF = { id: 'e2e-takeover-staff', email: 'takeover.staff-e2e@example.com', session: 'e2e-takeover-staff-session' }
const OTHER_EMAIL = 'takeover.other-e2e@example.com'
const NEW_EMAIL = 'takeover.new-e2e@example.com'
const BASE = 'http://127.0.0.1:3000'

test.describe('a typed e-mail never takes over someone else’s record', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
  })

  test.beforeEach(() => seed())

  test.afterAll(() => {
    wranglerLocal(['--command', cleanupSql()])
  })

  test('a browser without the session cannot overwrite a staff record or get its session', async ({ page }) => {
    await seedProfile(page, { firstName: 'Иво', middleName: 'Петров', lastName: 'Петров', email: STAFF.email, phone: '0888111222', emailConfirmed: true })
    const saved = savedWith(page, 'saveSignup')
    await page.goto('/signup?step=contact')
    await saved
    await expect(page.getByRole('alert')).toContainText('/vhod')
    expect(names(STAFF.id)).toBe('Илина Тестова Пазена')
    expect(await sessionCookie(page.context())).toBe('')
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
  })

  test('„Запиши друг човек“ starts a new record and leaves the signed-in one alone', async ({ page }) => {
    await signIn(page, STAFF.session)
    await page.goto('/signup?step=contact')
    await expect(page.getByRole('heading', { name: `Влязъл си като ${STAFF.email}` })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Запиши друг човек' }).click()
    await expect(page.getByRole('heading', { name: 'Как да се свържем с теб' })).toBeVisible({ timeout: 30_000 })
    expect(await sessionCookie(page.context())).toBe('')
    await expect(page.getByLabel('Име', { exact: true })).toHaveValue('')
    await page.getByLabel('Име', { exact: true }).fill('Друг')
    await page.getByLabel('Презиме').fill('Човеков')
    await page.getByLabel('Фамилия').fill('Нов')
    await page.getByLabel('Телефон').fill('0888333444')
    const saved = savedWith(page, 'saveSignup')
    await page.getByLabel('Имейл').fill(NEW_EMAIL)
    await saved
    const rows = d1(`SELECT id, json_extract(payload, '$.firstName') AS first FROM signups WHERE email = '${NEW_EMAIL}'`)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).not.toBe(STAFF.id)
    expect(rows[0]!.first).toBe('Друг')
    expect(names(STAFF.id)).toBe('Илина Тестова Пазена')
    expect(await sessionCookie(page.context())).not.toBe(STAFF.session)
  })

  test('the „Влязъл си като“ prompt saves nothing, so one click on „Запиши друг човек“ signs out', async ({ page }) => {
    await signIn(page, STAFF.session)
    const saves: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && isServerFn(request.url(), 'saveSignup')) saves.push(request.url())
    })
    await page.goto('/signup?step=contact')
    await expect(page.getByRole('heading', { name: `Влязъл си като ${STAFF.email}` })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Какво искаш да направиш?')).toBeVisible()
    await expect(page.getByText(/излиза от профила ти/)).toBeVisible()
    // The old autosave fired 600 ms after the load, and its answer set tb_session back after the sign-out.
    await page.waitForTimeout(1500)
    expect(saves).toEqual([])
    await page.getByRole('button', { name: 'Запиши друг човек' }).click()
    await expect(page.getByRole('heading', { name: 'Как да се свържем с теб' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: /Влязъл си като/ })).toHaveCount(0)
    await expect(page.getByLabel('Име', { exact: true })).toHaveValue('')
    expect(await sessionCookie(page.context())).toBe('')
  })

  test('another e-mail typed in a signed-in browser is refused, not swapped for the session’s', async ({ page }) => {
    await signIn(page, STAFF.session)
    await seedProfile(page, { firstName: 'Иво', middleName: 'Петров', lastName: 'Петров', email: OTHER_EMAIL, phone: '0888111222', emailConfirmed: true })
    await page.goto('/signup?step=contact')
    await expect(page.getByRole('button', { name: 'Продължи своето записване' })).toBeVisible({ timeout: 30_000 })
    const saved = savedWith(page, 'saveSignup')
    await page.getByRole('button', { name: 'Продължи своето записване' }).click()
    await page.getByLabel('Имейл').fill(OTHER_EMAIL)
    await page.getByLabel('Име', { exact: true }).fill('Иво')
    await saved
    await expect(page.getByRole('alert')).toContainText(STAFF.email)
    expect(names(STAFF.id)).toBe('Илина Тестова Пазена')
    expect(d1(`SELECT email FROM signups WHERE id = '${STAFF.id}'`)[0]).toMatchObject({ email: STAFF.email })
    expect(d1(`SELECT id FROM signups WHERE email = '${OTHER_EMAIL}'`)).toHaveLength(0)
  })

  test('the owner’s own change of name and phone is written to signup_audit', async ({ page }) => {
    await signIn(page, STAFF.session)
    await page.goto('/signup?step=contact')
    await page.getByRole('button', { name: 'Продължи своето записване' }).click()
    await expect(page.getByLabel('Телефон')).toHaveValue('0888555111', { timeout: 30_000 })
    const saved = savedWith(page, 'saveSignup')
    await page.getByLabel('Телефон').fill('0888999000')
    await saved
    const audit = d1(`SELECT actor, field, before_text, after_text FROM signup_audit WHERE signup_id = '${STAFF.id}' AND field = 'phone'`)
    expect(audit.at(-1)).toMatchObject({ actor: `self:${STAFF.email}`, field: 'phone', before_text: '0888555111', after_text: '0888999000' })
  })
})

function names(id: string) {
  const [row] = d1(
    `SELECT json_extract(payload, '$.firstName') || ' ' || json_extract(payload, '$.middleName') || ' ' || json_extract(payload, '$.lastName') AS name FROM signups WHERE id = '${id}'`,
  )
  return String(row?.name ?? '')
}

async function sessionCookie(context: BrowserContext) {
  const cookie = (await context.cookies(BASE)).find((item) => item.name === 'tb_session')
  return cookie?.value ?? ''
}

function isServerFn(url: string, name: string) {
  const match = url.match(/\/_serverFn\/([^/?]+)/)
  if (!match) return false
  return Buffer.from(match[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').includes(`"export":"${name}`)
}

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
  await page.context().addCookies([{ name: 'tb_session', value: session, url: BASE, httpOnly: true, sameSite: 'Lax' }])
}

function cleanupSql() {
  return `DELETE FROM signup_audit WHERE signup_id IN (SELECT id FROM signups WHERE email IN ('${STAFF.email}', '${OTHER_EMAIL}', '${NEW_EMAIL}'));
DELETE FROM signups WHERE email IN ('${STAFF.email}', '${OTHER_EMAIL}', '${NEW_EMAIL}');
DELETE FROM staff WHERE email = '${STAFF.email}';`
}

function seed() {
  const payload = JSON.stringify({
    firstName: 'Илина',
    middleName: 'Тестова',
    lastName: 'Пазена',
    phone: '0888555111',
    email: STAFF.email,
    role: 'section',
    rounds: { first: true, runoff: true },
    radius: 'settlement',
    consent: true,
    submitted: false,
    emailConfirmed: true,
  })
  wranglerLocal([
    '--command',
    `${cleanupSql()}
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('${STAFF.id}', '${STAFF.email}', '${STAFF.session}', 'e2etakeov1', '${payload}', 1, 0, 0, '', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF.email}', 'admin', 'e2e', datetime('now')) ON CONFLICT(email) DO UPDATE SET role = 'admin';`,
  ])
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
