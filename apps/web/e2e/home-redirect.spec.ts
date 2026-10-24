import { expect, test } from '@playwright/test'

// Election days: `/` is a temporary 302 to the violation form, query string kept (src/site/home-redirect.ts).

test('the home page answers with a 302 to /signal and keeps the query string', async ({ request }) => {
  const response = await request.get('/?origin=iaz&oblast=23', { maxRedirects: 0 })
  expect(response.status()).toBe(302)
  expect(response.headers()['location']).toBe('/signal?origin=iaz&oblast=23')
})

test('opening / lands on the co-branded violation form', async ({ page }) => {
  await page.goto('/?origin=iaz')
  await expect(page).toHaveURL('/signal?origin=iaz')
  await expect(page.getByRole('button', { name: 'Изпрати' })).toBeVisible()
})

test('the logo inside the app leads to the violation form', async ({ page }) => {
  await page.goto('/faq')
  await page.locator('.site-header-inner a').first().click()
  await expect(page).toHaveURL('/signal')
})

test('other routes are not redirected', async ({ request }) => {
  for (const path of ['/signal', '/vhod', '/faq', '/instructions']) {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(response.status(), path).toBe(200)
  }
})
