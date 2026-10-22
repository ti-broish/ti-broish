import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// „И аз“ people on Записвания: one coloured row with an „И аз“ badge, merged with an unfinished
// signup of the same person, never selectable for bulk actions and never in a Brevo CSV.
const STAFF_EMAIL = 'iaz.roster-admin-e2e@example.com'
const SESSION = 'e2e-iaz-roster-session'
const PARTNER_ID = 'pp-e2e-roster-ina'
const INA_EGN = '9001016354'
const SECTION = '259990154'

function seed() {
  const sql = `
DELETE FROM partner_people WHERE id = '${PARTNER_ID}';
DELETE FROM signups WHERE id IN ('e2e-roster-ina', 'e2e-roster-ina-typo', 'e2e-roster-other');
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES
  ('e2e-iaz-roster-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2eiazro', '{"firstName":"Админ","lastName":"Ростер","email":"${STAFF_EMAIL}","phone":"0888000998"}', 1, 0, 1, '', datetime('now'), datetime('now')),
  ('e2e-roster-ina', 'ina.roster-e2e@example.com', 'e2e-roster-ina-session', 'e2erosin', '{"firstName":"Илина","lastName":"Ростерова","email":"ina.roster-e2e@example.com","phone":"0888777666"}', 1, 0, 0, '${INA_EGN}', datetime('now', '-2 days'), datetime('now', '-2 days')),
  ('e2e-roster-ina-typo', 'ina.roster-e2e@example.co', 'e2e-roster-typo-session', 'e2erosty', '{"firstName":"Илина","lastName":"Ростерова","email":"ina.roster-e2e@example.co"}', 0, 0, 0, '', datetime('now', '-3 days'), datetime('now', '-3 days')),
  ('e2e-roster-other', 'other.roster-e2e@example.com', 'e2e-roster-other-session', 'e2erosot', '{"firstName":"Друга","lastName":"Ростерова","email":"other.roster-e2e@example.com","phone":"0888777555"}', 1, 0, 0, '', datetime('now', '-4 days'), datetime('now', '-4 days'))
ON CONFLICT(email) DO UPDATE SET session_token = excluded.session_token, payload = excluded.payload, email_confirmed = excluded.email_confirmed, submitted = excluded.submitted, egn = excluded.egn, withdrawn = 0;
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO partner_people (id, partner, egn, email, phone, first_name, middle_name, last_name, region_code, region_name, municipality_name,
  designation_mir, designation_number, designation_issued_at, designation_signed_at, imported_at, updated_at)
VALUES ('${PARTNER_ID}', 'iaz.bg', '${INA_EGN}', 'ina.roster-e2e@example.com', '', 'Илина', 'Симеонова', 'Ростерова', 'sofia', 'София-град', 'Столична',
  '25', 9506, '2026-10-19T04:00:00.000Z', '2026-10-21T07:22:43.000Z', '2026-10-19T20:44:21.000Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE partner_people SET section_draft = '${SECTION}' WHERE id = '${PARTNER_ID}';
UPDATE partner_people SET section_published = '${SECTION}' WHERE id = '${PARTNER_ID}';
`
  wranglerLocal(['--command', sql])
}

