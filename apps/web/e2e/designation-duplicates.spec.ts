import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

// One person, one пълномощно: the ЕГН guard on „Номерирай“, the duplicate badge, the „И аз“ withdrawal
// and that neither a duplicate nor a withdrawn row reaches the signing ZIP. All names and ЕГН are fake.
const STAFF_EMAIL = 'dup.admin-e2e@example.com'
const SESSION = 'e2e-dup-admin-session'

function egn(yy: number, mm: number, dd: number, serial: number) {
  const body = `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

const E1 = egn(71, 1, 11, 811)
const E2 = egn(72, 2, 12, 822)
const E3 = egn(73, 3, 13, 833)
const E5 = egn(75, 5, 15, 855)
const SIGNUPS = ['e2e-dup-a', 'e2e-dup-b', 'e2e-dup-c', 'e2e-dup-admin']
const PARTNERS = ['pp-e2e-dup-1', 'pp-e2e-dup-2', 'pp-e2e-dup-3', 'pp-e2e-dup-5']
const quoted = (ids: string[]) => ids.map((id) => `'${id}'`).join(', ')

test.describe('пълномощни: one ЕГН, one number', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seed()
  })

  test.afterAll(() => cleanup())

  test('Номерирай skips ЕГН duplicates and covered „И аз“ rows; a duplicate is badged, kept out of the ZIP and can be withdrawn', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/admin/palnomoshtni')
    await expect(page.getByRole('button', { name: 'Номерирай' })).toBeEnabled({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Номерирай' }).click()
    await expect(page.getByText(/пропуснати \d+ \(дубликат по ЕГН\)/)).toBeVisible()
    await expect(page.getByText(/пропуснати \d+ \(покрит от доброволец\)/)).toBeVisible()
    await expect(page.getByText(/пропуснати \d+ \(вече с номер в същия МИР\)/)).toBeVisible()

    const n = numbers()
    // Volunteers first: A and B keep the number; the „И аз“ rows with their ЕГН get none, nor the covered one.
    // P1 is in A's МИР (03): covered by A's number. P2 is in МИР 16, B's number is for 17: a real duplicate.
    expect(n['e2e-dup-a']).toEqual(expect.any(Number))
    expect(n['e2e-dup-b']).toEqual(expect.any(Number))
    expect(n['pp-e2e-dup-5']).toEqual(expect.any(Number))
    expect([n['pp-e2e-dup-1'], n['pp-e2e-dup-2'], n['pp-e2e-dup-3']]).toEqual([null, null, null])
    // One audit line per number assigned.
    const audit = d1(`SELECT signup_id AS id, COUNT(*) AS c FROM signup_audit WHERE field = 'designation_number' AND signup_id IN (${quoted([...SIGNUPS, ...PARTNERS])}) GROUP BY signup_id ORDER BY signup_id`)
    expect(audit).toEqual([
      { id: 'e2e-dup-a', c: 1 },
      { id: 'e2e-dup-b', c: 1 },
      { id: 'pp-e2e-dup-5', c: 1 },
    ])

    const p1 = partnerRow(page, 'Дубъл Първи Партньоров')
    await expect(p1.getByTestId('covered-by-badge')).toHaveText(`Покрит от № 03/${n['e2e-dup-a']} — същото ЕГН, същия МИР`)
    await expect(p1.getByTestId('duplicate-badge')).toHaveCount(0)
    await expect(partnerRow(page, 'Дубъл Втори Партньоров').getByTestId('duplicate-badge')).toHaveText(`Дубликат: същото ЕГН има № ${n['e2e-dup-b']} (МИР 17)`)
    await expect(partnerRow(page, 'Покрит Трети Партньоров').getByTestId('covered-badge')).toHaveText('покрит от доброволец')
    // A second run numbers nobody new among them.
    await page.getByRole('button', { name: 'Номерирай' }).click()
    await expect(page.getByText(/пропуснати \d+ \(дубликат по ЕГН\)/)).toBeVisible()
    expect(numbers()['pp-e2e-dup-1']).toBeNull()

    // The state prod had before the guard: the „И аз“ row got its own number in the same МИР.
    wranglerLocal([
      '--command',
      `UPDATE partner_people SET designation_issued_at = '19.10.2026', designation_number = 1 + MAX(
         COALESCE((SELECT MAX(designation_number) FROM signups WHERE designation_mir = '03'), 500),
         COALESCE((SELECT MAX(designation_number) FROM partner_people WHERE designation_mir = '03'), 500))
       WHERE id = 'pp-e2e-dup-1'`,
    ])
    const legacy = numbers()['pp-e2e-dup-1']!
    await page.reload()
    await expect(p1.getByTestId('duplicate-badge')).toHaveText(`Дубликат: същото ЕГН има № ${n['e2e-dup-a']}`, { timeout: 30_000 })
    await expect(page.getByTestId('duplicate-count')).toContainText('Дубликати по ЕГН:')
    const before = await zipFiles('/admin/palnomoshtni/zip?mir=03&partner=1&offset=0&limit=50')
    expect(before).toContain(`03_${n['pp-e2e-dup-5']}_Чист_Пети_Партньоров.pdf`)
    expect(before.join('\n')).not.toContain('Дубъл_Първи_Партньоров')

    // Withdraw the duplicate „И аз“ пълномощно.
    await p1.getByRole('button', { name: 'Оттегли пълномощното' }).click()
    await p1.getByLabel(/Причина/).fill('Дубликат на № ' + n['e2e-dup-a'] + ' (доброволец)')
    await p1.getByRole('button', { name: 'Потвърди оттеглянето' }).click()
    await expect(page.getByText(new RegExp(`Пълномощното № ${legacy} \\(МИР 03\\) е оттеглено`))).toBeVisible()
    await expect(p1.getByTestId('withdrawn-badge')).toContainText('Оттеглено: Дубликат на №')
    await expect(p1.getByTestId('duplicate-badge')).toHaveCount(0)
    await expect(p1.getByRole('button', { name: 'Оттегли пълномощното' })).toHaveCount(0)
    expect(d1(`SELECT designation_number AS n, designation_mir AS mir, withdrawn_at IS NOT NULL AS w, withdrawn_by AS by FROM partner_people WHERE id = 'pp-e2e-dup-1'`)[0]).toEqual({
      n: legacy,
      mir: '03',
      w: 1,
      by: STAFF_EMAIL,
    })
    expect(d1(`SELECT before_text AS b, after_text AS a FROM signup_audit WHERE signup_id = 'pp-e2e-dup-1' AND field = 'partner_withdrawn'`)).toEqual([
      { b: `активно № 03/${legacy}`, a: `оттеглено: Дубликат на № ${n['e2e-dup-a']} (доброволец)` },
    ])
    await expect(page.getByTestId('partner-counts')).toContainText(/оттеглени \d+/)
    expect((await zipFiles('/admin/palnomoshtni/zip?mir=03&partner=1&offset=0&limit=50')).join('\n')).not.toContain('Дубъл_Първи_Партньоров')
    // The withdrawn number stays used: the next number in МИР 03 is above it.
    await page.getByRole('button', { name: 'Номерирай' }).click()
    expect(numbers()['pp-e2e-dup-1']).toBe(legacy)
  })
})

function partnerRow(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name })
}

function numbers() {
  const rows = d1(`SELECT id, designation_number AS n FROM signups WHERE id IN (${quoted(SIGNUPS)})
    UNION ALL SELECT id, designation_number AS n FROM partner_people WHERE id IN (${quoted(PARTNERS)})`) as Array<{ id: string; n: number | null }>
  return Object.fromEntries(rows.map((row) => [row.id, row.n])) as Record<string, number | null>
}

async function zipFiles(url: string) {
  const response = await currentRequest!.get(url)
  if (response.status() === 400) return []
  expect(response.status()).toBe(200)
  const files = unzipSync(new Uint8Array(await response.body()))
  // Files are МИР_НОМЕР_ИМЕ_ПРЕЗИМЕ_ФАМИЛИЯ.pdf; the manifest carries no id.
  expect(strFromU8(files['manifest.csv']!)).toContain('fileName')
  return Object.keys(files).filter((name) => name.endsWith('.pdf'))
}

let currentRequest: Page['request'] | null = null

async function signIn(page: Page) {
  currentRequest = page.request
  await page.context().addCookies([{ name: 'tb_session', value: SESSION, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' }])
}

function signupValues(id: string, email: string, first: string, last: string, egnValue: string, section: string | null) {
  const payload = JSON.stringify({ firstName: first, middleName: 'Тестов', lastName: last, email, phone: '0888000111' })
  return `('${id}', '${email}', NULL, '${id.slice(-8)}', '${payload}', 1, 0, 1, '${egnValue}', ${section ? `'${section}'` : 'NULL'}, datetime('now'), datetime('now'))`
}

function seed() {
  cleanup()
  const sql = `
INSERT INTO signups (id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, published_section, created_at, updated_at) VALUES
  ('e2e-dup-admin', '${STAFF_EMAIL}', '${SESSION}', 'e2edupad', '{"firstName":"Админ","lastName":"Дубъл","email":"${STAFF_EMAIL}","phone":"0888000997"}', 1, 0, 1, '', NULL, datetime('now'), datetime('now')),
  ${signupValues('e2e-dup-a', 'dup.a-e2e@example.com', 'Дубъл', 'Първи', E1, '030699801')},
  ${signupValues('e2e-dup-b', 'dup.b-e2e@example.com', 'Дубъл', 'Втори', E2, '171399802')},
  ${signupValues('e2e-dup-c', 'dup.c-e2e@example.com', 'Покрит', 'Трети', E3, null)};
INSERT INTO staff (email, role, invited_by, created_at) VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now')) ON CONFLICT(email) DO UPDATE SET role = 'admin';
INSERT INTO partner_people (id, partner, egn, email, first_name, middle_name, last_name, region_code, region_name, designation_mir, covered_by_signup_id, imported_at, updated_at) VALUES
  ('pp-e2e-dup-1', 'iaz.bg', '${E1}', 'dup.p1-e2e@example.com', 'Дубъл', 'Първи', 'Партньоров', '03', 'Варна', '03', NULL, datetime('now'), datetime('now')),
  ('pp-e2e-dup-2', 'iaz.bg', '${E2}', 'dup.p2-e2e@example.com', 'Дубъл', 'Втори', 'Партньоров', '16', 'Пловдив град', '16', NULL, datetime('now'), datetime('now')),
  ('pp-e2e-dup-3', 'iaz.bg', '${E3}', 'dup.p3-e2e@example.com', 'Покрит', 'Трети', 'Партньоров', '04', 'Велико Търново', '04', 'e2e-dup-c', datetime('now'), datetime('now')),
  ('pp-e2e-dup-5', 'iaz.bg', '${E5}', 'dup.p5-e2e@example.com', 'Чист', 'Пети', 'Партньоров', '03', 'Варна', '03', NULL, datetime('now'), datetime('now'));
`
  wranglerLocal(['--command', sql])
}

function cleanup() {
  wranglerLocal([
    '--command',
    `DELETE FROM signup_audit WHERE signup_id IN (${quoted([...SIGNUPS, ...PARTNERS])});
     DELETE FROM partner_people WHERE id IN (${quoted(PARTNERS)}) OR egn IN ('${E1}', '${E2}', '${E3}', '${E5}');
     DELETE FROM signups WHERE id IN (${quoted(SIGNUPS)});
     DELETE FROM staff WHERE email = '${STAFF_EMAIL}';`,
  ])
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
      if (attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}
