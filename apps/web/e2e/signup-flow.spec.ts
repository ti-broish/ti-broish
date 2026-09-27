import { expect, test } from '@playwright/test'
import type { HomePlace, Profile } from '../src/signup/model'
import { seedProfile } from './helpers'

const sofia: HomePlace = {
  regionCode: 'sofia-merged',
  regionName: 'София-град',
  municipalityCode: '46',
  municipalityName: 'Столична',
  townId: 68134,
  townName: 'гр. София',
  cityRegionCode: '15',
  cityRegionName: 'Младост',
  sectionPlace: 'ул. Пример 1',
  paperCount: 2,
  machineCount: 1,
}

function registered(patch: Partial<Profile> = {}): Partial<Profile> {
  return {
    firstName: 'Иван',
    middleName: 'Иванов',
    lastName: 'Иванов',
    email: 'ivan@example.com',
    phone: '0888123456',
    emailConfirmed: true,
    egn: '0041010002',
    role: 'section',
    rounds: { first: true, runoff: true },
    experience: 'counted',
    place: { ...sofia },
    radius: 'cityRegion',
    consent: true,
    submitted: true,
    ...patch,
  }
}

test('latin names are rejected on the first screen', async ({ page }) => {
  await page.goto('/signup?step=contact')
  await page.getByLabel('Име', { exact: true }).fill('Ivan')
  await page.getByLabel('Презиме').fill('Ivanov')
  await page.getByLabel('Фамилия').fill('Ivanov')
  await page.getByLabel('Имейл').fill('ivan@example.com')
  await page.getByLabel('Телефон').fill('0888123456')
  await page.getByRole('button', { name: 'Изпрати код за потвърждение' }).click()
  await expect(page.getByText('Трите имена са на кирилица.')).toBeVisible()
})

test('a city district does not ask for car seats, and travel outside the city does', async ({ page }) => {
  await seedProfile(page, registered())
  await page.goto('/signup?step=travel')
  await expect(page.getByText(/Запазено място:.*Младост/)).toBeVisible()
  await page.getByRole('button', { name: 'Напред' }).click()
  await expect(page.getByRole('heading', { name: 'Хора с теб' })).toBeVisible()

  await seedProfile(page, registered({ radius: 'municipality' }))
  await page.goto('/signup?step=travel')
  await page.getByRole('button', { name: 'Напред' }).click()
  await expect(page.getByRole('heading', { name: 'Свободни места в колата' })).toBeVisible()
})

test('car seats sit with the car question, and the drone asks who can operate one', async ({ page }) => {
  await seedProfile(page, registered({ role: 'mobile', hasCar: null, hasDrone: null }))
  await page.goto('/signup?step=seats')
  await expect(page.getByText('Колко души можеш да вземеш')).toHaveCount(0)
  await page.getByRole('group', { name: 'Имаш ли кола?' }).getByRole('radio', { name: 'Да' }).check()
  const form = page.locator('form')
  const text = await form.innerText()
  expect(text.indexOf('Колко души можеш да вземеш')).toBeLessThan(text.indexOf('оперираш'))
  await page.getByRole('group', { name: 'Имаш ли кола?' }).getByRole('radio', { name: 'Не' }).check()
  await expect(page.getByText('Колко души можеш да вземеш')).toHaveCount(0)
  await expect(page.getByText('Имаш дрон или можеш да го оперираш?')).toBeVisible()
})

test('people in the group and people added as a coordinator both show on the review', async ({ page }) => {
  await seedProfile(page, registered())
  await page.goto('/signup?step=people')
  await page.getByPlaceholder('Име', { exact: true }).fill('Мария')
  await page.getByPlaceholder('Фамилия').fill('Петрова')
  await page.getByPlaceholder('Имейл', { exact: true }).fill('maria@example.com')
  await page.getByPlaceholder('Телефон').fill('0888000001')
  await page.getByRole('button', { name: 'Добави пазител' }).click()
  await expect(page.getByText('В групата · maria@example.com')).toBeVisible()

  await page.getByRole('button', { name: 'Добавям хора извън групата, като координатор' }).click()
  await page.getByPlaceholder('Име', { exact: true }).fill('Петър')
  await page.getByPlaceholder('Фамилия').fill('Георгиев')
  await page.getByPlaceholder('Имейл', { exact: true }).fill('peter@example.com')
  await page.getByPlaceholder('Телефон').fill('0888000002')
  await page.getByRole('button', { name: 'Добави пазител' }).click()
  await expect(page.getByText('Извън групата · peter@example.com')).toBeVisible()

  await page.getByRole('button', { name: 'Напред' }).click()
  await expect(page.getByRole('heading', { name: 'Преглед, преди да се запишеш' })).toBeVisible()
  await expect(page.getByText('Група: Мария Петрова')).toBeVisible()
  await expect(page.getByText(/Като координатор:.*Петър Георгиев/)).toBeVisible()
})

test('withdrawing a signup can be undone from the profile', async ({ page }) => {
  await seedProfile(page, registered())
  await page.goto('/profil')
  await page.getByRole('button', { name: 'Оттегли записването' }).click()
  await expect(page.getByRole('heading', { name: 'Записването е оттеглено' })).toBeVisible()
  await page.getByRole('button', { name: 'Върни записването' }).click()
  await expect(page.getByRole('heading', { name: '5 октомври' })).toBeVisible()
  for (const name of ['Сподели във Facebook', 'Сподели във Viber', 'Сподели в Instagram', 'Сподели в Threads', 'Сподели в X (Twitter)', 'Сподели в WhatsApp', 'Сподели в LinkedIn']) {
    await expect(page.getByRole('link', { name })).toBeVisible()
  }
})

test('instructions link the handbook and the signal form', async ({ page }) => {
  await page.goto('/instructions')
  await expect(page.getByRole('heading', { name: 'Преди да влезеш в секцията' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Наръчник на пазителя на вота' })).toBeVisible()
  await page.getByRole('link', { name: 'сигнала' }).click()
  await expect(page.getByRole('heading', { name: 'Подай сигнал' })).toBeVisible()
})

test('a signal without a place is refused', async ({ page }) => {
  await page.goto('/signal')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Име', { exact: true }).fill('Иван Иванов')
  await page.getByLabel('Имейл').fill('ivan@example.com')
  await page.getByLabel('Телефон').fill('0888123456')
  await page.getByLabel('Описание на нарушението').fill('Председателят не записа забележката в протокола.')
  await page.getByRole('button', { name: 'Изпрати' }).click()
  await expect(page.getByText('Нужни са населено място, име, имейл, телефон и описание от поне 20 знака.')).toBeVisible()
})
