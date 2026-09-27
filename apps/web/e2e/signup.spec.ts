import { expect, test } from '@playwright/test'

test('the home page names the election and the group', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Президентски избори 2026 г.')).toBeVisible()
  await expect(page.getByText('заедно като група')).toBeVisible()
})

test('a partner link is shown and stored as a source', async ({ page }) => {
  await page.goto('/signup?source=iaz.bg&step=contact')
  await expect(page.getByText('Гюров, Кандев и аз')).toBeVisible()
  await expect(page.getByText('президентските избори 2026 г.')).toBeVisible()
  await page.getByLabel('Име', { exact: true }).fill('Иван')
  await page.getByLabel('Презиме').fill('Иванов')
  await page.getByLabel('Фамилия').fill('Иванов')
  await page.getByLabel('Имейл').fill('ivan@example.com')
  await page.getByLabel('Телефон').fill('0888123456')
  await page.getByRole('button', { name: 'Изпрати код за потвърждение' }).click()
  await page.getByRole('button', { name: 'Отвори линка от писмото' }).click()
  await page.getByLabel('ЕГН').fill('0041010003')
  await page.getByRole('button', { name: 'Напред' }).click()
  await expect(page.getByText('ЕГН е 10 цифри')).toBeVisible()
  const stored = await page.evaluate(() => window.localStorage.getItem('ti-broish-signup-prototype-v1'))
  expect(stored).toContain('iaz.bg')
})
