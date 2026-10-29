import { execFileSync } from 'node:child_process'
import { expect, test, type Locator, type Page } from '@playwright/test'

// „Добави доброволец“ on Записвания: an editor adds a finished signup with names, ЕГН and place only.
// Synthetic data only.
const EDITOR_EMAIL = 'add-volunteer-editor-e2e@example.com'
const VIEWER_EMAIL = 'add-volunteer-viewer-e2e@example.com'
const EDITOR_SESSION = 'e2e-add-volunteer-editor'
const VIEWER_SESSION = 'e2e-add-volunteer-viewer'

function egn(stem: string) {
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...stem].reduce((total, digit, index) => total + Number(digit) * weights[index], 0)
  return `${stem}${(sum % 11) % 10}`
}
const EGN = egn('790303917')
const SWITCH_EGN = egn('790303925')
const SWITCH_EMAIL = 'switch-no-email-e2e@example.com'

function seed() {
  wranglerLocal([
    '--command',
    `DELETE FROM signups WHERE egn IN ('${EGN}', '${SWITCH_EGN}');
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, mir_code, created_at, updated_at)
VALUES ('e2e-switch-no-email', '${SWITCH_EMAIL}', 'e2e-switch-no-email', 'e2eswne1', '{"firstName":"Сменен","lastName":"Безимейлов","email":"${SWITCH_EMAIL}"}', 1, 0, 1, '${SWITCH_EGN}', '03', datetime('now'), datetime('now'));
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES
  ('e2e-add-vol-editor', '${EDITOR_EMAIL}', '${EDITOR_SESSION}', 'e2eaddve', '{"firstName":"Редактор","lastName":"Тестов","email":"${EDITOR_EMAIL}"}', 1, 0, 1, '', datetime('now'), datetime('now')),
  ('e2e-add-vol-viewer', '${VIEWER_EMAIL}', '${VIEWER_SESSION}', 'e2eaddvv', '{"firstName":"Зрител","lastName":"Тестов","email":"${VIEWER_EMAIL}"}', 1, 0, 1, '', datetime('now'), datetime('now'))
ON CONFLICT(email) DO UPDATE SET session_token = excluded.session_token, email_confirmed = 1, withdrawn = 0;
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${EDITOR_EMAIL}', 'editor', 'e2e', datetime('now')), ('${VIEWER_EMAIL}', 'viewer', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = excluded.role;`,
  ])
}

