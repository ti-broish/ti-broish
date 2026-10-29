import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

// „И аз“ person page: staff edit the data, МИР and section; publishing numbers the пълномощно in the
// section's МИР and puts it in „Само новите“ for signing. Nothing is mailed, nothing goes to our Brevo.
const STAFF_EMAIL = 'iaz.edit-admin-e2e@example.com'
const SESSION = 'e2e-iaz-edit-session'
const PARTNER_ID = 'pp-e2e-edit-mila'
const SECTION = '259990177'

function egn(stem: string) {
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...stem].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0)
  return `${stem}${(sum % 11) % 10}`
}
const MILA_EGN = egn('880808177')

function seed() {
  d1(`DELETE FROM signup_audit WHERE signup_id = '${PARTNER_ID}';
DELETE FROM partner_people WHERE id = '${PARTNER_ID}';
DELETE FROM taken_sections WHERE section_code = '${SECTION}';
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('e2e-iaz-edit-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2eiazed', '{"firstName":"Админ","lastName":"Редакция","email":"${STAFF_EMAIL}"}', 1, 0, 1, '', datetime('now'), datetime('now'))
ON CONFLICT(email) DO UPDATE SET session_token = excluded.session_token, email_confirmed = 1;
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO partner_people (id, partner, egn, email, phone, first_name, middle_name, last_name, region_code, region_name, municipality_name, place_note,
  designation_mir, imported_at, updated_at)
VALUES ('${PARTNER_ID}', 'iaz.bg', '${MILA_EGN}', 'mila.edit-e2e@example.com', '0888123456', 'Мила', '', 'Редакторова', 'sofia', 'София-град', 'Столична', '',
  '24', '2026-10-19T20:44:21.000Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`)
}

