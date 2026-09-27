import { expect, test } from '@playwright/test'

test('the roster stays out of the menu and asks for a confirmed team email', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.site-nav')).not.toContainText('Записани')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Админ' })).toBeVisible()
  await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Достъп' })).toHaveCount(0)
  await page.goto('/admin/sections')
  await expect(page.getByRole('button', { name: 'Публикувай черновите в този изглед' })).toHaveCount(0)
})
