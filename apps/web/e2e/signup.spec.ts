import { expect, test } from '@playwright/test'
import { SIGNUP_STORAGE_KEY, seedProfile } from './helpers'
import type { HomePlace, Profile } from '../src/signup/model'

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
  await page.getByRole('button', { name: 'Продължи с този код' }).click()
  await page.getByLabel('ЕГН').fill('0041010003')
  await page.getByRole('button', { name: 'Напред' }).click()
  await expect(page.getByText('ЕГН е 10 цифри')).toBeVisible()
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SIGNUP_STORAGE_KEY)
  expect(stored).toContain('iaz.bg')
})

const sofia: HomePlace = {
  regionCode: 'sofia-merged',
  regionName: 'София-град',
  municipalityCode: '46',
  municipalityName: 'Столична',
  townId: 68134,
  townName: 'гр. София',
  cityRegionCode: '15',
  cityRegionName: 'Младост',
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

test('a partner ref is shown and stored as a source', async ({ page }) => {
  await page.goto('/signup?ref=iaz.bg')
  await expect(page.getByText('Гюров, Кандев и аз')).toBeVisible()
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SIGNUP_STORAGE_KEY)
  const profile = JSON.parse(stored ?? '{}') as { source?: string | null; referredBy?: string | null }
  expect(profile.source).toBe('iaz.bg')
  expect(profile.referredBy).not.toBe('iaz.bg')
})

test('a valid personal number reaches how you guard the vote', async ({ page }) => {
  await page.goto('/signup?source=iaz.bg&step=contact')
  await expect(page.getByText('Гюров, Кандев и аз')).toBeVisible()
  await expect(page.getByText('президентските избори 2026 г.')).toBeVisible()
  await page.getByLabel('Име', { exact: true }).fill('Иван')
  await page.getByLabel('Презиме').fill('Иванов')
  await page.getByLabel('Фамилия').fill('Иванов')
  await page.getByLabel('Имейл').fill('ivan@example.com')
  await page.getByLabel('Телефон').fill('0888123456')
  await page.getByRole('button', { name: 'Изпрати код за потвърждение' }).click()
  await page.getByRole('button', { name: 'Продължи с този код' }).click()
  await page.getByLabel('ЕГН').fill('0041010002')
  await page.getByRole('button', { name: 'Напред' }).click()
  await expect(page.getByRole('heading', { name: 'Как ще пазиш вота' })).toBeVisible()
})

test('place and travel steps ask different questions', async ({ page }) => {
  await seedProfile(page, registered())
  await page.goto('/signup?step=place')
  await expect(page.getByText('Адрес, ако имаш предпочитание')).toBeVisible()
  await expect(page.locator('legend', { hasText: 'Докъде можеш да стигнеш' })).toHaveCount(0)
  await page.goto('/signup?step=travel')
  await expect(page.locator('legend', { hasText: 'Докъде можеш да стигнеш' })).toBeVisible()
})

test('a machine-only address asks for a wider range', async ({ page }) => {
  await seedProfile(
    page,
    registered({
      place: { ...sofia, paperCount: 0, machineCount: 2 },
      radius: 'cityRegion',
    }),
  )
  await page.goto('/signup?step=travel')
  await expect(page.getByText('На избрания адрес няма хартиена секция')).toBeVisible()
  await page.getByRole('button', { name: 'Напред' }).click()
  await expect(page.getByText('На този адрес няма хартиена секция')).toBeVisible()
})

test('a submitted profile shows the next assignment', async ({ page }) => {
  await seedProfile(
    page,
    registered({
      emailConfirmed: true,
      submitted: true,
      rounds: { first: true, runoff: true },
    }),
  )
  await page.goto('/profil')
  await expect(page.getByRole('heading', { name: '5 октомври' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Оттегли записването' })).toBeVisible()
})

test('the people step can record guardians outside the group', async ({ page }) => {
  await page.goto('/signup?step=people')
  await expect(page.getByRole('button', { name: 'Добавям хора извън групата, като координатор' })).toBeVisible()
})

test('the badge names the committee and not the person', async ({ page }) => {
  await seedProfile(page, registered({ firstName: 'Иван', lastName: 'Златков', assignedSection: '234600101' }))
  await page.goto('/znachka')
  await expect(page.getByRole('heading', { name: 'ПРЕДСТАВИТЕЛ НА ИНИЦИАТИВЕН КОМИТЕТ' })).toBeVisible()
  await expect(page.getByText('Златков')).toHaveCount(0)
  await expect(page.getByText('234600101')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Свали образеца' })).toHaveAttribute('href', '/oznachenie-predstavitel.pdf')
})
