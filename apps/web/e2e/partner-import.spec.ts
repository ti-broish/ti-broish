import { execFileSync } from 'node:child_process'
import { expect, test, type Locator, type Page } from '@playwright/test'

const STAFF_EMAIL = 'iaz.admin-e2e@example.com'
const SESSION = 'e2e-iaz-admin-session'

function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

const EXISTING_EGN = egn(81, 6, 6, 606)
const TODOR_EGN = egn(88, 1, 2, 101)
const SAMPLE_EGNS = [TODOR_EGN, egn(5, 44, 4, 202), EXISTING_EGN, egn(77, 7, 7, 707), egn(66, 6, 16, 616)]
const SAMPLE = [
  'Име;Имейл;ЕГН;Телефон;Област;Общини;IP;Подадено',
  `Тодор Иванов Пробов;iaz.one-e2e@example.com;${TODOR_EGN};888100101;Бургас;Бургас, Созопол;198.51.100.1;19 окт 2026 · 7:21`,
  `Сия Петрова Пробова;IAZ.two-e2e@example.com;${egn(5, 44, 4, 202).replace(/^0+/, '')};359888100202;София град;Младост 3;198.51.100.2;18 окт 2026 · 20:31`,
  `Тодор Иванов Пробов;iaz.one-e2e@example.com;${TODOR_EGN};888100101;Бургас;Бургас;198.51.100.1;15 окт 2026 · 8:53`,
  `Вече Записан Човек;iaz.existing-e2e@example.com;${EXISTING_EGN};888100303;Варна;Варна;198.51.100.3;17 окт 2026 · 3:33`,
  `Грешен Телефон Човек;iaz.badphone-e2e@example.com;${egn(77, 7, 7, 707)};6312345;Русе;Русе;198.51.100.4;16 окт 2026 · 9:00`,
  `Без Район Човек;iaz.sofia-e2e@example.com;${egn(66, 6, 16, 616)};888100606;София град;София;198.51.100.6;16 окт 2026 · 9:05`,
  `Грешно Егн Човек;iaz.badegn-e2e@example.com;1234567890;888100505;Шумен;Шумен;198.51.100.5;16 окт 2026 · 9:10`,
].join('\n')

