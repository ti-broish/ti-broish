import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// A volunteer with a signed пълномощно changes their own name on /signup: confirm first, then the
// change is saved with audit and a РИК task „Смяна име/ЕГН – нов документ“ opens; from it an admin
// issues the new document (same number/МИР) and the signed upload replaces the old file.
// Drive and Brevo are never called: e2e- ids get a stub Drive file in `vite dev`, no Brevo key.
const STAFF_EMAIL = 'selfid.admin-e2e@example.com'
const SESSION = 'e2e-selfid-admin-session'
const PERSON = 'e2e-selfid-a'
const PERSON_EMAIL = 'selfid.a-e2e@example.com'
const PERSON_SESSION = 'e2e-selfid-a-session'
const MIR = '29'
const NUMBER = 917
const OLD_FILE = 'e2e-stub-selfid-old'
const OLD_URL = `https://drive.google.com/file/d/${OLD_FILE}/view`
const CONFIRM = 'Сигурни ли сте? Ще трябва да издадем ново пълномощно и да коригираме данните в РИК.'
const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

const OLD_EGN = egn(84, 8, 10, 917)

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
DELETE FROM signups WHERE id IN ('e2e-selfid-admin', '${PERSON}');
DELETE FROM staff WHERE email = '${STAFF_EMAIL}';
DELETE FROM signup_audit WHERE signup_id = '${PERSON}';
DELETE FROM rik_tasks WHERE person_id = '${PERSON}';
`

function payload(first: string, middle: string, last: string, email: string) {
  return JSON.stringify({
    firstName: first,
    middleName: middle,
    lastName: last,
    phone: '0888555222',
    email,
    role: 'section',
    rounds: { first: true, runoff: true },
    radius: 'settlement',
    consent: true,
    submitted: true,
    emailConfirmed: true,
    place: { regionCode: '29', regionName: 'Хасково', municipalityName: 'Хасково', townName: 'гр. Хасково', sectionPlace: 'ул. Смяна 1' },
  })
}

function seed() {
  const tables = readFileSync(new URL('../sql/2026-10-21-rik-registrations.sql', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
  wranglerLocal([
    '--command',
    `${tables}
${CLEANUP}
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, created_at, updated_at)
VALUES ('e2e-selfid-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2eslfad', '${payload('Админ', '', 'Смени', STAFF_EMAIL)}', 1, 0, 1, '', datetime('now'), datetime('now'));
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now')) ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, consent, withdrawn, submitted, egn, role, mir_code, region_code, town_name, section_place,
  rounds_first, rounds_runoff, radius, designation_mir, designation_number, designation_issued_at,
  designation_generated_at, designation_signing_generated_at, designation_signed_at, designation_first_signed_at, designation_drive_file_id, designation_pdf_url, signup_mail_at, created_at, updated_at)
VALUES ('${PERSON}', '${PERSON_EMAIL}', '${PERSON_SESSION}', 'e2eslfa', '${payload('Самостойна', 'Първа', 'Старова', PERSON_EMAIL)}', 1, 1, 0, 1, '${OLD_EGN}', 'section', '29', '29', 'гр. Хасково', 'ул. Смяна 1',
  1, 1, 'settlement', '${MIR}', ${NUMBER}, '19.10.2026', '2026-10-19T08:00:00.000Z', '2026-10-19T08:30:00.000Z', '2026-10-19T09:00:00.000Z', '2026-10-19T09:00:00.000Z', '${OLD_FILE}', '${OLD_URL}', 'skipped',
  datetime('now'), datetime('now'));
INSERT INTO rik_sources (mir, name, base_url, contacts_url, phones, adapter, health, updated_at)
VALUES ('${MIR}', 'Хасково', 'https://rik29.cik.bg/pvr2026', 'https://rik29.cik.bg/pvr2026/contacts', '0888 000 000', 'cik-platform/rik', 'ok', '2026-10-21T08:00:00.000Z')
ON CONFLICT(mir) DO NOTHING;
`,
  ])
}

async function signIn(page: Page, session: string) {
  await page.context().clearCookies()
  await page.context().addCookies([{ name: 'tb_session', value: session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
}

/** Resolves when a call to the server function `name` has answered. */
function answered(page: Page, name: string) {
  return page.waitForResponse(
    (response) => {
      const match = response.url().match(/\/_serverFn\/([^/?]+)/)
      if (!match || response.request().method() !== 'POST') return false
      const id = Buffer.from(match[1]!.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
      return id.includes(`"export":"${name}`)
    },
    { timeout: 20_000 },
  )
}

