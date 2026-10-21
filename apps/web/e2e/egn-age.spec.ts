import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { seedProfile } from './helpers'
import type { Profile } from '../src/signup/model'

const UNDERAGE = 'Трябва да навършиш 18 години до деня на изборите (25.10.2026 г.).'
const NEW = { email: 'egnage.new-e2e@example.com' }
const OLD = { id: 'e2e-egnage-old', email: 'egnage.old-e2e@example.com', session: 'e2e-egnage-old-session' }

function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

/** Born 26.10.2008: 18 the day after election day. */
const YOUNG = egn(8, 50, 26, 431)
/** Born 25.10.2008: 18 on election day. */
const JUST_18 = egn(8, 50, 25, 432)

function profile(email: string, egnValue: string, phone = '0888555222'): Partial<Profile> {
  return {
    firstName: 'Тест',
    middleName: 'Тестов',
    lastName: 'Възраст',
    email,
    phone,
    emailConfirmed: true,
    egn: egnValue,
    role: 'section',
    rounds: { first: true, runoff: true },
    experience: 'counted',
    place: { regionCode: '16', regionName: 'Пловдив', municipalityName: 'Пловдив', townName: 'гр. Пловдив' },
    radius: 'settlement',
    consent: true,
  }
}

test.describe('18 years on election day', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/')
    await page.close()
    cleanup()
    wranglerLocal([
      '--command',
      `INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, consent, withdrawn, submitted, egn, role, created_at, updated_at)
       VALUES ('${OLD.id}', '${OLD.email}', '${OLD.session}', 'e2eegnageold', '${JSON.stringify({ ...profile(OLD.email, ''), submitted: true })}', 1, 1, 0, 1, '${YOUNG}', 'section', datetime('now'), datetime('now'));
       UPDATE signups SET signup_mail_at = 'skipped' WHERE id = '${OLD.id}';`,
    ])
  })

  test.afterAll(() => cleanup())

  test('the ЕГН step stops someone who is 17 on election day', async ({ page }) => {
    await seedProfile(page, { ...profile('egnage.ui-e2e@example.com', ''), role: null })
    await page.goto('/signup?step=egn')
    await page.getByLabel('ЕГН').fill(YOUNG)
    await page.getByRole('button', { name: 'Напред' }).click()
    await expect(page.getByText(UNDERAGE)).toBeVisible()
    await page.getByLabel('ЕГН').fill(JUST_18)
    await page.getByRole('button', { name: 'Напред' }).click()
    await expect(page.getByText(UNDERAGE)).toHaveCount(0)
  })

  test('the server refuses an under-18 signup that skipped the form', async ({ page }) => {
    await seedProfile(page, profile(NEW.email, YOUNG))
    const saved = savedWith(page, 'saveSignup')
    await page.goto('/signup?step=review')
    const response = await saved
    expect(await response.text()).toContain(UNDERAGE)
    expect(d1(`SELECT id FROM signups WHERE email = '${NEW.email}'`)).toHaveLength(0)
  })

  test('an existing record with an under-18 ЕГН still saves, but cannot switch to another one', async ({ page }) => {
    await page.context().addCookies([{ name: 'tb_session', value: OLD.session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    const saved = savedWith(page, 'saveSignup')
    await page.goto('/signup?step=review')
    const first = await saved
    expect(await first.text()).not.toContain(UNDERAGE)
    const request = first.request()
    const body = request.postData() ?? ''
    expect(body).toContain(YOUNG)
    expect(body).toContain('0888555222')
    const replay = (data: string) => page.request.post(request.url(), { headers: request.headers(), data })

    const kept = await replay(body.replace('0888555222', '0888555333'))
    expect(await kept.text()).not.toContain(UNDERAGE)
    expect(String(d1(`SELECT payload FROM signups WHERE id = '${OLD.id}'`)[0]?.payload)).toContain('0888555333')

    const changed = await replay(body.replace(YOUNG, egn(9, 41, 1, 433)))
    expect(await changed.text()).toContain(UNDERAGE)
    expect(d1(`SELECT egn FROM signups WHERE id = '${OLD.id}'`)[0]?.egn).toBe(YOUNG)
  })
})

function cleanup() {
  wranglerLocal([
    '--command',
    `DELETE FROM signup_audit WHERE signup_id IN (SELECT id FROM signups WHERE email IN ('${NEW.email}', '${OLD.email}', 'egnage.ui-e2e@example.com'));
     DELETE FROM signups WHERE email IN ('${NEW.email}', '${OLD.email}', 'egnage.ui-e2e@example.com');`,
  ])
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
