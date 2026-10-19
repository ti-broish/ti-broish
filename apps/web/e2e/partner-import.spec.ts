import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

const STAFF_EMAIL = 'iaz.admin-e2e@example.com'
const SESSION = 'e2e-iaz-admin-session'

function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

const EXISTING_EGN = egn(81, 6, 6, 606)
const SAMPLE = [
  'Име;Имейл;ЕГН;Телефон;Област;Общини;IP;Подадено',
  `Тодор Иванов Пробов;iaz.one-e2e@example.com;${egn(88, 1, 2, 101)};888100101;Бургас;Бургас, Созопол;198.51.100.1;19 окт 2026 · 7:21`,
  `Сия Петрова Пробова;IAZ.two-e2e@example.com;${egn(5, 44, 4, 202).replace(/^0+/, '')};359888100202;София град;Младост 3;198.51.100.2;18 окт 2026 · 20:31`,
  `Тодор Иванов Пробов;iaz.one-e2e@example.com;${egn(88, 1, 2, 101)};888100101;Бургас;Бургас;198.51.100.1;15 окт 2026 · 8:53`,
  `Вече Записан Човек;iaz.existing-e2e@example.com;${EXISTING_EGN};888100303;Варна;Варна;198.51.100.3;17 окт 2026 · 3:33`,
  `Грешен Телефон Човек;iaz.badphone-e2e@example.com;${egn(77, 7, 7, 707)};6312345;Русе;Русе;198.51.100.4;16 окт 2026 · 9:00`,
  `Грешно Егн Човек;iaz.badegn-e2e@example.com;1234567890;888100505;Шумен;Шумен;198.51.100.5;16 окт 2026 · 9:10`,
].join('\n')

test.describe('partner import („И аз“)', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test('admin previews the file, confirms, filters „И аз“, and a second upload adds nobody', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/admin/signups')
    await openTools(page)
    const input = page.getByLabel('CSV от „И аз“')
    await input.setInputFiles({ name: 'i-az.csv', mimeType: 'text/csv', buffer: Buffer.from(`\uFEFF${SAMPLE}`, 'utf8') })

    const preview = page.getByTestId('partner-import-preview')
    await expect(preview.getByText('Проверка без запис')).toBeVisible()
    const summary = preview.getByRole('list', { name: 'Обобщение' })
    await expect(summary).toContainText('Нови: 2')
    await expect(summary).toContainText('Вече записани (само етикет): 1')
    await expect(summary).toContainText('Повторени във файла: 1')
    await expect(summary).toContainText('Невалидни: 2')
    await expect(preview).toContainText('телефонът не е валиден')
    await expect(preview).toContainText('ЕГН не е валидно')
    await expect(preview).toContainText('Как се попълват полетата')
    // ЕГН is masked in the preview.
    await expect(preview).not.toContainText(EXISTING_EGN)
    await expect(preview).toContainText(`******${EXISTING_EGN.slice(-4)}`)

    await preview.getByRole('button', { name: /Потвърди вноса \(2 нови, 1 с етикет\)/ }).click()
    await expect(page.getByText('Готово. Внесени 2 нови, отбелязани 1 вече записани. Писма не са пращани.')).toBeVisible()

    await page.getByRole('button', { name: 'И аз', exact: true }).click()
    await expect(page).toHaveURL(/view=iaz/)
    const table = page.locator('table').first()
    await expect(table.getByRole('link', { name: 'Тодор Иванов Пробов' })).toBeVisible()
    await expect(table.getByRole('link', { name: 'Сия Петрова Пробова' })).toBeVisible()
    await expect(table.getByRole('link', { name: 'Стара Собствена Фамилия' })).toBeVisible()
    await expect(table.getByText('0888100202')).toBeVisible()
    await expect(table.getByText('И аз', { exact: true }).first()).toBeVisible()
    await expect(table.getByRole('link', { name: 'Грешен Телефон Човек' })).toHaveCount(0)
    // The existing signup keeps its own data.
    await expect(table.getByText('0899999999')).toBeVisible()
    await expect(table.getByRole('link', { name: 'Вече Записан Човек' })).toHaveCount(0)

    await openTools(page)
    await page.getByLabel('CSV от „И аз“').setInputFiles({ name: 'i-az.csv', mimeType: 'text/csv', buffer: Buffer.from(SAMPLE, 'utf8') })
    await expect(summary).toContainText('Нови: 0')
    await expect(summary).toContainText('Вече с „И аз“: 3')
    await expect(preview.getByRole('button', { name: /Потвърди вноса/ })).toBeDisabled()
  })
})

async function openTools(page: Page) {
  const tools = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Инструменти' }) })
  if (!(await tools.evaluate((element) => (element as HTMLDetailsElement).open))) await tools.locator('summary').first().click()
}

async function signIn(page: Page) {
  await page.context().addCookies([{ name: 'tb_session', value: SESSION, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
}

function seed() {
  const sql = `
DELETE FROM signups WHERE email IN ('iaz.one-e2e@example.com', 'iaz.two-e2e@example.com');
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES
  ('e2e-iaz-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2eiazad', '{"firstName":"Админ","lastName":"Иаз","email":"${STAFF_EMAIL}","phone":"0888000999"}', 1, 0, 1, '', datetime('now'), datetime('now')),
  ('e2e-iaz-existing', 'iaz.existing-e2e@example.com', 'e2e-iaz-existing-session', 'e2eiazex', '{"firstName":"Стара","middleName":"Собствена","lastName":"Фамилия","email":"iaz.existing-e2e@example.com","phone":"0899999999"}', 1, 0, 1, '${EXISTING_EGN}', datetime('now'), datetime('now'))
ON CONFLICT(email) DO UPDATE SET session_token = excluded.session_token, payload = excluded.payload, email_confirmed = 1, egn = excluded.egn, partner = NULL, partner_submitted_at = NULL, partner_imported_at = NULL;
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';
`
  for (let attempt = 1; ; attempt += 1) {
    try {
      execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', '--command', sql], {
        cwd: new URL('.', import.meta.url).pathname.replace(/e2e\/$/, ''),
        stdio: 'pipe',
      })
      return
    } catch (error) {
      const text = String((error as { stdout?: unknown }).stdout ?? '') + String((error as { stderr?: unknown }).stderr ?? '') + String(error)
      if (!/SQLITE_BUSY|database is locked/.test(text) || attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}