test.describe('self-service name change with a пълномощно', () => {
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

  test('confirm step → saved with audit and a РИК task → „Издай нов документ“ → signed upload replaces the file', async ({ page, browser }) => {
    test.setTimeout(120_000)
    await signIn(page, PERSON_SESSION)
    await page.goto('/profil')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('Самостойна, това е профилът ти')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('link', { name: 'Промени данните' }).click()
    const last = page.getByLabel('Фамилия', { exact: true })
    await expect(last).toHaveValue('Старова', { timeout: 30_000 })

    // Held back: the confirm step, the stored name stays, no task.
    let saved = answered(page, 'saveSignup')
    await last.fill('Новова')
    await saved
    const confirm = page.getByTestId('identity-change-confirm')
    await expect(confirm).toContainText(CONFIRM)
    await expect(confirm).toContainText('„Самостойна Първа Старова“ → „Самостойна Първа Новова“')
    expect(d1(`SELECT json_extract(payload, '$.lastName') AS last FROM signups WHERE id = '${PERSON}'`)[0]).toEqual({ last: 'Старова' })
    expect(d1(`SELECT COUNT(*) AS n FROM rik_tasks WHERE person_id = '${PERSON}'`)[0]).toEqual({ n: 0 })

    // „Не“: the old name is back in the form, nothing changed.
    await confirm.getByRole('button', { name: 'Не, остави старите' }).click()
    await expect(last).toHaveValue('Старова')
    await expect(confirm).toHaveCount(0)

    // „Да“: saved with audit, the task opens, the document is untouched.
    saved = answered(page, 'saveSignup')
    await last.fill('Новова')
    await saved
    const confirmed = answered(page, 'confirmOwnIdentityChange')
    await page.getByTestId('identity-change-confirm').getByRole('button', { name: 'Да, смени' }).click()
    await confirmed
    await expect(page.getByTestId('identity-change-note')).toContainText('Екипът ще издаде ново пълномощно')
    expect(d1(`SELECT json_extract(payload, '$.lastName') AS last, designation_drive_file_id AS file, designation_signed_at AS signed FROM signups WHERE id = '${PERSON}'`)[0]).toEqual({
      last: 'Новова',
      file: OLD_FILE,
      signed: '2026-10-19T09:00:00.000Z',
    })
    expect(d1(`SELECT actor, field, before_text AS b, after_text AS a FROM signup_audit WHERE signup_id = '${PERSON}'`)).toEqual([
      { actor: `self:${PERSON_EMAIL}`, field: 'name', b: 'Самостойна Първа Старова', a: 'Самостойна Първа Новова' },
    ])
    const tasks = d1(`SELECT id, type, mir, old_name, fixed_at, detail FROM rik_tasks WHERE person_id = '${PERSON}'`)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ type: 'self_identity', mir: MIR, old_name: 'Самостойна Първа Старова', fixed_at: null })
    expect(String(tasks[0]!.detail)).not.toContain(OLD_EGN)
    // Saving again does not ask again.
    await page.getByLabel('Телефон').fill('0888555223')
    await answered(page, 'saveSignup')
    await expect(page.getByTestId('identity-change-confirm')).toHaveCount(0)

    // Staff: the task on /admin/rik → „Издай нов документ“.
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3000' })
    const admin = await context.newPage()
    await signIn(admin, SESSION)
    await admin.goto(`/admin/rik?view=tasks&mir=${MIR}&type=self_identity`)
    const row = admin.getByRole('row').filter({ hasText: 'Самостойна Първа Новова' })
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText('Смяна име/ЕГН – нов документ')
    await expect(row).toContainText('„Самостойна Първа Старова“ → „Самостойна Първа Новова“')
    await expect(row.getByRole('button', { name: 'Поправи име/ЕГН' })).toHaveCount(0)
    await row.getByRole('button', { name: 'Издай нов документ' }).click()
    await expect(admin.getByTestId('identity-fix-note')).toContainText('Новите данни (от човека): „Самостойна Първа Новова“')
    const issued = admin.getByRole('row').filter({ hasText: 'Самостойна Първа Новова' })
    await expect(issued.getByTestId('rik-task-fix-stage')).toHaveText('Поправено – чака подпис')
    await expect(issued.getByRole('button', { name: 'Издай нов документ' })).toHaveCount(0)
    expect(d1(`SELECT designation_number AS n, designation_mir AS mir, designation_signed_at AS signed, designation_drive_file_id AS file FROM signups WHERE id = '${PERSON}'`)[0]).toEqual({
      n: NUMBER,
      mir: MIR,
      signed: null,
      file: null,
    })
    expect(d1(`SELECT old_name, new_name, task_id FROM designation_renames WHERE person_id = '${PERSON}'`)).toEqual([
      { old_name: 'Самостойна Първа Старова', new_name: 'Самостойна Първа Новова', task_id: tasks[0]!.id },
    ])
    expect(d1(`SELECT drive_file_id AS file FROM designation_file_history WHERE person_id = '${PERSON}'`)).toEqual([{ file: OLD_FILE }])

    // The signed upload: a new file; the old one stays in the history.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')
    const upload = await admin.request.post(`/admin/palnomoshtni/upload?personId=${PERSON}`, { data: pdf, headers: { 'content-type': 'application/pdf' } })
    expect(upload.status()).toBe(200)
    const uploaded = (await upload.json()) as { ok: boolean; fileId: string; brevo: { skipped?: boolean } }
    expect(uploaded.ok).toBe(true)
    expect(uploaded.fileId).not.toBe(OLD_FILE)
    expect(uploaded.brevo.skipped).toBe(true)
    expect(d1(`SELECT drive_file_id AS file, replaced_by_file_id AS by FROM designation_file_history WHERE person_id = '${PERSON}'`)).toEqual([{ file: OLD_FILE, by: uploaded.fileId }])
    await admin.reload()
    await expect(admin.getByRole('row').filter({ hasText: 'Самостойна Първа Новова' }).getByTestId('rik-task-fix-stage')).toHaveText('Подписано наново – подай поправката в РИК')
    await context.close()
  })
})
