import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

// One active signup per ЕГН (src/signup/egn-in-use.ts): the ЕГН step and saveSignup refuse an ЕГН that
// another active signup holds, never naming that signup; a withdrawn one does not block.

const EGN = '8001010008'
const HOLDER = { id: 'e2e-egndup-holder', email: 'egndup.holder-e2e@example.com', session: 'e2e-egndup-holder-session' }
const SECOND = { id: 'e2e-egndup-second', email: 'egndup.second-e2e@example.com', session: 'e2e-egndup-second-session' }
const BASE = 'http://127.0.0.1:3000'
const MESSAGE = 'Това ЕГН вече е използвано в друго записване.'

function payload(email: string, firstName: string) {
  return JSON.stringify({
    firstName,
    middleName: 'Тестов',
    lastName: 'Дублиран',
    phone: '0888777111',
    email,
    role: 'section',
    rounds: { first: false, runoff: true },
    radius: 'settlement',
    consent: false,
    submitted: false,
    emailConfirmed: true,
  })
}

function seed(holderWithdrawn: 0 | 1) {
  wranglerLocal([
    '--command',
    `${cleanupSql()}
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('${HOLDER.id}', '${HOLDER.email}', '${HOLDER.session}', 'e2eegndup1', '${payload(HOLDER.email, 'Първи')}', 1, ${holderWithdrawn}, 1, '${EGN}', datetime('now'), datetime('now'));
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('${SECOND.id}', '${SECOND.email}', '${SECOND.session}', 'e2eegndup2', '${payload(SECOND.email, 'Втори')}', 1, 0, 0, '', datetime('now'), datetime('now'));`,
  ])
}

test.describe('one active signup per ЕГН', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/')
    await page.close()
  })

  test.afterAll(() => {
    wranglerLocal(['--command', cleanupSql()])
  })

  test('the ЕГН step refuses an ЕГН another active signup holds, without saying whose', async ({ page }) => {
    seed(0)
    await openEgnStep(page, SECOND.session)
    await page.getByLabel('ЕГН').fill(EGN)
    await page.getByRole('button', { name: 'Напред' }).click()
    const alert = page.getByRole('alert').filter({ hasText: MESSAGE }).first()
    await expect(alert).toBeVisible()
    await expect(alert).not.toContainText(HOLDER.email)
    await expect(alert).not.toContainText('Първи')
    await expect(page).toHaveURL(/step=egn/)
    expect(storedEgn(SECOND.id)).toBe('')
  })

  test('a withdrawn signup’s ЕГН does not block a new one, and the owner re-enters their own', async ({ page }) => {
    seed(1)
    await openEgnStep(page, SECOND.session)
    await page.getByLabel('ЕГН').fill(EGN)
    await page.getByRole('button', { name: 'Напред' }).click()
    await expect(page).toHaveURL(/step=role/, { timeout: 20_000 })
    await expect.poll(() => storedEgn(SECOND.id), { timeout: 20_000 }).toBe(EGN)

    // The holder is back (restored by the team): their own ЕГН still goes through for them.
    wranglerLocal(['--command', `UPDATE signups SET withdrawn = 0 WHERE id = '${HOLDER.id}'`])
    await openEgnStep(page, HOLDER.session)
    await page.getByLabel('ЕГН').fill(EGN)
    await page.getByRole('button', { name: 'Напред' }).click()
    await expect(page).toHaveURL(/step=role/, { timeout: 20_000 })
  })
})

async function openEgnStep(page: Page, session: string) {
  await page.context().clearCookies()
  await page.context().addCookies([{ name: 'tb_session', value: session, url: BASE, httpOnly: true, sameSite: 'Lax' }])
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto('/signup?step=egn')
  await page.getByRole('button', { name: 'Продължи своето записване' }).click({ timeout: 30_000 })
  await expect(page.getByLabel('ЕГН')).toBeVisible()
}

function storedEgn(id: string) {
  return String(d1(`SELECT COALESCE(egn, '') AS egn FROM signups WHERE id = '${id}'`)[0]?.egn ?? '')
}

function cleanupSql() {
  return `DELETE FROM signup_audit WHERE signup_id IN ('${HOLDER.id}', '${SECOND.id}');
DELETE FROM signups WHERE email IN ('${HOLDER.email}', '${SECOND.email}');`
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
