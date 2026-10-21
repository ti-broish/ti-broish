import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

// Synthetic test people; the numbers are made up with a valid check digit.
function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

const PERSON_EGN = egn(83, 2, 14, 731)
const PARTNER_EGN = egn(79, 11, 23, 742)
const ADMIN = { email: 'egn.admin-e2e@example.com', session: 'e2e-egn-admin-session' }
const EDITOR = { email: 'egn.editor-e2e@example.com', session: 'e2e-egn-editor-session' }
const PERSON_ID = 'e2e-egn-person'
const PARTNER_ID = 'pp-e2e-egn'
const BASE = 'http://127.0.0.1:3000'

test.describe('„Покажи ЕГН“ on profiles', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test.afterAll(() => {
    d1(`DELETE FROM signup_audit WHERE signup_id IN ('${PERSON_ID}', '${PARTNER_ID}');
DELETE FROM signups WHERE id IN ('${PERSON_ID}', 'e2e-egn-admin', 'e2e-egn-editor');
DELETE FROM partner_people WHERE id = '${PARTNER_ID}';
DELETE FROM staff WHERE email IN ('${ADMIN.email}', '${EDITOR.email}');`)
  })

  test('an admin sees it masked, reveals it (audited, not cached), copies and hides it', async ({ page }) => {
    await signIn(page, ADMIN.session)
    const bodies: string[] = []
    page.on('response', (response) => {
      if (response.url().startsWith(BASE) && !response.url().endsWith('/egn')) void response.text().then((text) => bodies.push(text)).catch(() => undefined)
    })
    await page.goto(`/admin/signups/${PERSON_ID}`)
    await expect(page.getByRole('heading', { name: 'Тест Егнов Показов', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('egn-masked')).toHaveText(`••••••${PERSON_EGN.slice(-4)}`)
    await expect(page.getByTestId('egn-value')).toHaveCount(0)
    // Not in the HTML, not in the profile payload.
    expect(await page.content()).not.toContain(PERSON_EGN)
    await page.waitForLoadState('networkidle')
    expect(bodies.some((text) => text.includes(PERSON_EGN))).toBe(false)

    const revealed = page.waitForResponse((response) => response.url().endsWith(`/admin/signups/${PERSON_ID}/egn`))
    await page.getByRole('button', { name: 'Покажи ЕГН' }).click()
    const response = await revealed
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toContain('no-store')
    await expect(page.getByTestId('egn-value')).toHaveText(PERSON_EGN)
    await expect(page.getByText(`${ADMIN.email} · ЕГН: показано на екрана`)).toBeVisible()

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.getByRole('button', { name: 'Копирай' }).click()
    await expect(page.getByRole('button', { name: 'Копирано' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PERSON_EGN)

    await page.getByRole('button', { name: 'Скрий' }).click()
    await expect(page.getByTestId('egn-value')).toHaveCount(0)
    await expect(page.getByTestId('egn-masked')).toHaveText(`••••••${PERSON_EGN.slice(-4)}`)
    expect(await page.locator('main, body').first().innerText()).not.toContain(PERSON_EGN)

    // The history survives a reload: who and when, never the number.
    await page.reload()
    await expect(page.getByText(`${ADMIN.email} · ЕГН: показано на екрана`)).toBeVisible({ timeout: 30_000 })
    expect(await page.content()).not.toContain(PERSON_EGN)
  })

  test('a non-admin sees no button and gets 403 from the endpoint', async ({ page }) => {
    await signIn(page, EDITOR.session)
    await page.goto(`/admin/signups/${PERSON_ID}`)
    await expect(page.getByRole('heading', { name: 'Тест Егнов Показов', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('egn-masked')).toHaveText(`••••••${PERSON_EGN.slice(-4)}`)
    await expect(page.getByRole('button', { name: 'Покажи ЕГН' })).toHaveCount(0)
    const result = await page.evaluate(async (path) => {
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
      return { status: response.status, cache: response.headers.get('cache-control') ?? '', text: await response.text() }
    }, `/admin/signups/${PERSON_ID}/egn`)
    expect(result.status).toBe(403)
    expect(result.cache).toContain('no-store')
    expect(result.text).not.toContain(PERSON_EGN)
  })

  test('signed out or cross-site gets nothing', async ({ page, request }) => {
    const anonymous = await request.post(`/admin/signups/${PERSON_ID}/egn`, { headers: { origin: BASE } })
    expect(anonymous.status()).toBe(401)
    expect(await anonymous.text()).not.toContain(PERSON_EGN)
    await signIn(page, ADMIN.session)
    const crossSite = await page.request.post(`/admin/signups/${PERSON_ID}/egn`, { headers: { origin: 'https://evil.example' } })
    expect(crossSite.status()).toBe(403)
    expect(await crossSite.text()).not.toContain(PERSON_EGN)
  })

  test('an admin reveals a „И аз“ partner person in Секции', async ({ page }) => {
    await signIn(page, ADMIN.session)
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/admin/sections')
    const panel = page.getByTestId('partner-sections-panel')
    await panel.locator('summary').click({ timeout: 30_000 })
    const row = panel.getByTestId('partner-section-row').filter({ hasText: 'Партньор Егнов' })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row.getByTestId('egn-masked')).toHaveText(`••••••${PARTNER_EGN.slice(-4)}`)
    expect(await page.content()).not.toContain(PARTNER_EGN)
    await row.getByRole('button', { name: 'Покажи ЕГН' }).click()
    await expect(row.getByTestId('egn-value')).toHaveText(PARTNER_EGN)
    await row.getByRole('button', { name: 'Скрий' }).click()
    await expect(row.getByTestId('egn-value')).toHaveCount(0)
    const audit = d1(`SELECT actor, field FROM signup_audit WHERE signup_id = '${PARTNER_ID}'`)
    expect(audit).toContain(ADMIN.email)
    expect(audit).toContain('egn_revealed')
  })
})

async function signIn(page: Page, session: string) {
  await page.context().addCookies([{ name: 'tb_session', value: session, url: BASE, httpOnly: true, sameSite: 'Lax' }])
}

const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

function d1(sql: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', '--command', sql], { cwd: WEB_DIR, stdio: 'pipe' }).toString()
    } catch (error) {
      if (attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}

function seed() {
  const payload = (first: string, middle: string, last: string, email: string) =>
    JSON.stringify({ firstName: first, middleName: middle, lastName: last, email, phone: '0888000222' })
  d1(`DELETE FROM signup_audit WHERE signup_id IN ('${PERSON_ID}', '${PARTNER_ID}');
DELETE FROM partner_people WHERE id = '${PARTNER_ID}';
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at) VALUES
  ('e2e-egn-admin', '${ADMIN.email}', '${ADMIN.session}', 'e2eegna1', '${payload('Админ', 'Егнов', 'Тестов', ADMIN.email)}', 1, 0, 1, '', datetime('now'), datetime('now')),
  ('e2e-egn-editor', '${EDITOR.email}', '${EDITOR.session}', 'e2eegne1', '${payload('Редактор', 'Егнов', 'Тестов', EDITOR.email)}', 1, 0, 1, '', datetime('now'), datetime('now')),
  ('${PERSON_ID}', 'egn.person-e2e@example.com', 'e2e-egn-person-session', 'e2eegnp1', '${payload('Тест', 'Егнов', 'Показов', 'egn.person-e2e@example.com')}', 1, 0, 1, '${PERSON_EGN}', datetime('now'), datetime('now'))
ON CONFLICT(email) DO UPDATE SET session_token = excluded.session_token, payload = excluded.payload, email_confirmed = 1, egn = excluded.egn;
INSERT INTO partner_people (id, partner, egn, email, first_name, middle_name, last_name, designation_mir, imported_at, updated_at)
VALUES ('${PARTNER_ID}', 'i-az', '${PARTNER_EGN}', 'egn.partner-e2e@example.com', 'Партньор', 'Тестов', 'Егнов', '23', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES
  ('${ADMIN.email}', 'admin', 'e2e', datetime('now')),
  ('${EDITOR.email}', 'editor', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = excluded.role;`)
}
