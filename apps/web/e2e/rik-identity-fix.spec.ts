import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// „Поправи име/ЕГН“ from a РИК task: fix → back for signing with the new data → the signed upload
// replaces the old file everywhere, the old one stays in the history. Drive and Brevo are never
// called: ids starting with e2e- get a stub Drive file in `vite dev`, and there is no Brevo key.
const STAFF_EMAIL = 'rikfix.admin-e2e@example.com'
const SESSION = 'e2e-rikfix-admin-session'
const PERSON = 'e2e-rikfix-a'
const PERSON_SESSION = 'e2e-rikfix-a-session'
const TASK = `${PERSON}:fix_data:name`
const MIR = '29'
const NUMBER = 913
const OLD_FILE = 'e2e-stub-rikfix-old'
const OLD_URL = `https://drive.google.com/file/d/${OLD_FILE}/view`
const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

const OLD_EGN = egn(83, 7, 9, 913)
const NEW_EGN = egn(83, 7, 19, 914)

function wranglerLocal(args: string[]) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', ...args], { cwd: WEB_DIR, stdio: 'pipe' }).toString()
    } catch (error) {
      if (attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}

function d1(sql: string): Array<Record<string, unknown>> {
  const output = wranglerLocal(['--json', '--command', sql])
  const parsed = JSON.parse(output.slice(output.indexOf('['))) as Array<{ results?: Array<Record<string, unknown>> }>
  return parsed.flatMap((item) => item.results ?? [])
}

const CLEANUP = `
DELETE FROM signups WHERE id IN ('e2e-rikfix-admin', '${PERSON}');
DELETE FROM staff WHERE email = '${STAFF_EMAIL}';
DELETE FROM signup_audit WHERE signup_id = '${PERSON}';
DELETE FROM rik_status WHERE person_id = '${PERSON}';
DELETE FROM rik_tasks WHERE person_id = '${PERSON}';
`

function seed() {
  const tables = readFileSync(new URL('../sql/2026-10-21-rik-registrations.sql', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
  const payload = (first: string, middle: string, last: string, email: string) => JSON.stringify({ firstName: first, middleName: middle, lastName: last, email, phone: '0888000111' })
  wranglerLocal([
    '--command',
    `${tables}
${CLEANUP}
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('e2e-rikfix-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2erikfx', '${payload('Админ', '', 'Поправки', STAFF_EMAIL)}', 1, 0, 1, '', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now')) ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, designation_mir, designation_number, designation_issued_at,
  designation_generated_at, designation_signing_generated_at, designation_signed_at, designation_first_signed_at, designation_drive_file_id, designation_pdf_url, signup_mail_at, created_at, updated_at)
VALUES ('${PERSON}', 'rikfix.a-e2e@example.com', '${PERSON_SESSION}', 'e2erikfa', '${payload('Грешна', 'Първа', 'Поправкова', 'rikfix.a-e2e@example.com')}', 1, 0, 1, '${OLD_EGN}',
  '${MIR}', ${NUMBER}, '19.10.2026', '2026-10-19T08:00:00.000Z', '2026-10-19T08:30:00.000Z', '2026-10-19T09:00:00.000Z', '2026-10-19T09:00:00.000Z', '${OLD_FILE}', '${OLD_URL}', 'skipped',
  datetime('now'), datetime('now'));
INSERT INTO rik_sources (mir, name, base_url, contacts_url, phones, adapter, health, updated_at)
VALUES ('${MIR}', 'Хасково', 'https://rik29.cik.bg/pvr2026', 'https://rik29.cik.bg/pvr2026/contacts', '0888 000 000', 'cik-platform/rik', 'ok', '2026-10-21T08:00:00.000Z')
ON CONFLICT(mir) DO NOTHING;
INSERT INTO rik_status (person_id, source, mir, number, status, entry_id, detail, status_since, checked_at)
VALUES ('${PERSON}', 'signup', '${MIR}', ${NUMBER}, 'name_mismatch', NULL, 'РИК е публикувал „Вярна Първа Поправкова“ под № ${NUMBER}.', '2026-10-21T08:00:00.000Z', '2026-10-21T08:00:00.000Z');
INSERT INTO rik_tasks (id, person_id, mir, type, reason, detail, active, created_at, updated_at)
VALUES ('${TASK}', '${PERSON}', '${MIR}', 'fix_data', 'name', 'РИК е публикувал „Вярна Първа Поправкова“ под № ${NUMBER}. Поправи данните.', 1, '2026-10-21T08:00:00.000Z', '2026-10-21T08:00:00.000Z');
`,
  ])
}

async function signIn(page: Page, session: string) {
  await page.context().clearCookies()
  await page.context().addCookies([{ name: 'tb_session', value: session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
}

test.describe('„Поправи име/ЕГН“ from a РИК task', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test.afterAll(() => {
    wranglerLocal(['--command', `${CLEANUP} DELETE FROM designation_file_history WHERE person_id = '${PERSON}'; DELETE FROM designation_renames WHERE person_id = '${PERSON}';`])
  })

  test('task → fix → new document for signing → signed upload replaces the old file', async ({ page }) => {
    await signIn(page, SESSION)
    await page.goto(`/admin/rik?view=tasks&mir=${MIR}`)
    const row = page.getByRole('row').filter({ hasText: 'Грешна Първа Поправкова' })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.getByRole('button', { name: 'Поправи име/ЕГН' }).click()
    const form = page.getByTestId('identity-fix-form')
    await expect(form.getByTestId('identity-fix-current')).toContainText(`ЕГН ••••••${OLD_EGN.slice(-4)}`)
    await expect(form.getByTestId('identity-fix-current')).toContainText(`№ ${MIR}/${NUMBER}`)
    await expect(form.getByLabel('Име', { exact: true })).toHaveValue('Грешна')
    // The full ЕГН is never on the page.
    expect(await page.content()).not.toContain(OLD_EGN)

    // A bad checksum is refused, nothing changes.
    await form.getByLabel(/Ново ЕГН/).fill(`${NEW_EGN.slice(0, 9)}${(Number(NEW_EGN[9]) + 1) % 10}`)
    await form.getByRole('button', { name: 'Запиши и нулирай пълномощното' }).click()
    await expect(form.getByRole('alert')).toContainText('контролната цифра')

    await form.getByLabel('Име', { exact: true }).fill('Вярна')
    await form.getByLabel(/Ново ЕГН/).fill(NEW_EGN)
    await form.getByRole('button', { name: 'Запиши и нулирай пълномощното' }).click()
    await expect(page.getByTestId('identity-fix-note')).toContainText('Данните са поправени: „Вярна Първа Поправкова“')
    await expect(page.getByTestId('identity-fix-note')).toContainText('Старият подписан файл е в историята')
    const fixedRow = page.getByRole('row').filter({ hasText: 'Вярна Първа Поправкова' })
    await expect(fixedRow.getByTestId('rik-task-fix-stage')).toHaveText('Поправено – чака подпис')
    // Not closed: still open, with its „Готово“ button.
    await expect(fixedRow.getByRole('button', { name: 'Готово' })).toBeVisible()

    expect(d1(`SELECT egn, designation_number AS n, designation_mir AS mir, designation_signed_at AS signed, designation_signing_generated_at AS zip,
      designation_drive_file_id AS file, designation_pdf_url AS url, designation_first_signed_at AS first FROM signups WHERE id = '${PERSON}'`)[0]).toEqual({
      egn: NEW_EGN,
      n: NUMBER,
      mir: MIR,
      signed: null,
      zip: null,
      file: null,
      url: null,
      first: '2026-10-19T09:00:00.000Z',
    })
    expect(d1(`SELECT drive_file_id AS file, pdf_url AS url, replaced_at FROM designation_file_history WHERE person_id = '${PERSON}'`)).toEqual([{ file: OLD_FILE, url: OLD_URL, replaced_at: null }])
    const audit = d1(`SELECT field, before_text AS b, after_text AS a FROM signup_audit WHERE signup_id = '${PERSON}' ORDER BY field`)
    expect(audit.map((line) => line.field)).toEqual(['designation_resign', 'egn_last4', 'name'])
    expect(JSON.stringify(audit)).not.toContain(OLD_EGN)
    expect(JSON.stringify(audit)).not.toContain(NEW_EGN)
    expect(d1(`SELECT done_at, fixed_by FROM rik_tasks WHERE id = '${TASK}'`)[0]).toEqual({ done_at: null, fixed_by: STAFF_EMAIL })

    // In „Само новите“: the next ZIP for signing renders the new name.
    const zip = await page.request.get(`/admin/palnomoshtni/zip?mir=${MIR}&scope=new&offset=0&limit=50`)
    expect(zip.status()).toBe(200)
    expect((await zip.body()).toString('utf8')).toMatch(new RegExp(`${MIR}_0*${NUMBER}_Вярна_Първа_Поправкова\\.pdf`))
    await page.reload()
    await expect(page.getByRole('row').filter({ hasText: 'Вярна Първа Поправкова' }).getByTestId('rik-task-fix-stage')).toHaveText('Поправено – свалено за подпис')

    // The signed upload: a new file, never the old one overwritten.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')
    const upload = await page.request.post(`/admin/palnomoshtni/upload?personId=${PERSON}`, { data: pdf, headers: { 'content-type': 'application/pdf' } })
    expect(upload.status()).toBe(200)
    const uploaded = (await upload.json()) as { ok: boolean; fileId: string; url: string; brevo: { skipped?: boolean } }
    expect(uploaded.ok).toBe(true)
    expect(uploaded.fileId).toMatch(/^e2e-stub-e2e-rikfix-a-/)
    expect(uploaded.fileId).not.toBe(OLD_FILE)
    expect(uploaded.brevo.skipped).toBe(true)
    expect(d1(`SELECT designation_drive_file_id AS file, designation_pdf_url AS url, designation_signed_at IS NOT NULL AS signed FROM signups WHERE id = '${PERSON}'`)[0]).toEqual({
      file: uploaded.fileId,
      url: uploaded.url,
      signed: 1,
    })
    expect(d1(`SELECT drive_file_id AS file, replaced_by_file_id AS by FROM designation_file_history WHERE person_id = '${PERSON}'`)).toEqual([{ file: OLD_FILE, by: uploaded.fileId }])

    // Admin page: the new link, the old one in the history, the stage.
    await page.goto(`/admin/signups/${PERSON}`)
    await expect(page.getByRole('link', { name: uploaded.url })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('identity-fix-stage')).toHaveText('Подписано наново – подай поправката в РИК')
    const history = page.getByTestId('identity-fix-history')
    await expect(history.getByRole('link', { name: 'стар файл' })).toHaveAttribute('href', OLD_URL)
    await expect(history.getByRole('link', { name: 'новия' })).toHaveAttribute('href', uploaded.url)

    // The person's own download is the new file.
    await signIn(page, PERSON_SESSION)
    const own = await page.request.get('/profil/palnomoshtno.pdf')
    expect(own.status()).toBe(200)
    const body = (await own.body()).toString('latin1')
    expect(body).toContain(uploaded.fileId)
    expect(body).not.toContain(OLD_FILE)
  })
})
