import { expect, test } from '@playwright/test'

test('the roster stays out of the menu and asks for a confirmed team email', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.site-nav')).not.toContainText('Записани')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Записани хора' })).toBeVisible()
  await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'CSV за Brevo' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Покани' })).toHaveCount(0)
})
