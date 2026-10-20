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
