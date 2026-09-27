import { expect, test } from '@playwright/test'

test('the roster is not in the menu and opens on this machine', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.site-nav')).not.toContainText('Записани')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Записани хора' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Без секция' })).toBeVisible()
  const listed = page.waitForResponse((response) => response.url().includes('_serverFn') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Чернова' }).click()
  expect((await listed).ok()).toBe(true)
  await expect(page.getByText('Списъкът не се зареди.')).toHaveCount(0)
  await expect(page.getByText('Няма достъп.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Със секция' }).click()
  await expect(page.getByText('CSV за Brevo няма чернова')).toBeVisible()
})
