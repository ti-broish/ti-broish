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
  await expect(page.getByRole('radio', { name: 'В община Столична' })).toBeChecked()
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
  await expect(page.getByRole('heading', { name: 'Преглед на данните' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Запази' })).toBeVisible()
  await expect(page.getByText('Група: Мария Петрова')).toBeVisible()
  await expect(page.getByText(/Като координатор:.*Петър Георгиев/)).toBeVisible()
})

test('a finished signup reviews changes instead of signing up again', async ({ page }) => {
  await seedProfile(page, registered())
  await page.goto('/signup?step=review')
  await expect(page.getByRole('heading', { name: 'Преглед на данните' })).toBeVisible()
  await expect(page.getByText('Провери промените и ги запази.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Запази' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Запиши ме' })).toHaveCount(0)

  await page.goto('/signup?step=contact')
  await expect(page.getByText('Тук променяш как да се свържем с теб.')).toBeVisible()
  await expect(page.getByText('Записването е за президентските избори')).toHaveCount(0)

  await page.goto('/signup?step=rounds')
  await expect(page.getByText('Дните са 25 октомври и 1 ноември.')).toBeVisible()
})

test('the first review still asks the person to sign up', async ({ page }) => {
  await seedProfile(page, registered({ submitted: false, consent: false }))
  await page.goto('/signup?step=review')
  await expect(page.getByRole('heading', { name: 'Преглед, преди да се запишеш' })).toBeVisible()
  await page.getByRole('checkbox', { name: /доброволна дейност/ }).check()
  await expect(page.getByRole('heading', { name: 'Преглед, преди да се запишеш' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Запиши ме' })).toBeVisible()
})

test('a registered profile leads with the date, then the answers, without the national number', async ({ page }) => {
  await seedProfile(page, registered())
  await page.goto('/profil')
  await expect(page.getByRole('heading', { name: '5 октомври' })).toBeVisible()
  const text = await page.locator('main').innerText()
  expect(text.indexOf('5 октомври')).toBeLessThan(text.indexOf('Твоите данни'))
  expect(text.indexOf('Твоите данни')).toBeLessThan(text.indexOf('Материали'))
  expect(text.indexOf('Материали')).toBeLessThan(text.indexOf('Покани'))
  expect(text.indexOf('Покани')).toBeLessThan(text.indexOf('Оттегли записването'))

  const facts = page.getByRole('region', { name: 'Твоите данни' })
  await expect(facts.getByRole('definition').filter({ hasText: 'Иван Иванов Иванов' })).toBeVisible()
  await expect(facts.getByRole('definition').filter({ hasText: 'ivan@example.com' })).toBeVisible()
  await expect(facts.getByRole('definition').filter({ hasText: '0888123456' })).toBeVisible()
  await expect(facts.getByRole('definition').filter({ hasText: 'Секция' })).toBeVisible()
  await expect(facts.getByRole('definition').filter({ hasText: '25 октомври и 1 ноември' })).toBeVisible()
  await expect(facts.getByRole('definition').filter({ hasText: 'София-град, Столична, гр. София, Младост, ул. Пример 1' })).toBeVisible()
  await expect(facts.getByRole('definition').filter({ hasText: 'Само в Младост' })).toBeVisible()
  await expect(facts.getByRole('definition').filter({ hasText: 'Броил си 1–2 пъти' })).toBeVisible()
  await expect(facts.getByText('Без група', { exact: true })).toBeVisible()
  await expect(facts.getByRole('definition').filter({ hasText: 'Въведено' })).toBeVisible()
  await expect(facts).not.toContainText('0041010002')
})

test('the profile summary stacks on a phone and pairs labels on a wide screen', async ({ page }) => {
  await seedProfile(page, registered())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/profil')
  await expect(page.getByRole('heading', { name: 'Твоите данни' })).toBeVisible()
  const row = page.locator('dl > div').first()
  const term = row.locator('dt')
  const value = row.locator('dd')
  await expect(term).toHaveText('Име')
  await expect(value).toHaveText('Иван Иванов Иванов')
  const phoneTerm = await term.boundingBox()
  const phoneValue = await value.boundingBox()
  expect(phoneValue!.y).toBeGreaterThan(phoneTerm!.y + phoneTerm!.height - 4)

  await page.setViewportSize({ width: 1280, height: 800 })
  const wideTerm = await term.boundingBox()
  const wideValue = await value.boundingBox()
  expect(wideValue!.x).toBeGreaterThan(wideTerm!.x + wideTerm!.width - 4)
  expect(Math.abs(wideValue!.y - wideTerm!.y)).toBeLessThan(12)
})

test('an unfinished profile points at the missing step', async ({ page }) => {
  await seedProfile(page, registered({ egn: '', submitted: false, consent: false }))
  await page.goto('/profil')
  await expect(page.getByRole('heading', { name: 'Записването не е готово' })).toBeVisible()
  await expect(page.getByText('Остава ЕГН, за да те разпределим.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Продължи записването' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Твоите данни' }).getByRole('definition').filter({ hasText: 'Липсва' })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('0041010002')
})

test('an assigned profile leads with the section and the badge', async ({ page }) => {
  await seedProfile(page, registered({ assignedSection: '234600101' }))
  await page.goto('/profil')
  await expect(page.getByRole('heading', { name: '234600101' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Отпечатай значката' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '5 октомври' })).toHaveCount(0)
})

test('withdrawing a signup can be undone from the profile', async ({ page }) => {
  await seedProfile(page, registered())
  await page.goto('/profil')
  await page.getByRole('button', { name: 'Оттегли записването' }).click()
  await expect(page.getByRole('heading', { name: 'Записването е оттеглено' })).toBeVisible()
  await page.getByRole('button', { name: 'Върни записването' }).click()
  await expect(page.getByRole('heading', { name: '5 октомври' })).toBeVisible()
  for (const name of ['Сподели във Facebook', 'Сподели във Viber', 'Сподели в Instagram', 'Сподели в Threads', 'Сподели в X (Twitter)', 'Сподели в WhatsApp', 'Сподели в LinkedIn']) {
    const link = page.getByRole('link', { name })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('target', '_blank')
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
