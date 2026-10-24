import { expect, test, type Page } from '@playwright/test'

// The home page reads /api/violations (worker-cached copy of api.tibroish.bg). The API is mocked here
// so the specs do not depend on what is published on the day. The service worker would hide the fetch from page.route.
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
})

async function mockFeed(page: Page, items: ReturnType<typeof item>[]) {
  await page.route('**/api/violations*', async (route) => {
    const url = new URL(route.request().url())
    const segment = url.searchParams.get('segment')
    const listed = segment ? items.filter((entry) => entry.region === segment) : items
    const regions: Record<string, number> = {}
    for (const entry of items) regions[entry.region] = (regions[entry.region] ?? 0) + 1
    await route.fulfill({
      json: {
        items: listed,
        counts: segment ? null : { total: items.length, regions, municipalities: {}, unplaced: 0 },
        more: false,
        fetchedAt: Date.now(),
      },
    })
  })
}

test('the home page shows the empty feed and the signal button keeps the partner', async ({ page }) => {
  await mockFeed(page, [])
  await page.goto('/?origin=iaz')
  await expect(page.getByRole('heading', { name: 'Сигнали от изборния ден' })).toBeVisible()
  await expect(page.getByText('Все още няма публикувани сигнали')).toBeVisible()
  await expect(page.locator('svg.violations-map path')).toHaveCount(32)
  const signal = page.locator('main').getByRole('link', { name: 'Подай сигнал' })
  await expect(signal).toHaveAttribute('href', '/signal?origin=iaz')
  await signal.click()
  await expect(page).toHaveURL('/signal?origin=iaz')
})

test('the map counts signals by region and a region filters the feed', async ({ page }) => {
  await mockFeed(page, [item('A1', '03', 'Сигнал от Варна'), item('A2', '16', 'Първи от Пловдив'), item('A3', '16', 'Втори от Пловдив')])
  await page.goto('/')
  await expect(page.getByText('Сигнал от Варна')).toBeVisible()
  await expect(page.getByText('3 сигнала')).toBeVisible()
  await expect(page.locator('path[aria-label="Пловдив град: 2 сигнала"]')).toBeVisible()
  await page.locator('path[aria-label="Пловдив град: 2 сигнала"]').click()
  await expect(page.getByRole('heading', { name: 'Пловдив град' })).toBeVisible()
  await expect(page.getByText('Първи от Пловдив')).toBeVisible()
  await expect(page.getByText('Сигнал от Варна')).toHaveCount(0)
  await page.getByRole('button', { name: 'Всички райони' }).click()
  await expect(page.getByText('Сигнал от Варна')).toBeVisible()
})

test('sample data is offered outside production only and is marked', async ({ page }) => {
  await page.goto('/?demo=1')
  await expect(page.getByText('Примерни данни.')).toBeVisible()
  await expect(page.getByText('Пример', { exact: true }).first()).toBeVisible()
})