test.describe('partner import („И аз“) for пълномощни only', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test('previews, imports into the „И аз“ list, numbers with signups, zips, and a second upload adds nobody', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 900 })
    // Записани only links to the import.
    await page.goto('/admin/signups')
    await openTools(page)
    await expect(page.getByLabel('CSV от „И аз“')).toHaveCount(0)
    await page.getByRole('link', { name: 'Пълномощни → Внос от „И аз“' }).click()
    await expect(page).toHaveURL(/\/admin\/palnomoshtni#i-az/)

    const input = page.getByLabel('CSV от „И аз“')
    await input.setInputFiles({ name: 'i-az.csv', mimeType: 'text/csv', buffer: Buffer.from(`\uFEFF${SAMPLE}`, 'utf8') })
    const preview = page.getByTestId('partner-import-preview')
    await expect(preview.getByText('Проверка без запис')).toBeVisible()
    const summary = preview.getByRole('list', { name: 'Обобщение' })
    await expect(summary).toContainText('Нови: 5')
    await expect(summary).toContainText('Вече внесени (дубликати): 0')
    await expect(summary).toContainText('Повторени във файла: 1')
    await expect(summary).toContainText('Невалидни: 1')
    await expect(summary).toContainText('И записани доброволци: 1')
    await expect(summary).toContainText('Нови без МИР: 1')
    await expect(preview).toContainText('ЕГН не е валидно')
    await expect(preview).not.toContainText(EXISTING_EGN)
    await expect(preview).toContainText(`******${EXISTING_EGN.slice(-4)}`)

    await preview.getByRole('button', { name: 'Потвърди вноса (5 нови)' }).click()
    await expect(page.getByText('Готово. Внесени 5 нови в „И аз“. Писма не са пращани, нищо не е пратено към Brevo.')).toBeVisible()

    // Nobody became a signup; the existing signup is untouched.
    expect(d1(`SELECT COUNT(*) AS n FROM signups WHERE email LIKE 'iaz.%-e2e@example.com' AND id != 'e2e-iaz-admin'`)[0]).toMatchObject({ n: 1 })
    expect(d1(`SELECT COUNT(*) AS n FROM partner_people WHERE email LIKE 'iaz.%-e2e@example.com'`)[0]).toMatchObject({ n: 5 })
    expect(d1(`SELECT json_extract(payload, '$.phone') AS phone FROM signups WHERE id = 'e2e-iaz-existing'`)[0]).toMatchObject({ phone: '0899999999' })

    const status = page.getByTestId('partner-counts')
    await expect(status).toContainText('„И аз“ (не са записани доброволци и не отиват в Brevo): 5 души')
    await expect(status).toContainText('без МИР 1')
    const row = page.getByRole('row').filter({ hasText: 'Без Район Човек' })
    await expect(row.getByText('И аз', { exact: true })).toBeVisible()
    await row.getByLabel('МИР за пълномощното').selectOption('24')
    await expect(page.getByText('МИР 24 е записан.')).toBeVisible()
    await expect(status).not.toContainText('без МИР')

    await page.getByRole('button', { name: 'Номерирай' }).click()
    await expect(status).toContainText('номерирани 5')
    const todor = page.getByRole('row').filter({ hasText: 'Тодор Иванов Пробов' })
    // „И аз“ people have no admin profile: plain name with the badge, never a signup link.
    await expect(todor.getByRole('link')).toHaveCount(0)
    await expect(todor.getByText('И аз', { exact: true })).toBeVisible()
    await expect(todor.getByRole('cell').first()).toHaveText(/^\d{3,}$/)
    await expect(todor.getByRole('cell').nth(3)).toHaveText('02')

    // Numbers are shared with signups per МИР: no number appears twice in one МИР.
    const clashes = d1(`SELECT designation_mir AS mir, designation_number AS n, COUNT(*) AS c FROM (
      SELECT designation_mir, designation_number FROM signups WHERE designation_number IS NOT NULL
      UNION ALL SELECT designation_mir, designation_number FROM partner_people WHERE designation_number IS NOT NULL
    ) GROUP BY designation_mir, designation_number HAVING COUNT(*) > 1`)
    expect(clashes).toEqual([])

    await expect(page.getByRole('link', { name: 'Изтегли ZIP „И аз“ 1–5' })).toBeVisible()
    const only = await page.request.get('/admin/palnomoshtni/zip?partner=1&offset=0&limit=50')
    expect(only.status()).toBe(200)
    const onlyText = (await only.body()).toString('utf8')
    expect((onlyText.match(/^pp-/gm) ?? []).length + (onlyText.match(/,pp-/g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(onlyText).not.toMatch(/,e2e-/)
    const zip = await page.request.get('/admin/palnomoshtni/zip?mir=02&offset=0&limit=50')
    expect(zip.status()).toBe(200)
    const body = await zip.body()
    // Same naming as signups: МИР_НОМЕР_ИМЕ_ПРЕЗИМЕ_ФАМИЛИЯ.pdf; the manifest has no section for „И аз“.
    expect(body.toString('utf8')).toMatch(/02_\d+_Тодор_Иванов_Пробов\.pdf/)
    expect(body.toString('utf8')).toMatch(/,\d+,,02,Тодор Иванов Пробов/)

    await page.getByLabel('CSV от „И аз“').setInputFiles({ name: 'i-az.csv', mimeType: 'text/csv', buffer: Buffer.from(SAMPLE, 'utf8') })
    await expect(summary).toContainText('Нови: 0')
    await expect(summary).toContainText('Вече внесени (дубликати): 5')
    await expect(preview.getByRole('button', { name: /Потвърди вноса/ })).toBeDisabled()
  })

  test('„И аз“ — секции: drafts in the reach, publish reserves as „И аз“, one quota per section, no mail', async ({ page }) => {
    // Two full /admin/sections loads plus publish on the one shared dev server; in CI the other worker runs the
    // country distribute (real section API, 120s budget) at the same time, so 30s is not enough there.
    test.setTimeout(180_000)
    // Priority sections next to every partner person (named by municipality), so no section API call is needed.
    const places = d1(`SELECT DISTINCT designation_mir AS mir, municipality_name AS muni FROM partner_people WHERE COALESCE(designation_mir, '') != ''`) as Array<{ mir: string; muni: string }>
    expect(places.length).toBeGreaterThan(0)
    const rows: string[] = []
    places.forEach((place, index) => {
      for (let n = 1; n <= 3; n += 1) {
        rows.push(`('${place.mir}99${String(index).padStart(2, '0')}00${n}', 'Е2Е', '${place.muni.replace(/'/g, "''")}', 'Е2Е', ${10 - n}, 'watch', '{}', datetime('now'))`)
      }
    })
    const held = `${places[0]!.mir}9900001`
    wranglerLocal([
      '--command',
      `DELETE FROM priority_sections WHERE town = 'Е2Е';
       UPDATE partner_people SET section_draft = NULL, section_published = NULL, section_draft_locked = 0 WHERE email LIKE 'iaz.%-e2e@example.com';
       DELETE FROM taken_sections WHERE section_code LIKE '__99%';
       INSERT INTO priority_sections (section_code, town, municipality, oblast, r, level, components, updated_at) VALUES ${rows.join(', ')};
       UPDATE signups SET draft_section = '${held}' WHERE id = 'e2e-iaz-existing';`,
    ])
    try {
      await signIn(page)
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.goto('/admin/sections')
      const panel = page.getByTestId('partner-sections-panel')
      await openDetails(panel)
      await panel.getByRole('button', { name: 'Преглед за „И аз“' }).click()
      // The planner reads every section in each person's reach from the public API: allow for it.
      await expect(panel.getByTestId('partner-sections-preview')).toContainText('Преглед (нищо не е записано)', { timeout: 60_000 })
      expect(d1(`SELECT COUNT(*) AS n FROM partner_people WHERE COALESCE(section_draft, '') != ''`)[0]).toMatchObject({ n: 0 })

      await panel.getByTestId('partner-sections-distribute').click()
      await panel.getByTestId('partner-sections-distribute').click()
      await expect(page.getByText(/Записани чернови \d+/)).toBeVisible({ timeout: 60_000 })
      const drafts = d1(`SELECT designation_mir AS mir, region_code AS region, section_draft AS code, section_published AS published FROM partner_people WHERE email LIKE 'iaz.%-e2e@example.com' AND email != 'iaz.existing-e2e@example.com' AND COALESCE(designation_mir, '') != ''`) as Array<{ mir: string; region: string; code: string | null; published: string | null }>
      // Also our volunteer with a section (same ЕГН/email as a signup with a draft): no „И аз“ draft.
      expect(d1(`SELECT COUNT(*) AS n FROM partner_people WHERE email = 'iaz.existing-e2e@example.com' AND COALESCE(section_draft, '') != ''`)[0]).toMatchObject({ n: 0 })
      expect(drafts.length).toBeGreaterThan(0)
      for (const row of drafts) {
        // The reach is the whole Област from the file: София-град is МИР 23, 24 and 25.
        const reach = row.region === 'sofia-merged' ? ['23', '24', '25'] : [row.mir]
        expect(reach).toContain(row.code?.slice(0, 2))
        expect(row.code).not.toBe(held)
        expect(row.published).toBeNull()
      }
      // Drafts reserve nothing.
      expect(d1(`SELECT COUNT(*) AS n FROM taken_sections WHERE organisation = 'И аз'`)[0]).toMatchObject({ n: 0 })

      const todor = panel.getByTestId('partner-section-row').filter({ hasText: 'Тодор Пробов' })
      // One draft action per row: „Запази“. No „Предложи“.
      await expect(todor.getByRole('button', { name: 'Запази', exact: true })).toHaveCount(1)
      await expect(todor.getByRole('button', { name: 'Предложи' })).toHaveCount(0)
      await todor.getByRole('button', { name: 'Публикувай' }).click()
      await expect(page.getByText(/Публикувани 1\..*Без писма и без Brevo/)).toBeVisible()
      const [published] = d1(`SELECT section_published AS code FROM partner_people WHERE email = 'iaz.one-e2e@example.com'`) as Array<{ code: string }>
      expect(published!.code).toMatch(/^\d{9}$/)
      expect(d1(`SELECT organisation FROM taken_sections WHERE section_code = '${published!.code}'`)[0]).toMatchObject({ organisation: 'И аз' })
      // One quota: a signup can never take a partner section.
      expect(() => d1(`UPDATE signups SET draft_section = '${published!.code}' WHERE id = 'e2e-iaz-admin'`)).toThrow()
      // Nobody became a signup and nothing was queued for mail.
      expect(d1(`SELECT COUNT(*) AS n FROM signups WHERE email LIKE 'iaz.%-e2e@example.com' AND id != 'e2e-iaz-admin'`)[0]).toMatchObject({ n: 1 })

      // The reserved list shows it as managed by the partner allocation, without „Махни“.
      await page.reload()
      const reserved = page.locator('details').filter({ has: page.locator('summary', { hasText: /Резервирани/ }) }).first()
      if (await reserved.count()) {
        await reserved.locator('summary').first().click()
        await expect(reserved.getByTestId('reserved-managed').first()).toBeVisible()
      }

      const again = page.getByTestId('partner-sections-panel')
      await openDetails(again)
      const published1 = again.getByTestId('partner-section-row').filter({ hasText: 'Тодор Пробов' })
      await expect(published1.getByRole('button', { name: 'Махни публикуването' })).toBeVisible({ timeout: 30_000 })
      // After the reload the server-rendered button can be clicked before hydration, and that click does nothing. Retry it.
      await expect(async () => {
        await published1.getByRole('button', { name: 'Махни публикуването' }).click({ timeout: 5_000 })
        await expect(page.getByText(/вече не е публикувана и не е резервирана/)).toBeVisible({ timeout: 5_000 })
      }).toPass({ timeout: 40_000 })
      expect(d1(`SELECT COUNT(*) AS n FROM taken_sections WHERE section_code = '${published!.code}'`)[0]).toMatchObject({ n: 0 })
    } finally {
      wranglerLocal([
        '--command',
        `UPDATE signups SET draft_section = NULL WHERE id = 'e2e-iaz-existing';
         DELETE FROM taken_sections WHERE organisation = 'И аз' AND section_code LIKE '__99%';
         UPDATE partner_people SET section_draft = NULL, section_published = NULL, section_draft_locked = 0 WHERE email LIKE 'iaz.%-e2e@example.com';
         DELETE FROM priority_sections WHERE town = 'Е2Е';`,
      ])
    }
  })
})

