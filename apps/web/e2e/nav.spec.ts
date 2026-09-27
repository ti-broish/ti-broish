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
  const footer = page.locator('footer')
  await expect(footer).not.toContainText('team@tibroish.bg')
  await expect(footer).not.toContainText('Изпрати протокол')
  for (const [name, href] of [
    ['Facebook', 'https://www.facebook.com/tibroish/'],
    ['Instagram', 'https://www.instagram.com/tibroish/'],
    ['TikTok', 'https://www.tiktok.com/@tibroish'],
  ] as const) {
    const link = footer.getByRole('link', { name })
    await expect(link).toHaveAttribute('href', href)
    await expect(link).toHaveAttribute('target', '_blank')
  }
  await page.locator('footer').getByRole('link', { name: 'Контакт' }).click()
  await expect(page.getByRole('heading', { name: 'Връзка с нас' })).toBeVisible()
  await page.getByRole('link', { name: 'въпросите и отговорите' }).click()
  await expect(page.getByRole('heading', { name: 'Въпроси и отговори' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Страницата „Извън страната“' })).toBeVisible()
  await page.goto('/protokol')
  await expect(page.getByRole('heading', { name: 'Протоколът се праща в изборния ден' })).toBeVisible()
})
