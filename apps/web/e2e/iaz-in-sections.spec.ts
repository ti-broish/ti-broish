import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

// „И аз“ people on Секции: in „Без секция“, „Чернови“ and „Публикувани“ like our volunteers, with the
// teal tint and badge. Their draft and publish write partner_people and the „И аз“ reservation, never
// e-mail: the „Извести по имейл“ button is not there for them.
const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')
const STAFF = { id: 'e2e-iazsec-staff', email: 'iazsec.staff-e2e@example.com', session: 'e2e-iazsec-staff-session' }
const VOL = { id: 'e2e-iazsec-vol', email: 'iazsec.vol-e2e@example.com' }
const IAZ = { id: 'pp-e2e-iazsec', email: 'iazsec.iaz-e2e@example.com', section: '319990101' }
const GONE = { id: 'pp-e2e-iazsec-gone', email: 'iazsec.gone-e2e@example.com' }

test.describe('„И аз“ on Секции', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
  })

  test.afterAll(() => {
    cleanup()
  })

  test('shown in Без секция, drafted and published through partner_people, never e-mailed', async ({ page }) => {
    test.setTimeout(120_000)
    seed()
    await page.context().addCookies([{ name: 'tb_session', value: STAFF.session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.goto('/admin/sections?view=mir&mir=31&state=none')
    const rows = page.getByTestId('section-person-row')
    await expect(rows.filter({ hasText: VOL.email })).toBeVisible({ timeout: 30_000 })
    const iaz = page.locator('[data-testid="section-person-row"][data-source="iaz"]').filter({ hasText: IAZ.email })
    await expect(iaz).toBeVisible()
    await expect(iaz.getByTestId('iaz-badge')).toHaveText('„И аз“')
    await expect(iaz).toHaveClass(/bg-\[#e3f1f4\]/)
    // The withdrawn „И аз“ person is never on Секции.
    await expect(rows.filter({ hasText: GONE.email })).toHaveCount(0)
    // The state chip counts both: our volunteer and the „И аз“ person.
    const noneCount = async () => Number((await page.getByTestId('state-none').textContent())?.match(/\((\d+)\)/)?.[1] ?? 0)
    await expect.poll(noneCount, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
    const before = await noneCount()

    // „Запази“ writes the „И аз“ draft (locked, manual), not a signup draft.
    await iaz.getByLabel(`Чернова за ${IAZ.email}`).fill(IAZ.section)
    await iaz.getByRole('button', { name: 'Запази' }).click()
    await expect.poll(() => d1(`SELECT section_draft, section_draft_locked FROM partner_people WHERE id = '${IAZ.id}'`)[0], { timeout: 30_000 })
      .toMatchObject({ section_draft: IAZ.section, section_draft_locked: 1 })

    // Drafted: one fewer without a section.
    await page.goto('/admin/sections?view=mir&mir=31&state=none')
    await expect(rows.filter({ hasText: VOL.email })).toBeVisible({ timeout: 30_000 })
    await expect.poll(noneCount, { timeout: 30_000 }).toBe(before - 1)
    await expect(page.locator('[data-testid="section-person-row"][data-source="iaz"]').filter({ hasText: IAZ.email })).toHaveCount(0)

    await page.goto('/admin/sections?view=mir&mir=31&state=draft')
    const drafted = page.locator('[data-testid="section-person-row"][data-source="iaz"]').filter({ hasText: IAZ.email })
    await expect(drafted).toBeVisible({ timeout: 30_000 })
    await drafted.getByRole('button', { name: 'Публикувай' }).click()
    await expect.poll(() => d1(`SELECT section_published FROM partner_people WHERE id = '${IAZ.id}'`)[0], { timeout: 30_000 })
      .toMatchObject({ section_published: IAZ.section })
    expect(d1(`SELECT organisation FROM taken_sections WHERE section_code = '${IAZ.section}'`)[0]).toMatchObject({ organisation: 'И аз' })

    await page.goto('/admin/sections?view=mir&mir=31&state=published')
    const published = page.locator('[data-testid="section-person-row"][data-source="iaz"]').filter({ hasText: IAZ.email })
    await expect(published).toBeVisible({ timeout: 30_000 })
    await expect(published.getByRole('button', { name: 'Махни публикуването' })).toBeVisible()
    await expect(published.getByRole('button', { name: 'Извести по имейл' })).toHaveCount(0)
  })
})

function cleanup() {
  d1(`DELETE FROM taken_sections WHERE section_code = '${IAZ.section}';
DELETE FROM partner_people WHERE id IN ('${IAZ.id}', '${GONE.id}');
DELETE FROM signup_audit WHERE signup_id IN ('${VOL.id}');
DELETE FROM signups WHERE id IN ('${STAFF.id}', '${VOL.id}');
DELETE FROM staff WHERE email = '${STAFF.email}';`)
}

function seed() {
  cleanup()
  d1(`UPDATE signups SET draft_section = NULL WHERE draft_section = '${IAZ.section}';
UPDATE signups SET published_section = NULL WHERE published_section = '${IAZ.section}';
UPDATE partner_people SET section_draft = NULL WHERE section_draft = '${IAZ.section}';
UPDATE partner_people SET section_published = NULL WHERE section_published = '${IAZ.section}';
INSERT INTO signups (
  id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, role,
  mir_code, region_code, town_name, section_place, draft_section, published_section, draft_locked, notes,
  rounds_first, rounds_runoff, radius, created_at, updated_at
) VALUES
('${STAFF.id}', '${STAFF.email}', '${STAFF.session}', 'e2eiazss', '{"firstName":"Щаб","email":"${STAFF.email}"}', 1, 0, 0, '', 'section',
  '23', '23', 'гр. София', '', NULL, NULL, 0, '', 0, 0, '', datetime('now'), datetime('now')),
('${VOL.id}', '${VOL.email}', NULL, 'e2eiazsv', '{"firstName":"Секц","lastName":"Ямбол","email":"${VOL.email}","role":"section","rounds":{"first":true,"runoff":true}}',
  1, 0, 1, '', 'section', '31', '31', 'гр. Ямбол', 'ул. Ямбол 1', NULL, NULL, 0, '', 1, 1, 'settlement', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF.email}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO partner_people (id, partner, egn, email, first_name, middle_name, last_name, region_code, region_name, designation_mir, designation_number,
  imported_at, updated_at) VALUES
('${IAZ.id}', 'iaz.bg', 'e2eiazs1', '${IAZ.email}', 'Иаз', '', 'Ямболска', '31', 'Ямбол', '31', 991, datetime('now'), datetime('now')),
('${GONE.id}', 'iaz.bg', 'e2eiazs2', '${GONE.email}', 'Иаз', '', 'Оттеглена', '31', 'Ямбол', '31', 992, datetime('now'), datetime('now'));
UPDATE partner_people SET withdrawn_at = datetime('now') WHERE id = '${GONE.id}';`)
}

function d1(sql: string): Array<Record<string, unknown>> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', '--json', '--command', sql], { cwd: WEB_DIR, stdio: 'pipe' }).toString()
      const parsed = JSON.parse(output.slice(output.indexOf('['))) as Array<{ results?: Array<Record<string, unknown>> }>
      return parsed.flatMap((item) => item.results ?? [])
    } catch (error) {
      const text = String((error as { stdout?: unknown }).stdout ?? '') + String((error as { stderr?: unknown }).stderr ?? '') + String(error)
      if (!/SQLITE_BUSY|database is locked/.test(text) || attempt >= 5) throw new Error(text.slice(0, 2000))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}