test.describe('Добави доброволец', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  // Other specs count finished signups, so leave nothing behind.
  test.afterAll(() => {
    wranglerLocal(['--command', `DELETE FROM signup_audit WHERE signup_id IN (SELECT id FROM signups WHERE egn IN ('${EGN}', '${SWITCH_EGN}'));
DELETE FROM signups WHERE egn IN ('${EGN}', '${SWITCH_EGN}');`])
  })

  test('a viewer does not get the button', async ({ page }) => {
    await signIn(page, VIEWER_SESSION)
    await page.goto('/admin/signups')
    await expect(page.getByRole('heading', { name: 'Записвания' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Добави доброволец' })).toHaveCount(0)
  })

  test('an editor adds a finished volunteer without e-mail; the same ЕГН is refused', async ({ page }) => {
    await signIn(page, EDITOR_SESSION)
    await page.goto('/admin/signups')
    await page.getByRole('button', { name: 'Добави доброволец' }).click()
    const dialog = page.getByRole('dialog', { name: 'Добави доброволец' })
    await dialog.getByLabel('Име', { exact: true }).fill('Пробен')
    await dialog.getByLabel('Презиме', { exact: true }).fill('Тестов')
    await dialog.getByLabel('Фамилия', { exact: true }).fill('Добавенов')
    await dialog.getByLabel('ЕГН', { exact: true }).fill(EGN)

    // The place is required before anything is written.
    await dialog.getByRole('button', { name: 'Добави като завършил' }).click()
    await expect(dialog.getByTestId('add-volunteer-result')).toContainText('Избери населеното място')

    // Neither an e-mail nor „Без имейл“: still nothing is written.
    await pickVarna(dialog)
    await dialog.getByRole('button', { name: 'Добави като завършил' }).click()
    await expect(dialog.getByTestId('add-volunteer-result')).toContainText('Попълни имейла или отбележи „Без имейл“')
    await dialog.getByRole('checkbox', { name: 'Без имейл' }).check()
    await expect(dialog.getByLabel('Имейл', { exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Добави като завършил' }).click()
    const result = dialog.getByTestId('add-volunteer-result')
    await expect(result).toContainText('Добавен е като завършил записването (МИР 03)')
    await expect(result).toContainText('Не е изпратено писмо')
    await expect(result.getByRole('link', { name: 'Отвори новия запис' })).toHaveAttribute('href', /\/admin\/signups\/[0-9a-f-]{36}$/)

    const saved = wranglerLocal(['--json', '--command', `SELECT email, role, submitted, email_confirmed, signup_mail_at, mir_code FROM signups WHERE egn = '${EGN}'`])
    expect(saved).toMatch(/bez-imeil-[a-z0-9]{8}@tibroish\.invalid/)
    expect(saved).toContain('"signup_mail_at": "skipped"')
    expect(saved).toContain('"mir_code": "03"')
    // No section needed: numbered by МИР straight away, so the пълномощно can be made.
    const numbered = wranglerLocal(['--json', '--command', `SELECT designation_mir, designation_number IS NOT NULL AS has_number, brevo_section_synced FROM signups WHERE egn = '${EGN}'`])
    expect(numbered).toContain('"designation_mir": "03"')
    expect(numbered).toContain('"has_number": 1')
    expect(numbered).toContain('"brevo_section_synced": null')
    const audit = wranglerLocal(['--json', '--command', `SELECT actor, field FROM signup_audit WHERE signup_id IN (SELECT id FROM signups WHERE egn = '${EGN}')`])
    expect(audit).toContain(`"actor": "${EDITOR_EMAIL}"`)

    // The form was cleared; the same person again is refused with a link to the record.
    await dialog.getByLabel('Име', { exact: true }).fill('Пробен')
    await dialog.getByLabel('Презиме', { exact: true }).fill('Тестов')
    await dialog.getByLabel('Фамилия', { exact: true }).fill('Добавенов')
    await dialog.getByLabel('ЕГН', { exact: true }).fill(EGN)
    await pickVarna(dialog)
    await dialog.getByRole('checkbox', { name: 'Без имейл' }).check()
    await dialog.getByRole('button', { name: 'Добави като завършил' }).click()
    await expect(result).toContainText('Вече има записване с това ЕГН')
    await expect(result.getByRole('link', { name: /Пробен Тестов Добавенов/ })).toBeVisible()
  })

  test('„Без имейл“ is marked on Записвания and on the person page', async ({ page }) => {
    await signIn(page, EDITOR_SESSION)
    await page.goto('/admin/signups?view=noemail&q=Добавенов')
    const row = page.getByRole('row', { name: /Добавенов/ }).first()
    await expect(row.getByTestId('no-email')).toBeVisible()
    await row.getByRole('link', { name: /Добавенов/ }).first().click()
    await expect(page.getByTestId('no-email').first()).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Без имейл' })).toBeChecked()
  })
})


test.describe('„Без имейл“ on the person page', () => {
  test.beforeAll(() => seed())
  test.afterAll(() => {
    wranglerLocal(['--command', `DELETE FROM signup_audit WHERE signup_id = 'e2e-switch-no-email';
DELETE FROM signups WHERE id = 'e2e-switch-no-email';`])
  })

  test('an editor switches a volunteer to no e-mail: logged out, numbered by МИР', async ({ page }) => {
    await signIn(page, EDITOR_SESSION)
    await page.goto('/admin/signups/e2e-switch-no-email')
    await expect(page.getByText(SWITCH_EMAIL).first()).toBeVisible()
    await page.getByRole('checkbox', { name: 'Без имейл' }).check()
    await page.getByRole('button', { name: 'Запиши имейла' }).click()
    await expect(page.getByTestId('no-email').first()).toBeVisible()

    const saved = wranglerLocal(['--json', '--command', `SELECT email, session_token, designation_mir, designation_number IS NOT NULL AS has_number FROM signups WHERE id = 'e2e-switch-no-email'`])
    expect(saved).toMatch(/bez-imeil-[a-z0-9]{8}@tibroish\.invalid/)
    expect(saved).toContain('"session_token": null')
    expect(saved).toContain('"designation_mir": "03"')
    expect(saved).toContain('"has_number": 1')
    const audit = wranglerLocal(['--json', '--command', `SELECT field, after_text FROM signup_audit WHERE signup_id = 'e2e-switch-no-email' AND field = 'email'`])
    expect(audit).toContain('"after_text": "без имейл"')
    expect(audit).not.toContain(SWITCH_EMAIL)
  })
})

/** Област, община and town Варна from the real places API. */
async function pickVarna(dialog: Locator) {
  await dialog.getByRole('combobox', { name: 'Област', exact: true }).selectOption({ label: 'Варна' })
  await dialog.getByRole('combobox', { name: 'Община', exact: true }).selectOption({ label: 'Варна' })
  const town = dialog.getByRole('combobox', { name: 'Населено място', exact: true })
  const option = town.locator('option', { hasText: /^(гр\.\s*)?Варна$/ }).first()
  await expect(option).toBeAttached()
  await town.selectOption((await option.getAttribute('value')) ?? '')
}

async function signIn(page: Page, session: string) {
  await page.context().addCookies([{ name: 'tb_session', value: session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
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