test.describe('„И аз“ person: edit and publish', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  // Other specs count every „И аз“ person and section, so leave nothing behind.
  test.afterAll(() => {
    d1(`DELETE FROM signup_audit WHERE signup_id = '${PARTNER_ID}';
DELETE FROM partner_people WHERE id = '${PARTNER_ID}';
DELETE FROM taken_sections WHERE section_code = '${SECTION}';`)
  })

  test('edit the data, then a published section numbers the пълномощно', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/admin/iaz/${PARTNER_ID}`)
    const edit = page.getByTestId('iaz-edit')
    await expect(edit.getByRole('heading', { name: 'Редактирай' })).toBeVisible({ timeout: 30_000 })

    // Data: middle name (rename path, unnumbered: nothing to re-sign), phone and place.
    await edit.getByLabel('Презиме').fill('Петрова')
    await edit.getByLabel('Телефон').fill('+359 888 654 321')
    await edit.getByLabel('Място (от „И аз“)').fill('кв. Тестов')
    await edit.getByRole('button', { name: 'Запази данните' }).click()
    await expect(page.getByTestId('iaz-edit-message')).toContainText('Записано: Презиме, Телефон, Място (от „И аз“).')
    await expect(page.getByTestId('iaz-person')).toContainText('0888654321')
    await expect(page.getByTestId('iaz-person')).toContainText('кв. Тестов')
    await expect(page.getByRole('heading', { name: 'Мила Петрова Редакторова' })).toBeVisible()
    expect(d1(`SELECT middle_name, phone, place_note FROM partner_people WHERE id = '${PARTNER_ID}'`)[0]).toEqual({ middle_name: 'Петрова', phone: '0888654321', place_note: 'кв. Тестов' })
    await expect(page.getByTestId('iaz-history')).toContainText('partner_phone: „0888123456“ → „0888654321“')

    // Bad input is refused and nothing changes.
    await edit.getByLabel('Имейл').fill('not-an-email')
    await edit.getByLabel('Имейл').evaluate((input) => input.removeAttribute('type'))
    await edit.getByRole('button', { name: 'Запази данните' }).click()
    await expect(page.getByTestId('iaz-edit-message')).toContainText('Имейл: имейлът не е валиден.')
    expect(d1(`SELECT email FROM partner_people WHERE id = '${PARTNER_ID}'`)[0]).toEqual({ email: 'mila.edit-e2e@example.com' })
    await edit.getByRole('button', { name: 'Откажи' }).first().click()

    // МИР before numbering.
    await edit.getByLabel('МИР').selectOption('23')
    await edit.getByRole('button', { name: 'Запази МИР' }).click()
    await expect(page.getByTestId('iaz-edit-message')).toContainText('МИР 23 е записан.')

    // Section in МИР 25: draft, publish → МИР follows the section, numbered, waiting for the signing ZIP.
    // The panel remounts after the МИР save reloads the person; fill again if that reset the field.
    await expect(async () => {
      await edit.getByLabel(/Секция \(чернова/).fill(SECTION)
      await edit.getByRole('button', { name: 'Запази черновата' }).click({ timeout: 3_000 })
    }).toPass({ timeout: 30_000 })
    await expect(page.getByTestId('iaz-edit-message')).toContainText(`Чернова ${SECTION} е запазена.`)
    await expect(async () => {
      await edit.getByRole('button', { name: 'Публикувай', exact: true }).click()
      await expect(page.getByTestId('iaz-edit-message')).toContainText('Напред: Номерирани 1 (от тях „И аз“ 1)', { timeout: 5_000 })
    }).toPass({ timeout: 40_000 })
    await expect(page.getByTestId('iaz-edit-message')).toContainText('Без писма.')
    const row = d1(`SELECT section_published, designation_mir, designation_number, designation_signing_generated_at FROM partner_people WHERE id = '${PARTNER_ID}'`)[0]!
    expect(row).toMatchObject({ section_published: SECTION, designation_mir: '25', designation_signing_generated_at: null })
    expect(row.designation_number).not.toBeNull()
    await expect(page.getByTestId('iaz-person')).toContainText(`№ 25/${row.designation_number}`)
    await expect(page.getByTestId('iaz-person')).toContainText(`Публикувана ${SECTION}`)
    // Numbered: МИР is fixed now.
    await expect(edit.getByText('МИР 25 (не се сменя след номериране).')).toBeVisible()

    // „Придвижи публикуваните“ is a no-op now (already numbered) and says so.
    await page.goto('/admin/palnomoshtni')
    await expect(page.getByTestId('pipeline-counts')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('advance-published').click()
    await expect(page.getByText(/Напред: Номерирани 0;/)).toBeVisible({ timeout: 30_000 })
    expect(d1(`SELECT designation_number FROM partner_people WHERE id = '${PARTNER_ID}'`)[0]).toEqual({ designation_number: row.designation_number })
  })

  test('„Отпиши“ frees the section and keeps the number; „Отписани“ lists them; „Върни“ restores', async ({ page }) => {
    test.setTimeout(120_000)
    const before = d1(`SELECT designation_mir, designation_number FROM partner_people WHERE id = '${PARTNER_ID}'`)[0]!
    expect(before.designation_number).not.toBeNull()
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/admin/iaz/${PARTNER_ID}`)
    await expect(page.getByRole('heading', { name: 'Отпиши', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('iaz-person')).toContainText(`Публикувана ${SECTION}`)
    await expect(page.getByRole('button', { name: 'Отпиши', exact: true })).toBeDisabled()
    await page.locator('#iaz-withdraw-reason').selectOption({ label: 'Друго' })
    await page.locator('#iaz-withdraw-note').fill('само видеонаблюдение')
    let confirmText = ''
    page.once('dialog', (dialog) => {
      confirmText = dialog.message()
      void dialog.accept()
    })
    await page.getByRole('button', { name: 'Отпиши', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Отписан', exact: true })).toBeVisible({ timeout: 30_000 })
    expect(confirmText).toContain(`Секция ${SECTION} се освобождава.`)
    await expect(page.getByText(`Предишна секция: ${SECTION} (не се връща автоматично)`)).toBeVisible()
    await expect(page.getByText(/Друго · само видеонаблюдение · iaz\.edit-admin-e2e@example\.com/)).toBeVisible()
    await expect(page.getByTestId('iaz-person')).toContainText('Без секция')
    await expect(page.getByTestId('iaz-person')).toContainText(`№ ${before.designation_mir}/${before.designation_number}`)
    await expect(page.getByText(/withdrawn: „/).first()).toBeVisible()
    expect(d1(`SELECT section_draft, section_published, designation_number, withdrawn_by, withdrawn_reason FROM partner_people WHERE id = '${PARTNER_ID}'`)[0]).toEqual({
      section_draft: null,
      section_published: null,
      designation_number: before.designation_number,
      withdrawn_by: STAFF_EMAIL,
      withdrawn_reason: 'Друго · само видеонаблюдение',
    })

    await page.goto('/admin/signups?view=withdrawn')
    const row = page.getByRole('row').filter({ hasText: 'mila.edit-e2e@example.com' })
    await expect(row).toHaveCount(1, { timeout: 30_000 })
    await expect(row.getByText('Отписан', { exact: true })).toBeVisible()
    await page.goto('/admin/signups?view=all&source=iaz')
    await expect(page.getByRole('row').filter({ hasText: 'mila.edit-e2e@example.com' })).toHaveCount(0, { timeout: 30_000 })

    await page.goto(`/admin/iaz/${PARTNER_ID}`)
    await page.getByRole('button', { name: 'Върни', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Отпиши', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('iaz-edit-message')).toContainText(`Предишната секция ${SECTION} не се връща автоматично.`)
    await expect(page.getByTestId('iaz-person')).toContainText('Без секция')
    expect(d1(`SELECT withdrawn_at, designation_number FROM partner_people WHERE id = '${PARTNER_ID}'`)[0]).toEqual({ withdrawn_at: null, designation_number: before.designation_number })
    expect(d1(`SELECT field FROM signup_audit WHERE signup_id = '${PARTNER_ID}' AND field IN ('withdrawn', 'restored') ORDER BY created_at`).map((r) => r.field)).toEqual(['withdrawn', 'restored'])
  })
})

async function signIn(page: Page) {
  await page.context().addCookies([{ name: 'tb_session', value: SESSION, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
}

const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

function d1(sql: string): Array<Record<string, unknown>> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', '--json', '--command', sql], { cwd: WEB_DIR, stdio: 'pipe' }).toString()
      const parsed = JSON.parse(output.slice(output.indexOf('['))) as Array<{ results?: Array<Record<string, unknown>> }>
      return parsed.flatMap((item) => item.results ?? [])
    } catch (error) {
      const text = String((error as { stdout?: unknown }).stdout ?? '') + String((error as { stderr?: unknown }).stderr ?? '') + String(error)
      if (!/SQLITE_BUSY|database is locked/.test(text) || attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}
