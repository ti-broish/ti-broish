import { expect, test, type Page } from '@playwright/test'

// The home page and the unit pages are the old results site (https://github.com/ti-broish/results).
// Units come from fixed data on the e2e server (src/home/results-fixtures.ts); the feed from /api/violations,
// mocked here. The service worker would hide the fetch from page.route.
test.use({ serviceWorkers: 'block' })

const item = (id: string, region: string, text: string) => ({
  id,
  video: false,
  text,
  createdAt: '2026-10-25T07:30:00.000Z',
  town: region === '16' ? 'Пловдив' : 'Варна',
  municipality: region === '16' ? 'Пловдив' : 'Варна',
  country: null,
  region,
  municipalityKey: `${region}06`,
  section: `${region}0600001`,
  place: 'ОУ „Христо Ботев“',
})

async function mockFeed(page: Page, items: ReturnType<typeof item>[]) {
  await page.route('**/api/violations*', async (route) => {
    const url = new URL(route.request().url())
    const segment = url.searchParams.get('segment')
    const listed = segment ? items.filter((entry) => entry.section.startsWith(segment)) : items
    await route.fulfill({ json: { items: listed, counts: null, more: false, fetchedAt: Date.now() } })
  })
}

const signals = [item('01KAAAAAAAAAAAAAAAAAAAAAA1', '03', 'Сигнал от Варна'), item('01KAAAAAAAAAAAAAAAAAAAAAA2', '16', 'Първи от Пловдив')]

test('the home page has the map, the regions and the feed, and the signal link keeps the partner', async ({ page }) => {
  await mockFeed(page, signals)
  await page.goto('/?origin=iaz')
  await expect(page.getByRole('heading', { name: 'Президентски избори 25.10.2026' })).toBeVisible()
  await expect(page.locator('svg#bulgaria-map path')).toHaveCount(32)
  await expect(page.getByRole('button', { name: 'Сигнали', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: 'Избирателни райони' })).toBeVisible()
  await expect(page.getByText('Сигнал от Варна')).toBeVisible()
  const card = page.getByTestId('violation-card').first()
  await expect(card.getByRole('link', { name: 'Област 03. Варна' })).toHaveAttribute('href', '/03')
  await expect(card.getByRole('link', { name: '030600001' })).toHaveAttribute('href', '/030600001')
  await expect(page.locator('main').getByRole('link', { name: 'Подай сигнал →' })).toHaveAttribute('href', '/signal?origin=iaz')
  const signal = page.locator('main').getByRole('link', { name: 'Подай сигнал', exact: true })
  await expect(signal).toHaveAttribute('href', '/signal?origin=iaz')
  await signal.click()
  await expect(page).toHaveURL('/signal?origin=iaz')
})

test('a region on the map opens its page, with breadcrumbs down to a section', async ({ page }) => {
  await mockFeed(page, signals)
  await page.goto('/')
  await page.locator('path[aria-label="Варна"]').click()
  await expect(page).toHaveURL('/03')
  await expect(page.getByRole('heading', { name: '03. Варна', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Общини' })).toBeVisible()
  await expect(page.getByText('Сигнал от Варна')).toBeVisible()
  await expect(page.getByText('Първи от Пловдив')).toHaveCount(0)
  await page.locator('.rs-subdivision').getByRole('link', { name: 'Варна' }).click()
  await expect(page).toHaveURL('/0306')
  await expect(page.getByRole('heading', { name: 'Община Варна' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Всичко' })).toBeVisible()
  await page.getByRole('link', { name: 'Секция 001' }).click()
  await expect(page).toHaveURL('/030600001')
  await expect(page.getByRole('heading', { name: 'Секция 030600001' })).toBeVisible()
  const crumbs = page.getByRole('navigation', { name: 'Навигация' })
  await expect(crumbs.getByRole('link', { name: 'Президентски избори 25.10.2026' })).toHaveAttribute('href', '/')
  await expect(crumbs.getByRole('link', { name: 'Варна' }).first()).toHaveAttribute('href', '/03')
  await expect(page.getByRole('heading', { name: 'Местоположение' })).toBeVisible()
  await expect(page.getByText('Висок')).toBeVisible()
  await expect(page.getByRole('link', { name: '▶ Видеоизлъчване от секцията' })).toHaveAttribute(
    'href',
    'https://evideo.bg/pvr2026/03.html#030600001',
  )
  await expect(page.getByText('1 подаден сигнал')).toBeVisible()
  await expect(page.getByText('Сигнал от Варна')).toBeVisible()
})

test('an unknown unit is not found', async ({ page }) => {
  const response = await page.goto('/99')
  expect(response?.status()).toBe(404)
})

test('sample data is offered outside production only and is marked', async ({ page }) => {
  await page.goto('/?demo=1')
  await expect(page.getByText('Примерни данни.')).toBeVisible()
})
