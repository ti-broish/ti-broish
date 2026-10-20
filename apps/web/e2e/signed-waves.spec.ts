import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

const STAFF_EMAIL = 'waves.admin-e2e@example.com'
const SESSION = 'e2e-waves-admin-session'

function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

const EGN_A = egn(81, 3, 4, 511)
const EGN_B = egn(92, 5, 6, 522)
const EGN_P = egn(77, 8, 9, 533)
// Days nobody else signs on, so these are their own waves.
const DAY_ONE = '2026-01-05'
const DAY_TWO = '2026-01-06'

test.describe('signed пълномощни by wave, with РИК tables', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test.afterAll(() => {
    wranglerLocal(['--command', `DELETE FROM signups WHERE id IN ('e2e-waves-a', 'e2e-waves-b', 'e2e-waves-admin'); DELETE FROM partner_people WHERE id = 'pp-e2e-waves'; DELETE FROM staff WHERE email = '${STAFF_EMAIL}';`])
  })

  test('lists waves per РИК and downloads tables and the wave ZIP', async ({ page }) => {
    await page.context().addCookies([{ name: 'tb_session', value: SESSION, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
    await page.goto('/admin/palnomoshtni')
    const panel = page.getByTestId('signed-waves')
    await expect(panel.getByRole('heading', { name: 'Подписани по вълни → РИК' })).toBeVisible({ timeout: 30_000 })
    const first = panel.getByRole('listitem').filter({ hasText: '05.01.2026' })
    await expect(first).toContainText('2 души')
    await expect(first).toContainText('91: 1 · 92: 1')
    const second = panel.getByRole('listitem').filter({ hasText: '06.01.2026' })
    await expect(second).toContainText('1 души (от тях „И аз“ 1)')
    await expect(first.getByRole('link', { name: /Изтегли ZIP вълна \d+ \(PDF \+ таблици\)/ })).toHaveAttribute('href', `/admin/palnomoshtni/podpisani?wave=${DAY_ONE}`)
    await expect(panel.getByRole('link', { name: 'Изтегли всички подписани досега (PDF + таблици)' })).toBeVisible()
    await expect(panel).not.toContainText(EGN_A)

    const tables = await page.request.get(`/admin/palnomoshtni/podpisani?wave=${DAY_ONE}&tables=1`)
    expect(tables.status()).toBe(200)
    expect(tables.headers()['content-disposition']).toMatch(new RegExp(`podpisani-valna-\\d+-${DAY_ONE}-tablici\\.zip`))
    const tableFiles = unzipSync(new Uint8Array(await tables.body()))
    expect(Object.keys(tableFiles).sort()).toEqual(['РИК 91/РИК 91 Представители.xlsx', 'РИК 92/РИК 92 Представители.xlsx'])
    const rik91 = unzipSync(tableFiles['РИК 91/РИК 91 Представители.xlsx']!)
    const strings = strFromU8(rik91['xl/sharedStrings.xml']!)
    expect(strings).toContain('Списък на упълномощените представители на \nИнициативен комитет')
    expect(strings).toContain('Вълна Първа Тестова')
    expect(strings).toContain(EGN_A)
    expect(strings).toContain('701/05.01.2026')
    expect(strings).not.toContain('Партньор')
    expect(strFromU8(rik91['xl/worksheets/sheet1.xml']!)).toContain('<c r="B3" s="11"><v>701</v></c>')

    // The full ZIP: tables plus PDFs; with no Drive file locally the PDFs are listed as missing.
    const full = await page.request.get(`/admin/palnomoshtni/podpisani?wave=${DAY_TWO}`)
    expect(full.status()).toBe(200)
    const fullFiles = unzipSync(new Uint8Array(await full.body()))
    expect(Object.keys(fullFiles)).toContain('РИК 92/РИК 92 Представители.xlsx')
    const partnerTable = strFromU8(unzipSync(fullFiles['РИК 92/РИК 92 Представители.xlsx']!)['xl/sharedStrings.xml']!)
    expect(partnerTable).toContain('Иа Вълнов Партньор')
    const pdf = 'РИК 92/92_703_Иа_Вълнов_Партньор_signed.pdf'
    expect(Object.keys(fullFiles).includes(pdf) || strFromU8(fullFiles['ЛИПСВАЩИ_PDF.txt'] ?? new Uint8Array()).includes(pdf)).toBe(true)

    expect((await page.request.get('/admin/palnomoshtni/podpisani?wave=2026-01-07')).status()).toBe(404)
    expect((await page.request.get('/admin/palnomoshtni/podpisani?wave=bad')).status()).toBe(400)
  })

  test('needs a signed-in staff member', async ({ request }) => {
    const response = await request.get(`/admin/palnomoshtni/podpisani?wave=${DAY_ONE}&tables=1`)
    expect(response.status()).toBeGreaterThanOrEqual(400)
    expect((await response.body()).toString('utf8')).not.toContain(EGN_A)
  })
})

const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

function wranglerLocal(args: string[]) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', ...args], { cwd: WEB_DIR, stdio: 'pipe' }).toString()
    } catch (error) {
      const text = String((error as { stdout?: unknown }).stdout ?? '') + String((error as { stderr?: unknown }).stderr ?? '') + String(error)
      if (/constraint failed/i.test(text) || attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}

function seed() {
  const payload = (first: string, middle: string, last: string, email: string) =>
    JSON.stringify({ firstName: first, middleName: middle, lastName: last, email, phone: '0888000111' })
  const sql = `
DELETE FROM signups WHERE id IN ('e2e-waves-a', 'e2e-waves-b', 'e2e-waves-admin');
DELETE FROM partner_people WHERE id = 'pp-e2e-waves';
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('e2e-waves-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2ewavad', '${payload('Админ', '', 'Вълни', STAFF_EMAIL)}', 1, 0, 1, '', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now')) ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, published_section,
  designation_mir, designation_number, designation_issued_at, designation_signed_at, designation_first_signed_at, designation_drive_file_id, created_at, updated_at)
VALUES
  ('e2e-waves-a', 'waves.a-e2e@example.com', 'e2e-waves-a-s', 'e2ewava1', '${payload('Вълна', 'Първа', 'Тестова', 'waves.a-e2e@example.com')}', 1, 0, 1, '${EGN_A}', '919100001',
   '91', 701, '05.01.2026', '2026-01-06T09:00:00.000Z', '${DAY_ONE}T09:00:00.000Z', 'e2e-missing-a', datetime('now'), datetime('now')),
  ('e2e-waves-b', 'waves.b-e2e@example.com', 'e2e-waves-b-s', 'e2ewavb1', '${payload('Вълна', 'Втора', 'Тестова', 'waves.b-e2e@example.com')}', 1, 0, 1, '${EGN_B}', '929200001',
   '92', 702, '05.01.2026', '${DAY_ONE}T10:00:00.000Z', NULL, 'e2e-missing-b', datetime('now'), datetime('now'));
INSERT INTO partner_people (id, partner, egn, email, first_name, middle_name, last_name, designation_mir, designation_number, designation_issued_at,
  designation_signed_at, designation_drive_file_id, imported_at, updated_at)
VALUES ('pp-e2e-waves', 'i-az', '${EGN_P}', 'waves.p-e2e@example.com', 'Иа', 'Вълнов', 'Партньор', '92', 703, '06.01.2026', '${DAY_TWO}T08:00:00.000Z', 'e2e-missing-p', 'now', 'now');
`
  wranglerLocal(['--command', sql])
}
