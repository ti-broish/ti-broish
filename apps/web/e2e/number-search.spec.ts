import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { nameKey } from '../src/signup/rik/normalize'

// Admin search by пълномощно number and „История на номера“ on the profile, from the number ledger.
// All names are fake. Numbers 9xx keep clear of the other specs. Saving the signup's number already
// writes its ledger row (trigger), so the seed upserts.
const STAFF_EMAIL = 'numsearch.admin-e2e@example.com'
const SESSION = 'e2e-numsearch-admin-session'
const PERSON = 'e2e-numsearch-a'
const PARTNER = 'pp-e2e-numsearch-1'
const NAME = 'Номерка Тестова Преместена'
const PARTNER_NAME = 'Отписан Тестов Партньоров'
const EXTERNAL = 'Външен Тестов Човек'
const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')
const SHOTS = process.env.SCREENSHOT_DIR

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

const CLEANUP = `
DELETE FROM designation_numbers WHERE (mir, number) IN (('23', 914), ('26', 925), ('17', 914), ('01', 915));
DELETE FROM rik_entries WHERE id LIKE 'e2e-numsearch-%';
DELETE FROM partner_people WHERE id = '${PARTNER}';
DELETE FROM signups WHERE id IN ('e2e-numsearch-admin', '${PERSON}');
DELETE FROM staff WHERE email = '${STAFF_EMAIL}';
`

function seed() {
  const payload = (first: string, middle: string, last: string, email: string) => JSON.stringify({ firstName: first, middleName: middle, lastName: last, email, phone: '0888000111' })
  const [first, middle, last] = NAME.split(' ')
  const rik = (id: string, mir: string, number: number, name: string, annulled: number, missing: string | null) =>
    `('e2e-numsearch-${id}', '${mir}', 'representative', 1, '', 'https://rik${mir}.cik.bg/pvr2026/registers/register_p', '${name}', '${nameKey(name)}', '${number}/22.10.2026', ${number}, '22.10.2026', ${annulled}, '2026-10-22T08:00:00.000Z', '2026-10-29T08:00:00.000Z', ${missing ? `'${missing}'` : 'NULL'})`
  wranglerLocal([
    '--command',
    `${CLEANUP}
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('e2e-numsearch-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2enumad', '${payload('Админ', '', 'Номера', STAFF_EMAIL)}', 1, 0, 1, '', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now')) ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, designation_mir, designation_number, designation_issued_at, designation_signed_at, created_at, updated_at)
VALUES ('${PERSON}', 'numsearch.a-e2e@example.com', 'e2e-numsearch-a-session', 'e2enumsa', '${payload(first!, middle!, last!, 'numsearch.a-e2e@example.com')}', 1, 0, 1, '',
  '26', 925, '24.10.2026', '2026-10-24T09:00:00.000Z', datetime('now'), datetime('now'));
INSERT INTO partner_people (id, partner, egn, email, first_name, middle_name, last_name, region_code, region_name, designation_mir, imported_at, updated_at)
VALUES ('${PARTNER}', 'iaz.bg', '', 'numsearch.p-e2e@example.com', 'Отписан', 'Тестов', 'Партньоров', '17', 'Пловдив област', '17', datetime('now'), datetime('now'));
INSERT INTO designation_numbers (mir, number, issued_on, holder, person_id, state, moved_to, name, rik_url, note, created_at, updated_at) VALUES
  ('23', 914, '22.10.2026', 'signup', '${PERSON}', 'moved', '26/925', '', '', '', '2026-10-22 08:00:00', '2026-10-24 08:00:00'),
  ('26', 925, '24.10.2026', 'signup', '${PERSON}', 'active', '', '', '', '', '2026-10-24 08:00:00', '2026-10-24 08:00:00'),
  ('17', 914, '22.10.2026', 'partner', '${PARTNER}', 'withdrawn', '', '', '', '', '2026-10-22 08:00:00', '2026-10-25 08:00:00'),
  ('01', 915, '23.10.2026', 'external', NULL, 'external', '', '${EXTERNAL}', 'https://rik01.cik.bg/pvr2026/registers/register_p', '', '2026-10-23 08:00:00', '2026-10-23 08:00:00')
ON CONFLICT(mir, number) DO UPDATE SET issued_on = excluded.issued_on, holder = excluded.holder, person_id = excluded.person_id, state = excluded.state,
  moved_to = excluded.moved_to, name = excluded.name, rik_url = excluded.rik_url, created_at = excluded.created_at, updated_at = excluded.updated_at;
INSERT INTO rik_entries (id, mir, kind, ours, party, source_url, name, name_key, number_raw, number, number_date, annulled, first_seen_at, last_seen_at, missing_since) VALUES
  ${rik('a-old', '23', 914, 'Анулиран', 1, null)},
  ${rik('a-old-name', '23', 914, NAME, 0, '2026-10-25T08:00:00.000Z')},
  ${rik('a-new', '26', 925, NAME, 0, null)},
  ${rik('ext', '01', 915, EXTERNAL, 0, null)};
`,
  ])
}