test.describe('„И аз“ on Записвания', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  // Other specs count every „И аз“ person and section, so leave nothing behind.
  test.afterAll(() => {
    wranglerLocal(['--command', `DELETE FROM partner_people WHERE id = '${PARTNER_ID}';
DELETE FROM taken_sections WHERE section_code = '${SECTION}';
DELETE FROM signups WHERE id IN ('e2e-roster-ina', 'e2e-roster-ina-typo', 'e2e-roster-other');`])
  })

  test('one coloured „И аз“ row per person, merged with the unfinished signup', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/admin/signups?q=Ростерова')
    const table = page.locator('table')
    const iaz = table.locator('tbody tr[data-source="iaz"]')
    await expect(iaz).toHaveCount(1)
    await expect(iaz).toContainText('Илина Симеонова Ростерова')
    await expect(iaz.getByTestId('iaz-badge')).toHaveText('„И аз“')
    await expect(iaz).toHaveClass(/bg-\[#e3f1f4\]/)
    await expect(iaz).toContainText('№ 25/9506')
    await expect(iaz).toContainText('Подписано')
    await expect(iaz).toContainText(`Публ. ${SECTION}`)
    await expect(iaz.getByTestId('iaz-merged')).toContainText('Има и недовършено записване при нас')
    await expect(iaz.getByRole('checkbox')).toBeDisabled()
    // The merged signup is not a second row; the typo row (no ЕГН, other e-mail) and an unrelated person are.
    const ours = table.locator('tbody tr[data-source="tb"]')
    await expect(ours).toHaveCount(2)
    await expect(ours.filter({ hasText: 'ina.roster-e2e@example.co' })).toHaveCount(1)
    await expect(table.locator('tbody tr').filter({ hasText: 'ina.roster-e2e@example.com' })).toHaveCount(1)
    await expect(page.getByRole('status').filter({ hasText: 'в този изглед' })).toContainText('3 в този изглед (2 записани при нас и 1 от „И аз“)')

    // „Избери тази страница“ picks only our signups.
    await page.getByLabel('Избери тази страница').check()
    await expect(page.getByText('Избрани: 2').first()).toBeVisible()
    await page.getByLabel('Избери тази страница').uncheck()

    // Source filter.
    await page.getByRole('group', { name: 'Източник' }).getByRole('button', { name: '„И аз“' }).click()
    await expect(page).toHaveURL(/source=iaz/)
    await expect(table.locator('tbody tr')).toHaveCount(1)
    await expect(table.locator('tbody tr[data-source="iaz"]')).toHaveCount(1)
    await page.getByRole('group', { name: 'Източник' }).getByRole('button', { name: 'Ти Броиш' }).click()
    await expect(page).toHaveURL(/source=tb/)
    await expect(table.locator('tbody tr[data-source="iaz"]')).toHaveCount(0)
    await expect(table.locator('tbody tr[data-source="tb"]')).toHaveCount(2)
    await page.getByRole('group', { name: 'Източник' }).getByRole('button', { name: 'Всички източници' }).click()

    // Views: Започнали is about our form (the merged signup is hidden there too); Със секция has the „И аз“ row.
    await page.goto('/admin/signups?q=Ростерова&view=started')
    await expect(table.locator('tbody tr[data-source="iaz"]')).toHaveCount(0)
    await expect(table.locator('tbody tr')).toHaveCount(2)
    await page.goto('/admin/signups?q=Ростерова&view=assigned')
    await expect(table.locator('tbody tr')).toHaveCount(1)
    await expect(table.locator('tbody tr[data-source="iaz"]')).toHaveCount(1)
    await page.goto(`/admin/signups?q=${INA_EGN}`)
    await expect(table.locator('tbody tr')).toHaveCount(1)
    await expect(table.locator('tbody tr[data-source="iaz"]')).toHaveCount(1)

    // The name opens the „И аз“ record (read-only), with the signup linked.
    await page.goto('/admin/signups?q=Ростерова')
    await table.locator('tbody tr[data-source="iaz"]').getByRole('link', { name: 'Илина Симеонова Ростерова' }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/iaz/${PARTNER_ID}$`))
    const card = page.getByTestId('iaz-person')
    await expect(card).toContainText('№ 25/9506')
    await expect(card).toContainText(`Публикувана ${SECTION}`)
    await expect(card).toContainText(`******${INA_EGN.slice(-4)}`)
    await expect(card).not.toContainText(INA_EGN)
    await expect(page.getByRole('link', { name: 'Илина Ростерова' })).toHaveAttribute('href', '/admin/signups/e2e-roster-ina')
  })

  test('the Brevo CSV never holds the „И аз“ person or the merged signup', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/admin/signups?q=Ростерова')
    await expect(page.locator('table tbody tr[data-source="iaz"]')).toHaveCount(1)
    await openTools(page)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV за Brevo', exact: true }).click()
    const file = await (await download).path()
    const csv = readFileSync(file!, 'utf8')
    expect(csv).toContain('other.roster-e2e@example.com')
    expect(csv).not.toContain('ina.roster-e2e@example.com')
    expect(csv).not.toContain(PARTNER_ID)
  })
})

async function openTools(page: Page) {
  const tools = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Инструменти' }) })
  if (!(await tools.evaluate((element) => (element as HTMLDetailsElement).open))) await tools.locator('summary').first().click()
}

async function signIn(page: Page) {
  await page.context().addCookies([{ name: 'tb_session', value: SESSION, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
}

const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

/** Local D1 through wrangler, retried while another spec holds the SQLite lock. */
function wranglerLocal(args: string[]) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', ...args], {
        cwd: WEB_DIR,
        stdio: 'pipe',
      }).toString()
    } catch (error) {
      if (attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}
