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

test('a settled person is sent to the profile instead of a new signup', async ({ page }) => {
  await seedProfile(page, registered())
  await page.goto('/')
  const main = page.locator('main')
  await expect(main.getByRole('link', { name: 'Запиши се' })).toHaveCount(0)
  await expect(main.getByText('Вече си записан')).toBeVisible()
  await expect(main.getByRole('link', { name: 'Към профила' })).toBeVisible()
  await expect(page.locator('footer').getByRole('link', { name: 'Профилът ти' })).toBeVisible()
  await expect(page.locator('footer').getByRole('link', { name: 'Запиши се' })).toHaveCount(0)
  await expect(page.locator('.site-nav')).not.toContainText('Запиши се')
})

test('editing a settled signup does not offer a second registration', async ({ page }) => {
  await seedProfile(page, registered())
  await page.goto('/signup?step=contact')
  await expect(page.getByText('Вече си записан. Тук променяш записването.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Променяш как да се свържем с теб' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Запиши ме' })).toHaveCount(0)

  await page.goto('/signup?step=place')
  await expect(page.getByText('Вече си записан. Тук променяш записването.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Променяш мястото' })).toBeVisible()

  await page.goto('/signup?step=travel')
  await expect(page.getByRole('heading', { name: 'Променяш докъде можеш да стигнеш' })).toBeVisible()

  await page.goto('/signup?step=review')
  await expect(page.getByRole('heading', { name: 'Преглед на данните' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Запази' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Преглед, преди да се запишеш' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Запиши ме' })).toHaveCount(0)
})

test('changing the email keeps the rest of the signup', async ({ page }) => {
  await seedProfile(page, registered())
  await page.goto('/signup?step=contact')
  await page.getByLabel('Имейл').fill('nova@example.com')
  await expect(page.getByLabel('Име', { exact: true })).toHaveValue('Иван')
  await expect(page.getByLabel('Фамилия')).toHaveValue('Иванов')
  await expect(page.getByText('Вече си записан. Тук променяш записването.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Запиши ме' })).toHaveCount(0)
})

test('an empty profile can still start signup', async ({ page }) => {
  await seedProfile(page, {})
  await page.goto('/')
  await expect(page.locator('main').getByRole('link', { name: 'Запиши се' })).toBeVisible()
})