/** A summary click toggles: only click when closed, then wait until it is really open. */
async function openDetails(details: Locator) {
  await expect(details).toBeVisible({ timeout: 30_000 })
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) await details.locator('summary').first().click()
  await expect(details).toHaveJSProperty('open', true)
}

async function openTools(page: Page) {
  const tools = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Инструменти' }) })
  if (!(await tools.evaluate((element) => (element as HTMLDetailsElement).open))) await tools.locator('summary').first().click()
}

async function signIn(page: Page) {
  await page.context().addCookies([{ name: 'tb_session', value: SESSION, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
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
      return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', ...args], {
        cwd: WEB_DIR,
        stdio: 'pipe',
      }).toString()
    } catch (error) {
      const text = String((error as { stdout?: unknown }).stdout ?? '') + String((error as { stderr?: unknown }).stderr ?? '') + String(error)
      // Another spec may hold the local SQLite file; a trigger or constraint refusal is a real answer.
      if (/reserved_section|section_held|constraint failed/i.test(text) || attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}

function seed() {
  const sql = `
DELETE FROM signups WHERE email LIKE 'iaz.%-e2e@example.com' AND id NOT IN ('e2e-iaz-existing', 'e2e-iaz-admin');
DELETE FROM partner_people WHERE egn IN (${SAMPLE_EGNS.map((value) => `'${value}'`).join(', ')});
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES
  ('e2e-iaz-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2eiazad', '{"firstName":"Админ","lastName":"Иаз","email":"${STAFF_EMAIL}","phone":"0888000999"}', 1, 0, 1, '', datetime('now'), datetime('now')),
  ('e2e-iaz-existing', 'iaz.existing-e2e@example.com', 'e2e-iaz-existing-session', 'e2eiazex', '{"firstName":"Стара","middleName":"Собствена","lastName":"Фамилия","email":"iaz.existing-e2e@example.com","phone":"0899999999"}', 1, 0, 1, '${EXISTING_EGN}', datetime('now'), datetime('now'))
ON CONFLICT(email) DO UPDATE SET session_token = excluded.session_token, payload = excluded.payload, email_confirmed = 1, egn = excluded.egn;
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';
`
  wranglerLocal(['--command', sql])
}
