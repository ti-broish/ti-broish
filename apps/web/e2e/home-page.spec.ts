import { expect, test } from '@playwright/test'

// `/` is the results site's map and feed of published signals (not the election-day 302 to /signal); signups stay closed.

test('the home page answers 200 and the signal button keeps the query string', async ({ page, request }) => {
  const response = await request.get('/?origin=iaz&oblast=23', { maxRedirects: 0 })
  expect(response.status()).toBe(200)
  await page.goto('/?origin=iaz&oblast=23&demo=1')
  await expect(page).toHaveURL('/?origin=iaz&oblast=23&demo=1')
  await expect(page.locator('main').getByRole('link', { name: 'Подай сигнал', exact: true })).toHaveAttribute('href', '/signal?origin=iaz&oblast=23')
})

test('the logo inside the app leads to the home map', async ({ page }) => {
  await page.goto('/faq')
  await page.locator('.site-header-inner a').first().click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Президентски избори 25.10.2026' })).toBeVisible()
})
