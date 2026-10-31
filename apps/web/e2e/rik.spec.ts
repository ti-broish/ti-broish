import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// The „РИК“ tab on seeded rik_* rows. Nothing here reads a real РИК site: the sync is not run.
const STAFF_EMAIL = 'rik.admin-e2e@example.com'
const SESSION = 'e2e-rik-admin-session'
const MIR = '29'
const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

function wranglerLocal(args: string[]) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', ...args], { cwd: WEB_DIR, stdio: 'pipe' }).toString()
    } catch (error) {
      const text = String((error as { stdout?: unknown }).stdout ?? '') + String((error as { stderr?: unknown }).stderr ?? '') + String(error)
      if (/constraint failed/i.test(text) || attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}

const CLEANUP = `
DELETE FROM signups WHERE id IN ('e2e-rik-admin', 'e2e-rik-a', 'e2e-rik-b');
DELETE FROM staff WHERE email = '${STAFF_EMAIL}';
DELETE FROM rik_status WHERE person_id IN ('e2e-rik-a', 'e2e-rik-b');
DELETE FROM rik_tasks WHERE id LIKE 'e2e-rik-%';
DELETE FROM rik_entries WHERE id LIKE 'e2e-rik-%';
`

function seed() {
  // The migration without its comments: wrangler reads a leading „--“ as a flag.
  const tables = readFileSync(new URL('../sql/2026-10-21-rik-registrations.sql', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
  const payload = (first: string, middle: string, last: string, email: string) => JSON.stringify({ firstName: first, middleName: middle, lastName: last, email, phone: '0888000111' })
  const sql = `${tables}
${CLEANUP}
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('e2e-rik-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2erikad', '${payload('Админ', '', 'РИК', STAFF_EMAIL)}', 1, 0, 1, '', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now')) ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, designation_mir, designation_number, designation_issued_at,
  designation_signed_at, created_at, updated_at)
VALUES
  ('e2e-rik-a', 'rik.a-e2e@example.com', 'e2e-rik-a-s', 'e2erika1', '${payload('Регистра', 'Първа', 'Тестова', 'rik.a-e2e@example.com')}', 1, 0, 1, '', '${MIR}', 901, '19.10.2026', '2026-10-19T09:00:00.000Z', datetime('now'), datetime('now')),
  ('e2e-rik-b', 'rik.b-e2e@example.com', 'e2e-rik-b-s', 'e2erikb1', '${payload('Регистра', 'Втора', 'Тестова', 'rik.b-e2e@example.com')}', 1, 0, 1, '', '${MIR}', 902, '19.10.2026', '2026-10-19T09:00:00.000Z', datetime('now'), datetime('now'));
INSERT INTO rik_sources (mir, name, base_url, contacts_url, phones, adapter, health, last_attempt_at, last_success_at, last_change_at, pages, batches, our_entries, updated_at)
VALUES ('${MIR}', 'Хасково', 'https://rik29.cik.bg/pvr2026', 'https://rik29.cik.bg/pvr2026/contacts', '0888 000 000', 'cik-platform/rik', 'ok',
  '2026-10-21T08:00:00.000Z', '2026-10-21T08:00:00.000Z', '2026-10-21T08:00:00.000Z', 3, 1, 2, '2026-10-21T08:00:00.000Z')
ON CONFLICT(mir) DO UPDATE SET health = 'ok', phones = '0888 000 000', pages = 3, batches = 1, our_entries = 2;
INSERT INTO rik_entries (id, mir, kind, ours, party, source_url, name, name_key, number_raw, number, number_date, annulled, first_seen_at, last_seen_at)
VALUES
  ('e2e-rik-ea', '${MIR}', 'representative', 1, 'ИК', 'https://rik29.cik.bg/pvr2026/registers/register_p?id=1', 'Регистра Първа Тестова', 'регистрапърватестова', '901/19.10.2026', 901, '19.10.2026', 0, 'now', 'now'),
  ('e2e-rik-eb', '${MIR}', 'representative', 1, 'ИК', 'https://rik29.cik.bg/pvr2026/registers/register_p?id=1', 'Регистра Втора Тестава', 'регистравторатестава', '902/19.10.2026', 902, '19.10.2026', 0, 'now', 'now');
INSERT INTO rik_status (person_id, source, mir, number, status, entry_id, detail, status_since, checked_at)
VALUES
  ('e2e-rik-a', 'signup', '${MIR}', 901, 'registered', 'e2e-rik-ea', '', '2026-10-21T08:00:00.000Z', '2026-10-21T08:00:00.000Z'),
  ('e2e-rik-b', 'signup', '${MIR}', 902, 'name_mismatch', 'e2e-rik-eb', 'РИК е публикувал „Регистра Втора Тестава“ под № 902.', '2026-10-21T08:00:00.000Z', '2026-10-21T08:00:00.000Z');
INSERT INTO rik_tasks (id, person_id, mir, type, reason, detail, active, created_at, updated_at)
VALUES ('e2e-rik-b:fix_data:name', 'e2e-rik-b', '${MIR}', 'fix_data', 'name', 'РИК е публикувал „Регистра Втора Тестава“ под № 902.', 1, '2026-10-21T08:00:00.000Z', '2026-10-21T08:00:00.000Z');
`
  wranglerLocal(['--command', sql])
}

test.describe('admin „РИК“ tab', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test.afterAll(() => {
    wranglerLocal(['--command', CLEANUP])
  })

  test('summary, people and tasks with URL filters and done/undo', async ({ page }) => {
    await page.context().addCookies([{ name: 'tb_session', value: SESSION, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    await page.goto(`/admin/rik?mir=${MIR}`)
    const root = page.getByTestId('rik-page')
    await expect(root.getByRole('heading', { name: 'РИК', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('navigation').getByRole('link', { name: 'РИК' })).toBeVisible()
    await expect(root.getByTestId('rik-task-counts')).toContainText('Поправи данните + ново пълномощно:')
    const summary = root.getByRole('row').filter({ hasText: 'Хасково' })
    await expect(summary).toContainText('0888 000 000')
    await expect(summary.getByRole('link', { name: 'Отвори регистъра' })).toHaveAttribute('href', 'https://rik29.cik.bg/pvr2026/registers/register_p')

    await root.getByRole('group', { name: 'Изглед' }).getByRole('button', { name: 'Хора' }).click()
    await expect(page).toHaveURL(/view=people/)
    const people = root.getByRole('region', { name: 'Хора' })
    await expect(people.getByRole('row').filter({ hasText: 'Регистра Първа Тестова' })).toContainText('Регистриран')
    // „Провери в РИК“ only next to someone not published yet (not clicked here: it would read the real РИК site).
    await expect(people.getByRole('row').filter({ hasText: 'Регистра Втора Тестова' }).getByRole('button', { name: /Провери в РИК/ })).toBeEnabled()
    await expect(people.getByRole('row').filter({ hasText: 'Регистра Първа Тестова' }).getByRole('button', { name: /Провери в РИК/ })).toHaveCount(0)
    await people.getByLabel('Статус').selectOption('problems')
    await expect(page).toHaveURL(/status=problems/)
    await expect(people.getByRole('row').filter({ hasText: 'Регистра Втора Тестова' })).toContainText('Различно име')
    await expect(people.getByRole('row').filter({ hasText: 'Регистра Първа Тестова' })).toHaveCount(0)

    await root.getByRole('group', { name: 'Изглед' }).getByRole('button', { name: 'Задачи' }).click()
    await expect(page).toHaveURL(/view=tasks/)
    const tasks = root.getByRole('region', { name: 'Задачи' })
    const task = tasks.getByRole('row').filter({ hasText: 'Регистра Втора Тестава' })
    await expect(task).toContainText('Поправи данните + ново пълномощно')
    await task.getByRole('button', { name: 'Готово' }).click()
    await expect(task).toHaveCount(0)
    await tasks.getByRole('group', { name: 'Кои задачи' }).getByRole('button', { name: 'Готови' }).click()
    await expect(page).toHaveURL(/show=done/)
    const done = tasks.getByRole('row').filter({ hasText: 'Регистра Втора Тестава' })
    await done.getByRole('button', { name: 'Върни' }).click()
    await expect(done).toHaveCount(0)
    await tasks.getByRole('group', { name: 'Кои задачи' }).getByRole('button', { name: 'Отворени' }).click()
    await expect(tasks.getByRole('row').filter({ hasText: 'Регистра Втора Тестава' }).getByRole('button', { name: 'Готово' })).toBeVisible()

    // A reload keeps the filters from the URL.
    await page.reload()
    await expect(page.getByLabel('МИР')).toHaveValue(MIR)
    await expect(root.getByRole('region', { name: 'Задачи' })).toBeVisible({ timeout: 30_000 })
  })

  test('needs a signed-in staff member', async ({ page }) => {
    await page.goto('/admin/rik')
    await expect(page.getByText('Регистра Втора Тестова')).toHaveCount(0)
  })
})
