import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

// Same ЕГН already numbered in another МИР: saving a section shows the warning with that number and
// МИР and needs an explicit confirm; the server refuses without it. The same МИР stays silent.
// Numbered people without a section show „без секция“ on /admin/palnomoshtni.
const STAFF_EMAIL = 'other-mir-admin-e2e@example.com'
const SESSION = 'e2e-other-mir-session'
const PARTNER_ID = 'pp-e2e-other-mir'
const HOLDER_ID = 'e2e-other-mir-holder'
const OTHER_MIR_SECTION = '049990188'
const SAME_MIR_SECTION = '259990188'

function egn(stem: string) {
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...stem].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0)
  return `${stem}${(sum % 11) % 10}`
}
const SHARED_EGN = egn('870707188')

function cleanup() {
  d1(`DELETE FROM signup_audit WHERE signup_id IN ('${PARTNER_ID}', '${HOLDER_ID}');
DELETE FROM partner_people WHERE id = '${PARTNER_ID}';
DELETE FROM signups WHERE id = '${HOLDER_ID}';`)
}

function seed() {
  cleanup()
  d1(`INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('e2e-other-mir-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2eothmr', '{"firstName":"Админ","lastName":"МИР","email":"${STAFF_EMAIL}"}', 1, 0, 1, '', datetime('now'), datetime('now'))
ON CONFLICT(email) DO UPDATE SET session_token = excluded.session_token, email_confirmed = 1;
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO signups (id, email, referral_code, payload, email_confirmed, withdrawn, submitted, egn, designation_mir, designation_number, designation_issued_at, created_at, updated_at)
VALUES ('${HOLDER_ID}', 'other-mir-holder-e2e@example.com', 'e2eothhd', '{"firstName":"Бойко","lastName":"Безсекционов"}', 1, 0, 1, '${SHARED_EGN}', '25', 777, '29.10.2026', datetime('now'), datetime('now'));
INSERT INTO partner_people (id, partner, egn, email, phone, first_name, middle_name, last_name, region_code, region_name, municipality_name, place_note,
  designation_mir, imported_at, updated_at)
VALUES ('${PARTNER_ID}', 'iaz.bg', '${SHARED_EGN}', 'other-mir-e2e@example.com', '0888123188', 'Бойко', '', 'Безсекционов', 'sofia', 'София-град', 'Столична', '',
  '04', '2026-10-19T20:44:21.000Z', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`)
}

test.describe('same ЕГН numbered in another МИР', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test.afterAll(() => cleanup())

  test('warns with the number and МИР, saves only on confirm; same МИР is silent', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/admin/iaz/${PARTNER_ID}`)
    const edit = page.getByTestId('iaz-edit')
    await expect(edit.getByRole('heading', { name: 'Редактирай' })).toBeVisible({ timeout: 30_000 })
    const field = edit.getByLabel(/Секция \(чернова/)
    const save = edit.getByRole('button', { name: 'Запази черновата' })
    const dialogs: string[] = []

    // Another МИР, declined: nothing saved (the server refused without the confirm flag).
    page.once('dialog', (dialog) => {
      dialogs.push(dialog.message())
      void dialog.dismiss()
    })
    await field.fill(OTHER_MIR_SECTION)
    await save.click()
    await expect(page.getByTestId('iaz-edit-message')).toContainText('Не е записано.', { timeout: 15_000 })
    expect(dialogs[0]).toContain('Внимание: това ЕГН вече има пълномощно № 777 за МИР 25 (доброволец).')
    expect(dialogs[0]).toContain(`Секция ${OTHER_MIR_SECTION} е в МИР 04 — пълномощното не важи там.`)
    expect(dialogs[0]).toContain('Да запиша ли въпреки това?')
    expect(d1(`SELECT section_draft FROM partner_people WHERE id = '${PARTNER_ID}'`)[0]).toEqual({ section_draft: null })

    // Confirmed: saved.
    page.once('dialog', (dialog) => {
      dialogs.push(dialog.message())
      void dialog.accept()
    })
    await expect(async () => {
      await field.fill(OTHER_MIR_SECTION)
      await save.click({ timeout: 3_000 })
      await expect(page.getByTestId('iaz-edit-message')).toContainText(`Чернова ${OTHER_MIR_SECTION} е запазена.`, { timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
    expect(dialogs).toHaveLength(2)
    expect(d1(`SELECT section_draft, designation_mir FROM partner_people WHERE id = '${PARTNER_ID}'`)[0]).toEqual({ section_draft: OTHER_MIR_SECTION, designation_mir: '04' })

    // Same МИР as the number: no prompt at all.
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message())
      void dialog.dismiss()
    })
    await expect(async () => {
      await field.fill(SAME_MIR_SECTION)
      await save.click({ timeout: 3_000 })
      await expect(page.getByTestId('iaz-edit-message')).toContainText(`Чернова ${SAME_MIR_SECTION} е запазена.`, { timeout: 5_000 })
    }).toPass({ timeout: 30_000 })
    expect(dialogs).toHaveLength(2)
    // The unnumbered „И аз“ МИР follows the section (mir-from-section triggers), with an audit line.
    expect(d1(`SELECT designation_mir, designation_number FROM partner_people WHERE id = '${PARTNER_ID}'`)[0]).toEqual({ designation_mir: '25', designation_number: null })
    expect(d1(`SELECT actor, before_text, after_text FROM signup_audit WHERE signup_id = '${PARTNER_ID}' AND field = 'mir'`)).toEqual([
      { actor: 'system (МИР от секцията)', before_text: '04', after_text: '25' },
    ])

    // The numbered volunteer without a section is listed and counted, shown „без секция“.
    await page.goto('/admin/palnomoshtni')
    const holderRow = page.getByRole('row', { name: /Бойко Безсекционов/ }).filter({ hasText: '777' })
    await expect(holderRow.getByTestId('no-section')).toHaveText('без секция', { timeout: 30_000 })
    await expect(page.getByTestId('pipeline-counts')).toContainText('от тях без секция')
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
