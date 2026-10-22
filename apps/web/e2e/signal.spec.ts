import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import type { HomePlace } from '../src/signup/model'
import { seedProfile } from './helpers'

// /signal sends violations to api.tibroish.bg like the old form. The API is mocked here.

const sofia: HomePlace = {
  regionCode: 'sofia-merged',
  regionName: 'София-град',
  municipalityCode: '46',
  municipalityName: 'Столична',
  townId: 68134,
  townName: 'гр. София',
  cityRegionCode: '15',
  cityRegionName: 'Младост',
}

// 8×8 red PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4o6SEFTEMLQkAvM5EAT6yk8sAAAAASUVORK5CYII=',
  'base64',
)

interface Seen {
  pictures: Record<string, unknown>[]
  violations: Record<string, unknown>[]
}

// Context routes: page routes did not catch the API read after the in-app navigation to /izprateni/$id.
async function mockApi(page: Page, violation: { status: number; body: unknown }) {
  const seen: Seen = { pictures: [], violations: [] }
  await page.context().route('https://api.tibroish.bg/pictures', async (route) => {
    seen.pictures.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ id: `pic-${seen.pictures.length}`, url: `https://tibroish.bg/photos/test-${seen.pictures.length}.jpg` }),
    })
  })
  await page.context().route('https://api.tibroish.bg/violations', async (route) => {
    seen.violations.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({
      status: violation.status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(violation.body),
    })
  })
  await page.context().route((url) => url.hostname === 'api.tibroish.bg' && url.pathname.startsWith('/violations/'), async (route) => {
    const url = new URL(route.request().url())
    const ok = url.searchParams.get('secret') === 'secret-1'
    await route.fulfill({
      status: ok ? 200 : 403,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(
        ok
          ? {
              id: '01TESTSIGNAL00000000000000',
              status: 'received',
              description: 'Председателят не записа забележката в протокола.',
              createdAt: '2026-10-20T12:00:00.000Z',
              town: { name: 'гр. София' },
              pictures: [{ url: 'https://tibroish.bg/photos/test-1.jpg' }],
            }
          : { statusCode: 403 },
      ),
    })
  })
  await page.context().route('https://tibroish.bg/photos/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  return seen
}

async function fillSignal(page: Page) {
  await seedProfile(page, { firstName: 'Иван', lastName: 'Иванов', email: 'ivan@example.com', phone: '0888123456', place: { ...sofia } })
  await page.goto('/signal')
  await page.waitForLoadState('networkidle')
  await expect(page.getByLabel('Име', { exact: true })).toHaveValue('Иван Иванов')
  await page.getByLabel('Описание на нарушението').fill('Председателят не записа забележката в протокола.')
}

