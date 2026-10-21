import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

// Bulk „Публикувай черновите в този изглед“ on /admin/sections also publishes „И аз“ partner drafts
// (the partner path: section_published + „И аз“ reservation, no email, no Brevo), and refuses a
// draft outside the пълномощно's МИР („Секция извън МИР на пълномощното“).
const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')
const STAFF = { id: 'e2e-pubp-staff', email: 'pubp.staff-e2e@example.com', session: 'e2e-pubp-staff-session' }
const VOL = { id: 'e2e-pubp-vol', email: 'pubp.vol-e2e@example.com', section: '300100901' }
const OK = { id: 'pp-e2e-pubp-ok', section: '300100902' }
const OUT = { id: 'pp-e2e-pubp-out', section: '300100903' }
const CODES = `'${VOL.section}', '${OK.section}', '${OUT.section}'`

test.describe('Секции: bulk publish includes „И аз“ and guards the пълномощно МИР', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
  })

  test.afterAll(() => {
    cleanup()
  })

  test('the confirmation counts volunteers and „И аз“; the mismatched partner stays a draft', async ({ page }) => {
    test.setTimeout(120_000)
    seed()
    await page.context().addCookies([{ name: 'tb_session', value: STAFF.session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin/sections?view=mir&mir=30')
    await expect(page.getByTestId('section-person-row').filter({ hasText: VOL.email })).toBeVisible({ timeout: 30_000 })

    // „И аз“ — секции: the mismatched row carries the badge.
    const panel = page.getByTestId('partner-sections-panel')
    await panel.locator('summary').click()
    const outRow = panel.getByTestId('partner-section-row').filter({ hasText: OUT.section })
    await expect(outRow.getByTestId('designation-mir-badge')).toContainText('Секция извън МИР на пълномощното', { timeout: 30_000 })
    await expect(panel.getByTestId('partner-section-row').filter({ hasText: OK.section }).getByTestId('designation-mir-badge')).toHaveCount(0)

    await expect(async () => {
      await page.getByTestId('publish-view').click()
      await expect(page.getByText('Ще публикуваме 1 доброволец и 1 от „И аз“ (без имейл, без Brevo). Спрени: 1 със секция извън МИР на пълномощното.')).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 40_000 })
    await expect(page.getByTestId('publish-view')).toHaveText('Да, публикувай 1 доброволец и 1 от „И аз“ (без имейл)')
    await expect(async () => {
      if ((await page.getByTestId('publish-view').textContent())?.startsWith('Да,')) await page.getByTestId('publish-view').click()
      await expect(page.getByText(/„И аз“: публикувани 1, спрени 1/)).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 40_000 })

    expect(d1(`SELECT published_section FROM signups WHERE id = '${VOL.id}'`)[0]).toMatchObject({ published_section: VOL.section })
    expect(d1(`SELECT section_published FROM partner_people WHERE id = '${OK.id}'`)[0]).toMatchObject({ section_published: OK.section })
    expect(d1(`SELECT organisation FROM taken_sections WHERE section_code = '${OK.section}'`)[0]).toMatchObject({ organisation: 'И аз' })
    expect(d1(`SELECT section_published FROM partner_people WHERE id = '${OUT.id}'`)[0]).toMatchObject({ section_published: null })
    expect(d1(`SELECT COUNT(*) AS n FROM taken_sections WHERE section_code = '${OUT.section}'`)[0]).toMatchObject({ n: 0 })
  })
})

function cleanup() {
  d1(`DELETE FROM taken_sections WHERE section_code IN (${CODES});
DELETE FROM partner_people WHERE id IN ('${OK.id}', '${OUT.id}');
DELETE FROM signup_audit WHERE signup_id IN ('${VOL.id}');
DELETE FROM signups WHERE id IN ('${STAFF.id}', '${VOL.id}');
DELETE FROM staff WHERE email = '${STAFF.email}';`)
}

function seed() {
  cleanup()
  d1(`UPDATE signups SET draft_section = NULL WHERE draft_section IN (${CODES});
UPDATE signups SET published_section = NULL WHERE published_section IN (${CODES});
UPDATE partner_people SET section_draft = NULL WHERE section_draft IN (${CODES});
UPDATE partner_people SET section_published = NULL WHERE section_published IN (${CODES});
INSERT INTO signups (
  id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, role,
  mir_code, region_code, town_name, section_place, draft_section, published_section, draft_locked, notes,
  rounds_first, rounds_runoff, radius, created_at, updated_at
) VALUES
('${STAFF.id}', '${STAFF.email}', '${STAFF.session}', 'e2epubps', '{"firstName":"Щаб","email":"${STAFF.email}"}', 1, 0, 0, '', 'section',
  '23', '23', 'гр. София', '', NULL, NULL, 0, '', 0, 0, '', datetime('now'), datetime('now')),
('${VOL.id}', '${VOL.email}', NULL, 'e2epubpv', '{"firstName":"Публ","lastName":"Шумен","email":"${VOL.email}","role":"section","rounds":{"first":true,"runoff":true}}',
  1, 0, 1, '', 'section', '30', '30', 'гр. Шумен', 'ул. Шумен 1', '${VOL.section}', NULL, 0, '', 1, 1, 'settlement', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF.email}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO partner_people (id, partner, egn, email, first_name, middle_name, last_name, region_code, region_name, designation_mir, designation_number,
  imported_at, updated_at) VALUES
('${OK.id}', 'iaz', 'e2epubp1', '', 'Иаз', '', 'Вмир', '30', 'Шумен', '30', 990, datetime('now'), datetime('now')),
('${OUT.id}', 'iaz', 'e2epubp2', '', 'Иаз', '', 'Извън', '29', 'Хасково', '29', 990, datetime('now'), datetime('now'));
UPDATE partner_people SET section_draft = '${OK.section}', section_draft_source = 'auto' WHERE id = '${OK.id}';
UPDATE partner_people SET section_draft = '${OUT.section}', section_draft_source = 'auto' WHERE id = '${OUT.id}';`)
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
