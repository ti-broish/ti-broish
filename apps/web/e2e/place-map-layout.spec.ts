import { expect, test, type Locator, type Page } from '@playwright/test'
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

async function boxOf(locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  expect(box).toBeTruthy()
  return box!
}

function expectStacked(above: { y: number; height: number }, below: { y: number }) {
  expect(below.y).toBeGreaterThanOrEqual(above.y + above.height - 1)
}

function expectBeside(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const yOverlap = a.y < b.y + b.height && b.y < a.y + a.height
  const xOverlap = a.x < b.x + b.width && b.x < a.x + a.width
  expect(yOverlap).toBe(true)
  expect(xOverlap).toBe(false)
}

async function expectMapLayout(page: Page, path: string, control: Locator) {
  const map = page.locator('form .overflow-hidden').first()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(path)
  expectStacked(await boxOf(map), await boxOf(control))

  await page.setViewportSize({ width: 1280, height: 800 })
  const main = await boxOf(page.locator('main'))
  expect(main.width).toBeGreaterThan(700)
  const desktopMap = await boxOf(map)
  const desktopControl = await boxOf(control)
  expectBeside(desktopMap, desktopControl)
  expect(desktopMap.width).toBeGreaterThan(480)
}

test('the place map stacks on a phone and sits beside the locality on a desktop', async ({ page }) => {
  test.setTimeout(90_000)
  await seedProfile(page, registered())
  await expectMapLayout(page, '/signup?step=place', page.getByRole('combobox', { name: 'Населено място' }))
})

test('the travel map stacks on a phone and sits beside the range on a desktop', async ({ page }) => {
  test.setTimeout(90_000)
  await seedProfile(page, registered())
  await expectMapLayout(page, '/signup?step=travel', page.getByRole('group', { name: 'Докъде можеш да стигнеш' }))
})