async function signIn(page: Page) {
  await page.context().clearCookies()
  await page.context().addCookies([{ name: 'tb_session', value: SESSION, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
}

test.describe('number search and „История на номера“', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test.afterAll(() => wranglerLocal(['--command', CLEANUP]))

  test('„23/914“ finds the moved number; „01/915“ the external one; „914“ every МИР', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/admin/signups?q=23%2F914')
    const moved = page.getByTestId('number-card')
    await expect(moved).toHaveCount(1, { timeout: 30_000 })
    await expect(moved).toContainText('Преместен')
    await expect(moved).toContainText('26/925')
    await expect(moved).toContainText(NAME)
    await expect(moved).toContainText('„Анулиран“')
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/pr3-search-moved.png`, fullPage: false })
    await moved.getByRole('link', { name: /Отвори профила/ }).click()
    await expect(page).toHaveURL(new RegExp(`/admin/signups/${PERSON}`))

    await page.goto('/admin/signups?q=01%2F915')
    const external = page.getByTestId('number-card')
    await expect(external).toHaveCount(1, { timeout: 30_000 })
    await expect(external).toContainText('Външен (РИК)')
    await expect(external).toContainText(EXTERNAL)
    await expect(external.getByRole('link', { name: /Регистър РИК 01/ })).toHaveAttribute('href', 'https://rik01.cik.bg/pvr2026/registers/register_p')
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/pr3-search-external.png`, fullPage: false })

    await page.goto('/admin/signups?q=914')
    await expect(page.getByTestId('number-card')).toHaveCount(2, { timeout: 30_000 })
    await expect(page.getByTestId('number-card').filter({ hasText: PARTNER_NAME })).toContainText('Отписан')

    await page.goto('/admin/signups?q=23%2F913')
    await expect(page.getByText('Този номер не е издаван и не е в регистъра на РИК.')).toBeVisible({ timeout: 30_000 })
  })

  test('the profile shows every number the person held, oldest first, with the РИК register', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/admin/signups/${PERSON}`)
    const history = page.getByTestId('number-history')
    await expect(history.locator('li')).toHaveCount(2, { timeout: 30_000 })
    await expect(history.locator('li').first()).toContainText('23/914')
    await expect(history.locator('li').first()).toContainText('26/925')
    await expect(history.locator('li').last()).toContainText('публикуван ✓')
    if (SHOTS) {
      await history.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${SHOTS}/pr3-number-history.png`, fullPage: false })
    }

    await page.goto(`/admin/iaz/${PARTNER}`)
    await expect(page.getByTestId('number-history').locator('li')).toHaveCount(1, { timeout: 30_000 })
    await expect(page.getByTestId('number-history')).toContainText('17/914')
    await expect(page.getByTestId('number-history')).toContainText('Отписан')
  })
})
