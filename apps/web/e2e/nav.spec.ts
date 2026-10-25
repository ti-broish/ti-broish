import { expect, test } from '@playwright/test'
import { isProtocolOpen } from '../src/signup/election'

test('the top nav matches the short menu and the footer links to contact', async ({ page }) => {
  await page.goto('/')
  const nav = page.locator('.site-nav')
  await expect(nav).toContainText('Кампанията')
  await expect(nav).toContainText('Актуално')
  await expect(nav).toContainText('Инструкции')
  await expect(nav).toContainText('Подай сигнал')
  await expect(nav).toContainText('Профил')
  await nav.getByRole('link', { name: 'Актуално' }).click()
  await expect(page).toHaveURL('/posts')
  await expect(page.getByRole('heading', { name: 'Актуално' })).toBeVisible()
  await page.goto('/news')
  await expect(page).toHaveURL('/posts')
  await page.goto('/')
  await expect(nav).not.toContainText('Запиши се')
  await expect(nav).not.toContainText('Извън страната')
  const footer = page.locator('footer')
  await expect(footer).not.toContainText('team@tibroish.bg')
  // From 20:00 on election day until 12:00 the next day the footer offers „Изпрати протокол“ (SiteChrome, isProtocolOpen).
  if (isProtocolOpen()) await expect(footer).toContainText('Изпрати протокол')
  else await expect(footer).not.toContainText('Изпрати протокол')
  // The home page shows the same big button next to „Подай сигнал“ while the window is open.
  const homeProtocol = page.locator('main a.brand-button[href="/protokol"]')
  await expect(homeProtocol).toHaveCount(isProtocolOpen() ? 1 : 0)
  for (const [name, href] of [
    ['Facebook', 'https://www.facebook.com/tibroish/'],
    ['Instagram', 'https://www.instagram.com/tibroish.bg/'],
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
  if (!isProtocolOpen()) {
    await page.goto('/protokol')
    await expect(page.getByRole('heading', { name: /Протоколът се праща от|Изпращането на протоколи приключи/ })).toBeVisible()
  }
  await page.goto('/neshto-si')
  await expect(page.getByRole('heading', { name: 'Няма такава страница' })).toBeVisible()
  await expect(page.getByText('Not Found')).toHaveCount(0)
  await page.getByRole('link', { name: 'Към началото' }).click()
  await expect(page.getByRole('heading', { name: 'Президентски избори 25.10.2026' })).toBeVisible()
})
