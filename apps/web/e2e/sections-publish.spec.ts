import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'

const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')
const STAFF = { id: 'e2e-pub-staff', email: 'pub.staff-e2e@example.com', session: 'e2e-pub-staff-session' }
const A = { id: 'e2e-pub-a', email: 'pub.a-e2e@example.com', section: '234600301' }
const B = { id: 'e2e-pub-b', email: 'pub.b-e2e@example.com', section: '234600302' }

test.describe('Секции: three states, publish a row or the picked rows, unpublish (no email)', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    // Wait for adminSession so signupDatabase creates local D1 tables before seeding.
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
  })

  test.afterAll(() => {
    d1(`DELETE FROM signup_audit WHERE signup_id IN ('${A.id}', '${B.id}'); DELETE FROM signups WHERE id IN ('${STAFF.id}', '${A.id}', '${B.id}'); DELETE FROM staff WHERE email = '${STAFF.email}';`)
  })

  test('publish one row, publish the picked rows, then unpublish back to a manual draft', async ({ page }) => {
    test.setTimeout(120_000)
    seed()
    await page.context().addCookies([{ name: 'tb_session', value: STAFF.session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin/sections?state=draft&q=' + encodeURIComponent('pub.'))
    await expect(page.getByTestId('state-draft')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('state-draft')).toContainText('(2)', { timeout: 30_000 })
    await expect(page.getByTestId('state-published')).toContainText('(0)')
    const rowA = page.getByTestId('section-person-row').filter({ hasText: A.email })
    const rowB = page.getByTestId('section-person-row').filter({ hasText: B.email })
    await expect(rowA).toBeVisible()
    // The draft cell has one action: „Запази“ saves a draft. No „Предложи“.
    await expect(rowA.getByRole('button', { name: 'Запази', exact: true })).toHaveCount(1)
    await expect(rowA.getByRole('button', { name: 'Предложи' })).toHaveCount(0)
    await expect(rowA.getByRole('button', { name: 'Сложи чернова' })).toHaveCount(0)

    await expect(async () => {
      await rowA.getByRole('button', { name: 'Публикувай', exact: true }).click()
      await expect(page.getByText('Публикувани са 1 чернови (без имейл).')).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 40_000 })
    expect(d1(`SELECT published_section FROM signups WHERE id = '${A.id}'`)[0]).toMatchObject({ published_section: A.section })
    expect(d1(`SELECT published_section FROM signups WHERE id = '${B.id}'`)[0]).toMatchObject({ published_section: null })
    await expect(page.getByTestId('state-published')).toContainText('(1)')

    await expect(async () => {
      await rowB.getByRole('checkbox', { name: /Избери/ }).check()
      await page.getByRole('button', { name: 'Публикувай избраните (1)' }).click()
      await page.getByRole('button', { name: 'Да, публикувай 1 (без имейл)' }).click()
      await expect(page.getByTestId('state-draft')).toContainText('(0)', { timeout: 5_000 })
    }).toPass({ timeout: 40_000 })
    expect(d1(`SELECT published_section FROM signups WHERE id = '${B.id}'`)[0]).toMatchObject({ published_section: B.section })
    await expect(page.getByTestId('state-draft')).toContainText('(0)')

    await page.getByTestId('state-published').click()
    await expect(page).toHaveURL(/state=published/)
    const publishedA = page.getByTestId('section-person-row').filter({ hasText: A.email })
    // Local D1 is shared with parallel specs; a SQLITE_BUSY answer leaves no message, so try again.
    await expect(async () => {
      await publishedA.getByRole('button', { name: 'Махни публикуването' }).click()
      await publishedA.getByRole('button', { name: 'Да, махни публикуването' }).click()
      await expect(page.getByText(`Секция ${A.section} вече не е публикувана. Остава като ръчна чернова. Без имейл.`)).toBeVisible({ timeout: 5_000 })
    }).toPass({ timeout: 40_000 })
    expect(d1(`SELECT draft_section, draft_locked, published_section FROM signups WHERE id = '${A.id}'`)[0]).toMatchObject({
      draft_section: A.section,
      draft_locked: 1,
      published_section: null,
    })
    await expect(page.getByTestId('state-draft')).toContainText('(1)')
  })
})

function seed() {
  const person = (p: { id: string; email: string; section: string }, n: number) => `(
  '${p.id}', '${p.email}', NULL, 'e2epub${n}',
  '{"firstName":"Публ${n}","lastName":"Тестов","email":"${p.email}","role":"section","rounds":{"first":true,"runoff":true}}',
  1, 0, 1, '', 'section', '23', '23', 'гр. София', 'ул. Публикуване ${n}', '${p.section}', NULL, 0, '', 1, 1, 'cityRegion', datetime('now'), datetime('now'))`
  d1(`DELETE FROM signup_audit WHERE signup_id IN ('${A.id}', '${B.id}');
DELETE FROM signups WHERE id IN ('${STAFF.id}', '${A.id}', '${B.id}');
UPDATE signups SET draft_section = NULL WHERE draft_section IN ('${A.section}', '${B.section}') OR published_section IN ('${A.section}', '${B.section}');
UPDATE signups SET published_section = NULL WHERE published_section IN ('${A.section}', '${B.section}');
INSERT INTO signups (
  id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, role,
  mir_code, region_code, town_name, section_place, draft_section, published_section, draft_locked, notes,
  rounds_first, rounds_runoff, radius, created_at, updated_at
) VALUES
('${STAFF.id}', '${STAFF.email}', '${STAFF.session}', 'e2epubst', '{"firstName":"Щаб","email":"${STAFF.email}"}', 1, 0, 0, '', 'section',
  '23', '23', 'гр. София', '', NULL, NULL, 0, '', 0, 0, '', datetime('now'), datetime('now')),
${person(A, 1)},
${person(B, 2)};
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF.email}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';`)
}

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
