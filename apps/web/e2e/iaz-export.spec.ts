import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// „Експорт И аз“ on Записвания: admins download every active „И аз“ person as the Brevo CSV
// (UTF-8 BOM, no ЕГН, withdrawn people left out). An editor does not get the button.
const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')
const ADMIN = { id: 'e2e-iazexp-admin', email: 'iazexp.admin-e2e@example.com', session: 'e2e-iazexp-admin-session' }
const EDITOR = { id: 'e2e-iazexp-editor', email: 'iazexp.editor-e2e@example.com', session: 'e2e-iazexp-editor-session' }
const ACTIVE = { id: 'pp-e2e-iazexp-active', email: 'iazexp.active-e2e@example.com', egn: '8001014444' }
const GONE = { id: 'pp-e2e-iazexp-gone', email: 'iazexp.gone-e2e@example.com', egn: '8001015555' }

test.describe('„Експорт И аз“', () => {
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

  test('an admin downloads the active „И аз“ people, without ЕГН', async ({ page }) => {
    test.setTimeout(120_000)
    await page.context().addCookies([{ name: 'tb_session', value: ADMIN.session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    await page.goto('/admin/signups')
    const button = page.getByTestId('iaz-export')
    await expect(button).toHaveText('Експорт И аз', { timeout: 30_000 })
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await button.click()
    const file = await (await download).path()
    const csv = readFileSync(file!, 'utf8')
    expect(csv.startsWith('\uFEFFEMAIL,FIRSTNAME,MIDDLENAME,LASTNAME,SMS,MIR,MIR_NAME,')).toBe(true)
    expect(csv).toContain(ACTIVE.id)
    expect(csv).toContain(ACTIVE.email)
    expect(csv).toContain('+359888111222')
    expect(csv).not.toContain(GONE.id)
    expect(csv).not.toContain(ACTIVE.egn)
    expect(csv).not.toContain(GONE.egn)
    expect(csv).not.toMatch(/EGN/i)
  })

  test('an editor has no „Експорт И аз“', async ({ page }) => {
    await page.context().addCookies([{ name: 'tb_session', value: EDITOR.session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    await page.goto('/admin/signups')
    await expect(page.getByRole('group', { name: 'Източник' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('iaz-export')).toHaveCount(0)
  })
})

function cleanup() {
  d1(`DELETE FROM partner_people WHERE id IN ('${ACTIVE.id}', '${GONE.id}');
DELETE FROM signups WHERE id IN ('${ADMIN.id}', '${EDITOR.id}');
DELETE FROM staff WHERE email IN ('${ADMIN.email}', '${EDITOR.email}');`)
}

function seed() {
  cleanup()
  d1(`INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at) VALUES
('${ADMIN.id}', '${ADMIN.email}', '${ADMIN.session}', 'e2eiazxa', '{"firstName":"Админ","email":"${ADMIN.email}"}', 1, 0, 1, '', datetime('now'), datetime('now')),
('${EDITOR.id}', '${EDITOR.email}', '${EDITOR.session}', 'e2eiazxe', '{"firstName":"Редактор","email":"${EDITOR.email}"}', 1, 0, 1, '', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${ADMIN.email}', 'admin', 'e2e', datetime('now')), ('${EDITOR.email}', 'editor', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = excluded.role;
INSERT INTO partner_people (id, partner, egn, email, phone, first_name, middle_name, last_name, region_code, region_name, designation_mir, designation_number,
  imported_at, updated_at) VALUES
('${ACTIVE.id}', 'iaz.bg', '${ACTIVE.egn}', '${ACTIVE.email}', '0888 111 222', 'Иаз', 'Експортна', 'Активна', '31', 'Ямбол', '31', 993, datetime('now'), datetime('now')),
('${GONE.id}', 'iaz.bg', '${GONE.egn}', '${GONE.email}', '', 'Иаз', '', 'Оттеглена', '31', 'Ямбол', '31', 994, datetime('now'), datetime('now'));
UPDATE partner_people SET withdrawn_at = datetime('now') WHERE id = '${GONE.id}';`)
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
