import { expect, test, type Page } from '@playwright/test'
import { isProtocolOpen } from '../src/signup/election'

// /protokol sends protocols to the Ти Броиш API like the old results site. `vite dev` uses the production API
// (src/signup/api-base.ts), mocked here. ?protokol-test=1 opens the window outside 20:00–12:00 (never on tibroish.bg).

const API = 'https://api.tibroish.bg'
// 8×8 red PNG; the browser turns it into a JPEG before upload.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4o6SEFTEMLQkAvM5EAT6yk8sAAAAASUVORK5CYII=',
  'base64',
)
const photo = (index: number) => ({ name: `protokol-${index}.png`, mimeType: 'image/png', buffer: PNG })

async function mockApi(page: Page) {
  const seen = { pictures: [] as Record<string, unknown>[], protocols: [] as Record<string, unknown>[], contact: [] as Record<string, unknown>[] }
  await page.context().route(`${API}/results/meta.json`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ endOfElectionDayTimestamp: '2026-10-25T20:00:00+02:00' }) }),
  )
  await page.context().route(`${API}/pictures`, async (route) => {
    seen.pictures.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: `pic-${seen.pictures.length}` }) })
  })
  await page.context().route(`${API}/protocols`, async (route) => {
    seen.protocols.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'proto-e2e', secret: 'secret-e2e' }) })
  })
  await page.context().route(`${API}/protocols/proto-e2e/contact`, async (route) => {
    seen.contact.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 202, body: '' })
  })
  await page.context().route((url) => url.hostname === 'api.tibroish.bg' && url.pathname === '/protocols/proto-e2e', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'proto-e2e', status: 'received', createdAt: '2026-10-25T18:05:00Z', pictures: [] }),
    }),
  )
  return seen
}

test('outside the window /protokol says when it opens and the footer has no link', async ({ page }) => {
  test.skip(isProtocolOpen(), 'the real window is open now')
  await mockApi(page)
  await page.goto('/protokol')
  await expect(page.getByRole('heading', { name: /Протоколът се праща от|Изпращането на протоколи приключи/ })).toBeVisible()
  await expect(page.locator('footer')).not.toContainText('Изпрати протокол')
  await expect(page.getByRole('button', { name: 'Изпрати протокол' })).toHaveCount(0)
})

test('a protocol goes to the API: 4 photos picked at once, picture ids, email, receipt', async ({ page }) => {
  const seen = await mockApi(page)
  await page.goto('/protokol?protokol-test=1')
  await expect(page.getByRole('heading', { name: 'Изпрати протокол' })).toBeVisible()
  await expect(page.locator('footer')).toContainText('Изпрати протокол')
  const submit = page.getByRole('button', { name: 'Изпрати протокол' })
  await expect(submit).toBeDisabled()
  // All four in one pick: the field must keep every file, not only the first.
  await expect(async () => {
    await page.locator('input[type=file]').setInputFiles([photo(1), photo(2), photo(3), photo(4)])
    await expect(page.getByText('4 от поне 4 снимки.')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await page.getByLabel('Имейл, ако искаш да ти пишем при проблем със снимките').fill('test.protokol@example.com')
  await submit.click()
  await expect(page.getByRole('heading', { name: 'Протоколът е изпратен' })).toBeVisible()
  await expect(page.getByText('proto-e2e')).toBeVisible()
  expect(seen.pictures).toHaveLength(4)
  expect(String(seen.pictures[0].image)).toMatch(/^data:image\/jpeg;base64,/)
  expect(seen.protocols).toEqual([{ pictures: ['pic-1', 'pic-2', 'pic-3', 'pic-4'] }])
  expect(seen.contact).toEqual([{ email: 'test.protokol@example.com', secret: 'secret-e2e' }])
  await page.getByRole('link', { name: 'Виж протокола' }).click()
  await expect(page.getByRole('heading', { name: 'Протокол' })).toBeVisible()
  await expect(page.getByText('Получен. Номер:')).toBeVisible()
  await page.goto('/izprateni')
  await expect(page.getByRole('link', { name: /Протокол/ }).first()).toBeVisible()
})

test('an API error shows a message and the button does not stay on „Изпращаме…“', async ({ page }) => {
  await mockApi(page)
  await page.context().route(`${API}/protocols`, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
  await page.goto('/protokol?protokol-test=1')
  await expect(async () => {
    await page.locator('input[type=file]').setInputFiles([photo(1), photo(2), photo(3), photo(4)])
    await expect(page.getByText('4 от поне 4 снимки.')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Изпрати протокол' }).click()
  await expect(page.getByText('Протоколът не беше изпратен. Системата не отговаря, опитай пак след малко.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Изпрати протокол' })).toBeEnabled()
})
