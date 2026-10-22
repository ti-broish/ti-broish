import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

// File ids starting with e2e-stub- are answered by a local stub PDF in `vite dev`; Drive is never called.
const SIGNED = { id: 'e2e-own-signed', email: 'own.signed-e2e@example.com', session: 'e2e-own-signed-session', file: 'e2e-stub-own-signed-1' }
const RENAMED = { id: 'e2e-own-renamed', email: 'own.renamed-e2e@example.com', session: 'e2e-own-renamed-session', file: 'e2e-stub-own-renamed-1' }
const WITHDRAWN = { id: 'e2e-own-withdrawn', email: 'own.withdrawn-e2e@example.com', session: 'e2e-own-withdrawn-session', file: 'e2e-stub-own-withdrawn-1' }
const UNSIGNED = { id: 'e2e-own-unsigned', email: 'own.unsigned-e2e@example.com', session: 'e2e-own-unsigned-session', file: 'e2e-stub-own-unsigned-1' }
const PEOPLE = [SIGNED, RENAMED, WITHDRAWN, UNSIGNED]
const SECTION = '234600987'
const PDF_PATH = '/profil/palnomoshtno.pdf'

function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

test.describe('signed пълномощно on /profil', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test.afterAll(() => {
    wranglerLocal(['--command', `DELETE FROM signups WHERE id IN (${PEOPLE.map((person) => `'${person.id}'`).join(', ')});`])
  })

  test('a signed volunteer sees the card first and downloads only their own signed PDF', async ({ page }) => {
    await signIn(page, SIGNED.session)
    await page.goto('/profil')
    const card = page.getByTestId('own-designation')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toHaveAttribute('data-state', 'signed')
    await expect(card.getByRole('heading', { name: 'Твоето пълномощно' })).toBeVisible()
    await expect(card).toContainText('№ 941')
    await expect(card).toContainText('МИР23')
    await expect(card).toContainText(SECTION)
    await expect(card).toContainText('не е нужно да го печаташ')
    await expect(card.getByRole('link', { name: 'Отпечатай значката' })).toHaveAttribute('href', '/znachka')
    const button = card.getByRole('link', { name: 'Изтегли подписаното пълномощно (PDF)' })
    await expect(button).toHaveAttribute('href', PDF_PATH)
    // Above everything else, the page title included.
    const title = page.getByRole('heading', { level: 1 })
    expect((await card.boundingBox())!.y).toBeLessThan((await title.boundingBox())!.y)
    await expect(page.getByText('Дигиталното пълномощно идва след секцията')).toHaveCount(0)
    // The raw Drive id or link never reaches the page.
    expect(await page.content()).not.toContain(SIGNED.file)
    expect(await page.content()).not.toContain('drive.google.com')

    const downloadPromise = page.waitForEvent('download')
    await button.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('palnomoshtno-941.pdf')

    const response = await page.request.get(PDF_PATH)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/pdf')
    expect(response.headers()['content-disposition']).toBe('attachment; filename="palnomoshtno-941.pdf"')
    expect(response.headers()['cache-control']).toBe('private, no-store')
    const body = (await response.body()).toString('latin1')
    expect(body.startsWith('%PDF-')).toBe(true)
    expect(body).toContain(SIGNED.file)
    // An id or query in the URL changes nothing: the session picks the file.
    const swapped = await page.request.get(`${PDF_PATH}?id=${RENAMED.id}&personId=${RENAMED.id}`)
    expect((await swapped.body()).toString('latin1')).toContain(SIGNED.file)
  })

  test('renamed and waiting for re-signing: neutral state, no stale PDF', async ({ page }) => {
    await signIn(page, RENAMED.session)
    await page.goto('/profil')
    const card = page.getByTestId('own-designation')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toHaveAttribute('data-state', 'resigning')
    await expect(card).toContainText('Подписва се')
    await expect(page.getByRole('link', { name: 'Изтегли подписаното пълномощно (PDF)' })).toHaveCount(0)
    expect((await page.request.get(PDF_PATH)).status()).toBe(404)
  })

  for (const person of [WITHDRAWN, UNSIGNED]) {
    test(`no card and 404 for ${person.id}`, async ({ page }) => {
      await signIn(page, person.session)
      await page.goto('/profil')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 })
      await page.waitForLoadState('networkidle')
      await expect(page.getByTestId('own-designation')).toHaveCount(0)
      expect((await page.request.get(PDF_PATH)).status()).toBe(404)
    })
  }

  test('not signed in: 401 and nothing from the file', async ({ request }) => {
    const response = await request.get(PDF_PATH)
    expect(response.status()).toBe(401)
    expect(response.headers()['content-type']).not.toContain('pdf')
  })
})

async function signIn(page: Page, session: string) {
  await page.context().clearCookies()
  await page.context().addCookies([{ name: 'tb_session', value: session, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
}

function payload(first: string, last: string, email: string, withdrawn = false) {
  return JSON.stringify({
    firstName: first,
    middleName: 'Тестова',
    lastName: last,
    phone: '0888555222',
    email,
    role: 'section',
    rounds: { first: true, runoff: false },
    radius: 'settlement',
    consent: true,
    submitted: true,
    emailConfirmed: true,
    withdrawn,
    place: { regionCode: '23', regionName: 'София', municipalityName: 'Столична', townName: 'гр. София', sectionPlace: 'ул. Пълномощна 1' },
  })
}

function seed() {
  const row = (
    person: (typeof PEOPLE)[number],
    first: string,
    egnValue: string,
    number: number,
    withdrawn: number,
    signedAt: string | null,
    firstSignedAt: string | null,
  ) =>
    `('${person.id}', '${person.email}', '${person.session}', '${person.id.replace(/-/g, '').slice(0, 12)}', '${payload(first, 'Пълномощен', person.email, withdrawn === 1)}', 1, 1, ${withdrawn}, 1, '${egnValue}', 'section',
      '23', '23', 'гр. София', 'ул. Пълномощна 1', '${SECTION}', '${SECTION}', datetime('now'), 1, 0, 'settlement',
      ${number}, '23', '21.10.2026', ${signedAt ? `'${signedAt}'` : 'NULL'}, ${firstSignedAt ? `'${firstSignedAt}'` : 'NULL'}, '${person.file}',
      'https://drive.google.com/file/d/${person.file}/view', datetime('now'), datetime('now'))`
  const signed = '2026-10-21T09:00:00.000Z'
  const sql = `
DELETE FROM signups WHERE id IN (${PEOPLE.map((person) => `'${person.id}'`).join(', ')});
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, consent, withdrawn, submitted, egn, role,
  mir_code, region_code, town_name, section_place, draft_section, published_section, published_at, rounds_first, rounds_runoff, radius,
  designation_number, designation_mir, designation_issued_at, designation_signed_at, designation_first_signed_at, designation_drive_file_id,
  designation_pdf_url, created_at, updated_at)
VALUES
  ${row(SIGNED, 'Подписан', egn(84, 2, 3, 941), 941, 0, signed, signed)},
  ${row(RENAMED, 'Преименуван', egn(85, 3, 4, 942), 942, 0, null, signed)},
  ${row(WITHDRAWN, 'Оттеглен', egn(86, 4, 5, 943), 943, 1, signed, signed)},
  ${row(UNSIGNED, 'Неподписан', egn(87, 5, 6, 944), 944, 0, null, null)};
UPDATE signups SET signup_mail_at = 'skipped' WHERE id IN (${PEOPLE.map((person) => `'${person.id}'`).join(', ')});
`
  wranglerLocal(['--command', sql])
}

const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

/** Local D1 through wrangler, retried while another spec holds the SQLite lock. */
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