test('a signal goes to the API: pictures first, then the violation', async ({ page }) => {
  const seen = await mockApi(page, { status: 201, body: { id: '01TESTSIGNAL00000000000000', secret: 'secret-1' } })
  await fillSignal(page)
  await page.locator('input[type=file]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByText('1 снимки.')).toBeVisible()
  await page.getByRole('button', { name: 'Изпрати' }).click()
  await expect(page.getByRole('heading', { name: 'Сигналът е изпратен' })).toBeVisible()
  await expect(page.getByText('01TESTSIGNAL00000000000000')).toBeVisible()
  expect(seen.pictures).toHaveLength(1)
  expect(String(seen.pictures[0].image)).toMatch(/^data:image\/jpeg;base64,/)
  expect(seen.violations).toEqual([
    {
      town: 68134,
      description: 'Председателят не записа забележката в протокола.',
      name: 'Иван Иванов',
      email: 'ivan@example.com',
      phone: '+359888123456',
      type: 'standard',
      pictures: ['pic-1'],
    },
  ])
  await page.getByRole('link', { name: 'Виж сигнала' }).click()
  await expect(page.getByText('Получен. Номер:')).toBeVisible()
  await expect(page.getByText('Председателят не записа забележката в протокола.')).toBeVisible()
  await page.getByRole('link', { name: 'Назад към изпратените' }).click()
  await expect(page.getByRole('link', { name: /Председателят не записа/ })).toBeVisible()
})

test('API validation errors show in Bulgarian and nothing is stored as sent', async ({ page }) => {
  const seen = await mockApi(page, {
    status: 400,
    body: { statusCode: 400, message: ['errors.town.Town with code "68134" does not exist!', 'Телефонният номер е невалиден'] },
  })
  await fillSignal(page)
  await page.getByRole('button', { name: 'Изпрати' }).click()
  await expect(page.getByText(/^Сигналът не беше изпратен\. Населеното място не е намерено\..*Телефонният номер е невалиден/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Сигналът е изпратен' })).toHaveCount(0)
  expect(seen.pictures).toHaveLength(0)
  expect(seen.violations).toHaveLength(1)
})

// Partners redirect people to /signal?name=…&email=…&oblast=… (see src/signup/signal-prefill.ts).
function linkTo(params: Record<string, string>) {
  return `/signal?${new URLSearchParams(params).toString()}`
}

test('a partner link pre-fills name, email and oblast, then leaves the address bar', async ({ page }) => {
  await page.goto(linkTo({ name: 'Мария Петрова', email: 'maria.link@example.com', oblast: '23' }))
  await page.waitForLoadState('networkidle')
  await expect(page.getByLabel('Име', { exact: true })).toHaveValue('Мария Петрова')
  await expect(page.getByLabel('Имейл', { exact: true })).toHaveValue('maria.link@example.com')
  await expect(page.getByRole('combobox', { name: 'Област', exact: true })).toHaveValue('sofia-merged')
  await expect(page.getByRole('combobox', { name: 'Община', exact: true })).toHaveValue('46')
  await expect(page.getByText('Попълнихме част от полетата. Можеш да ги промениш.')).toBeVisible()
  await expect.poll(() => new URL(page.url()).search).toBe('')
  // Still editable.
  await page.getByLabel('Име', { exact: true }).fill('Мария Иванова')
  await expect(page.getByLabel('Име', { exact: true })).toHaveValue('Мария Иванова')
  await page.getByRole('combobox', { name: 'Област', exact: true }).selectOption({ label: 'Варна' })
  await expect(page.getByRole('combobox', { name: 'Област', exact: true })).toHaveValue('03')
})

test('a partner link takes the oblast by Bulgarian name and ignores a value it does not know', async ({ page }) => {
  await page.goto(linkTo({ name: 'Петър', oblast: 'Варна' }))
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('combobox', { name: 'Област', exact: true })).toHaveValue('03')
  await expect(page.getByLabel('Име', { exact: true })).toHaveValue('Петър')
  await expect(page.getByLabel('Имейл', { exact: true })).toHaveValue('')

  await page.goto(linkTo({ name: 'Петър', email: 'not-an-email', oblast: 'Атлантида' }))
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('combobox', { name: 'Област', exact: true })).toHaveValue('')
  await expect(page.getByLabel('Име', { exact: true })).toHaveValue('Петър')
  await expect(page.getByLabel('Имейл', { exact: true })).toHaveValue('not-an-email')
})

test('linked name and email win over the profile and reach the API with the profile place', async ({ page }) => {
  const seen = await mockApi(page, { status: 201, body: { id: '01TESTSIGNAL00000000000000', secret: 'secret-1' } })
  await seedProfile(page, { firstName: 'Иван', lastName: 'Иванов', email: 'ivan@example.com', phone: '0888123456', place: { ...sofia } })
  await page.goto(linkTo({ name: 'Мария Петрова', email: 'maria.link@example.com', oblast: 'София' }))
  await page.waitForLoadState('networkidle')
  await expect(page.getByLabel('Име', { exact: true })).toHaveValue('Мария Петрова')
  await expect(page.getByLabel('Имейл', { exact: true })).toHaveValue('maria.link@example.com')
  await expect(page.getByLabel('Телефон', { exact: true })).toHaveValue('0888123456')
  await page.getByLabel('Описание на нарушението').fill('Председателят не записа забележката в протокола.')
  await page.getByRole('button', { name: 'Изпрати' }).click()
  await expect(page.getByRole('heading', { name: 'Сигналът е изпратен' })).toBeVisible()
  expect(seen.violations).toEqual([
    {
      town: 68134,
      description: 'Председателят не записа забележката в протокола.',
      name: 'Мария Петрова',
      email: 'maria.link@example.com',
      phone: '+359888123456',
      type: 'standard',
    },
  ])
})

const WEB_DIR = new URL('.', import.meta.url).pathname.replace(/e2e\/$/, '')

/** Local D1 through wrangler, retried while another process holds the SQLite lock. */
function d1(sql: string): Array<Record<string, unknown>> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const output = execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', '--json', '--command', sql], {
        cwd: WEB_DIR,
        stdio: 'pipe',
      }).toString()
      const parsed = JSON.parse(output.slice(output.indexOf('['))) as Array<{ results?: Array<Record<string, unknown>> }>
      return parsed.flatMap((item) => item.results ?? [])
    } catch (error) {
      if (attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
}

test('origin=iaz co-brands the page with iaz.bg and keeps Ти Броиш', async ({ page }) => {
  await page.goto(linkTo({ name: 'Мария Петрова', email: 'maria.link@example.com', oblast: '23', origin: 'iaz' }))
  await page.waitForLoadState('networkidle')
  const banner = page.getByRole('complementary', { name: 'Партньор: И аз' })
  await expect(banner).toBeVisible()
  await expect(banner.getByText('работи заедно с Ти Броиш')).toBeVisible()
  await expect(banner.getByRole('link', { name: 'iaz.bg' })).toHaveAttribute('href', 'https://iaz.bg/')
  const logo = banner.locator('img[src="/partners/iaz-logo.svg"]')
  await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
  // Ти Броиш stays: the site header and its logo are unchanged.
  await expect(page.locator('header.site-header img[alt="Ти Броиш"]')).toBeVisible()
  await expect(banner.getByText('Партньор на Ти Броиш')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Изпрати' })).toHaveCSS('background-color', 'rgb(255, 147, 76)')
  await expect(page.getByLabel('Име', { exact: true })).toHaveValue('Мария Петрова')
  await expect(page.getByRole('combobox', { name: 'Област', exact: true })).toHaveValue('sofia-merged')
  // Personal fields leave the address bar; the partner stays so a reload keeps the branding.
  await expect.poll(() => new URL(page.url()).search).toBe('?origin=iaz')
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Партньор: И аз' })).toBeVisible()
})

test('an unknown origin is ignored: no partner branding', async ({ page }) => {
  await page.goto(linkTo({ name: 'Петър', origin: 'someone-else' }))
  await page.waitForLoadState('networkidle')
  await expect(page.getByLabel('Име', { exact: true })).toHaveValue('Петър')
  await expect(page.getByRole('complementary', { name: 'Партньор: И аз' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Изпрати' })).toHaveCSS('background-color', 'rgb(83, 192, 164)')
  await expect.poll(() => new URL(page.url()).searchParams.has('name')).toBe(false)
})

test('a signal sent from origin=iaz stores the origin with the API violation id', async ({ page }) => {
  const id = `01E2EIAZ${Date.now()}`.padEnd(26, '0').slice(0, 26)
  const seen = await mockApi(page, { status: 201, body: { id, secret: 'secret-1' } })
  await seedProfile(page, { firstName: 'Иван', lastName: 'Иванов', email: 'ivan@example.com', phone: '0888123456', place: { ...sofia } })
  await page.goto(linkTo({ origin: 'iaz' }))
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Описание на нарушението').fill('Председателят не записа забележката в протокола.')
  await page.getByRole('button', { name: 'Изпрати' }).click()
  await expect(page.getByRole('heading', { name: 'Сигналът е изпратен' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Партньор: И аз' })).toBeVisible()
  // The API payload is unchanged: the origin is ours, not a field the API knows.
  expect(seen.violations).toHaveLength(1)
  expect(seen.violations[0]).not.toHaveProperty('origin')
  await expect.poll(() => d1(`SELECT origin FROM signal_origins WHERE violation_id = '${id}'`), { timeout: 15_000 }).toEqual([{ origin: 'iaz' }])
})
