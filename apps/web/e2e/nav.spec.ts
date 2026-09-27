import { expect, test } from '@playwright/test'

test('the top nav matches the short menu and the footer links to contact', async ({ page }) => {
  await page.goto('/')
  const nav = page.locator('.site-nav')
  await expect(nav).toContainText('Кампанията')
  await expect(nav).toContainText('Актуално')
  await expect(nav).toContainText('Инструкции')
  await expect(nav).toContainText('Подай сигнал')
  await expect(nav).toContainText('Профил')
  await expect(nav).not.toContainText('Запиши се')
  await expect(nav).not.toContainText('Извън страната')
  await expect(page.locator('footer')).not.toContainText('team@tibroish.bg')
  await page.locator('footer').getByRole('link', { name: 'Контакт' }).click()
  await expect(page.getByRole('heading', { name: 'Връзка с нас' })).toBeVisible()
  await page.getByRole('link', { name: 'въпросите и отговорите' }).click()
  await expect(page.getByRole('heading', { name: 'Въпроси и отговори' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Страницата „Извън страната“' })).toBeVisible()
})
