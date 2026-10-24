import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// „Експорт секции с хора“ on Секции: admins download one row per person in a section (ours and
// „И аз“), with the CIK address and paper/machine desk, UTF-8 BOM and no ЕГН. Editors get no button.
const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')
const ADMIN = { id: 'e2e-spexp-admin', email: 'spexp.admin-e2e@example.com', session: 'e2e-spexp-admin-session' }
const EDITOR = { id: 'e2e-spexp-editor', email: 'spexp.editor-e2e@example.com', session: 'e2e-spexp-editor-session' }
const OURS = { id: 'e2e-spexp-ours', email: 'spexp.ours-e2e@example.com', egn: '8001016666', section: '010100001' }
const IAZ = { id: 'pp-e2e-spexp-iaz', email: 'spexp.iaz-e2e@example.com', egn: '8001017777', section: '010100002' }
const GONE = { id: 'e2e-spexp-gone', email: 'spexp.gone-e2e@example.com', egn: '8001018888', section: '010100003' }

test.describe('„Експорт секции с хора“', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test.afterAll(() => {
    cleanup()
  })

  test('an admin downloads the people in sections, without ЕГН', async ({ page }) => {
    test.setTimeout(120_000)
    await page.context().addCookies([{ name: 'tb_session', value: ADMIN.session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    await page.goto('/admin/sections')
    const button = page.getByTestId('sections-people-export')
    await expect(button).toHaveText('Експорт секции с хора', { timeout: 30_000 })
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await button.click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(/^tibroish-sekcii-s-hora-\d{4}-\d{2}-\d{2}\.csv$/)
    const csv = readFileSync((await file.path())!, 'utf8')
    expect(csv.startsWith('\uFEFFСИК,№ секция,МИР,')).toBe(true)
    const lines = csv.split(/\r?\n/)
    const ours = lines.find((line) => line.includes(OURS.email))
    expect(ours).toContain(`${OURS.section},001,`)
    expect(ours).toContain('ГР.БАНСКО')
    expect(ours).toContain('Ти броиш')
    const iaz = lines.find((line) => line.includes(IAZ.email))
    expect(iaz).toContain(`${IAZ.section},002,`)
    expect(iaz).toContain('И аз')
    expect(csv).not.toContain(GONE.email)
    for (const egn of [OURS.egn, IAZ.egn, GONE.egn]) expect(csv).not.toContain(egn)
    expect(csv).not.toMatch(/ЕГН|EGN/i)
  })

  test('an editor has no „Експорт секции с хора“', async ({ page }) => {
    await page.context().addCookies([{ name: 'tb_session', value: EDITOR.session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    await page.goto('/admin/sections')
    await expect(page.getByRole('heading', { name: 'Секции' }).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('sections-people-export')).toHaveCount(0)
  })
})

function cleanup() {
  d1(`DELETE FROM partner_people WHERE id = '${IAZ.id}';
DELETE FROM signups WHERE id IN ('${ADMIN.id}', '${EDITOR.id}', '${OURS.id}', '${GONE.id}');
DELETE FROM staff WHERE email IN ('${ADMIN.email}', '${EDITOR.email}');`)
}

function seed() {
  cleanup()
  d1(`INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, role, draft_section, published_section, created_at, updated_at) VALUES
('${ADMIN.id}', '${ADMIN.email}', '${ADMIN.session}', 'e2espxa', '{"firstName":"Админ","email":"${ADMIN.email}"}', 1, 0, 1, '', NULL, NULL, NULL, datetime('now'), datetime('now')),
('${EDITOR.id}', '${EDITOR.email}', '${EDITOR.session}', 'e2espxe', '{"firstName":"Редактор","email":"${EDITOR.email}"}', 1, 0, 1, '', NULL, NULL, NULL, datetime('now'), datetime('now')),
('${OURS.id}', '${OURS.email}', 'e2e-spexp-ours-session', 'e2espxo', '{"firstName":"Наш","lastName":"Секционен","phone":"0888 333 444","email":"${OURS.email}"}', 1, 0, 1, '${OURS.egn}', 'section', '${OURS.section}', '${OURS.section}', datetime('now'), datetime('now')),
('${GONE.id}', '${GONE.email}', 'e2e-spexp-gone-session', 'e2espxg', '{"firstName":"Оттеглен","email":"${GONE.email}"}', 1, 1, 1, '${GONE.egn}', 'section', '${GONE.section}', '${GONE.section}', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${ADMIN.email}', 'admin', 'e2e', datetime('now')), ('${EDITOR.email}', 'editor', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = excluded.role;
INSERT INTO partner_people (id, partner, egn, email, phone, first_name, middle_name, last_name, region_code, region_name, imported_at, updated_at) VALUES
('${IAZ.id}', 'iaz.bg', '${IAZ.egn}', '${IAZ.email}', '0888 555 666', 'Иаз', '', 'Секционна', '01', 'Благоевград', datetime('now'), datetime('now'));
UPDATE partner_people SET section_published = '${IAZ.section}' WHERE id = '${IAZ.id}';`)
}

function d1(sql: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', '--command', sql], { cwd: WEB_DIR, stdio: 'pipe' }).toString()
    } catch (error) {
      const text = String((error as { stdout?: unknown }).stdout ?? '') + String((error as { stderr?: unknown }).stderr ?? '') + String(error)
      if (!/SQLITE_BUSY|database is locked/.test(text) || attempt >= 5) throw new Error(text.slice(0, 2000))
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}
