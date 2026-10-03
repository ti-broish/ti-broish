import { execFileSync } from 'node:child_process'
import { expect, test, type Locator, type Page } from '@playwright/test'

const STAFF_EMAIL = 'maria.admin-e2e@example.com'
const SESSION = 'e2e-admin-session'

test('the roster stays out of the menu and asks for a confirmed team email', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.site-nav')).not.toContainText('Записани')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Админ' })).toBeVisible()
  await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Влез в списъка' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Достъп' })).toHaveCount(0)
  await page.goto('/admin/sections')
  await expect(page.getByRole('button', { name: 'Публикувай черновите в този изглед (без имейл)' })).toHaveCount(0)
})

test.describe('staff admin', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Админ' })).toBeVisible()
    await page.close()
    seedStaffRoster()
  })

  test('desktop sidebar shows the roster and keeps high-contrast labels', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin')
    const nav = page.getByRole('navigation', { name: 'Админ' })
    await expect(nav.getByRole('link', { name: 'Записвания' })).toBeVisible()
    await expect(page.locator('aside span').filter({ hasText: /^Админ$/ })).toBeVisible()
    await expect(page.locator('aside').getByText(STAFF_EMAIL, { exact: true })).toBeVisible()
    await expect(page.getByText('Записани', { exact: true })).toBeVisible()
    const active = nav.getByRole('link', { name: 'Начало' })
    const idle = nav.getByRole('link', { name: 'Записвания' })
    expect(await contrastOf(active)).toBeGreaterThanOrEqual(4.5)
    expect(await contrastOf(idle)).toBeGreaterThanOrEqual(4.5)
    await nav.getByRole('link', { name: 'Записвания', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Записвания' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Мария Георгиева Петрова', exact: true })).toBeVisible()
  })

  test('mobile drawer opens the same admin links', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin/signups')
    await expect(page.getByRole('navigation', { name: 'Админ' })).toBeHidden()
    await page.getByRole('button', { name: 'Админ меню' }).click()
    const drawer = page.getByRole('navigation', { name: 'Админ меню' })
    await expect(drawer.getByRole('link', { name: 'Секции' })).toBeVisible()
    expect(await contrastOf(drawer.getByRole('link', { name: 'Записвания' }))).toBeGreaterThanOrEqual(4.5)
    await drawer.getByRole('link', { name: 'Начало' }).click()
    await expect(page.getByRole('heading', { name: 'Начало' })).toBeVisible()
  })

  test('search by email, phone, and name updates the URL and can be empty', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/signups')
    const search = page.getByLabel('Търсене')
    await search.fill(STAFF_EMAIL)
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(STAFF_EMAIL).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), { timeout: 5000 })
    await expect(page.getByRole('cell', { name: 'Мария Георгиева Петрова', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Иван Иванов Иванов', exact: true })).toHaveCount(0)

    await search.fill('0888333444')
    await expect(page).toHaveURL(/q=0888333444/, { timeout: 5000 })
    await expect(page.getByRole('cell', { name: 'Иван Иванов Иванов', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Мария Георгиева Петрова', exact: true })).toHaveCount(0)

    await search.fill('Мария')
    await expect(page).toHaveURL(/q=/, { timeout: 5000 })
    await expect(page.getByRole('cell', { name: 'Мария Георгиева Петрова', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Без секция' }).click()
    await expect(page).toHaveURL(/view=unassigned/)
    await page.goBack()
    await expect(page).not.toHaveURL(/view=unassigned/)

    await search.fill('няматакъвчовек')
    await expect(page.getByText('Няма хора за това търсене.')).toBeVisible({ timeout: 5000 })
  })

  test('a finished signup opens for a callback, and a started one stays in its own list', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin')
    await expect(page.getByText('Завършили', { exact: true })).toBeVisible()
    await expect(page.getByText('Започнали', { exact: true })).toBeVisible()
    await page.goto('/admin/signups')
    await page.getByRole('row', { name: STAFF_EMAIL }).getByRole('link', { name: 'Мария Георгиева Петрова', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Мария Георгиева Петрова', exact: true })).toBeVisible()
    await expect(page.getByText('Завършил записването.')).toBeVisible()
    await expect(page.getByText('ЕГН е въведено')).toBeVisible()
    await page.getByLabel('Бележка от екипа').fill('Обадихме се, ще дойде и на двата дни.')
    await page.getByLabel('Отбележи, че сме се обадили').check()
    await page.getByLabel('Телефон').fill('0888999000')
    await page.getByRole('button', { name: 'Запази' }).click()
    await expect(page.getByText('Записахме промените.')).toBeVisible()
    await expect(page.getByText('Обадени сме', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Телефон')).toHaveValue('0888999000')
    await page.getByRole('link', { name: 'Към записванията' }).click()
    await page.getByRole('button', { name: 'Започнали' }).click()
    await expect(page).toHaveURL(/view=started/)
    await expect(page.getByRole('cell', { name: 'ivan.admin-e2e@example.com' })).toBeVisible()
    await expect(page.getByRole('cell', { name: STAFF_EMAIL })).toHaveCount(0)
    await page.getByRole('button', { name: 'Завършили' }).click()
    await expect(page).toHaveURL(/view=finished/)
    await expect(page.getByRole('cell', { name: STAFF_EMAIL })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'ivan.admin-e2e@example.com' })).toHaveCount(0)
  })

  test('the call queue shows the team note and a bulk mark leaves the open list', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/calls')
    await expect(page.getByRole('heading', { name: 'Обаждания' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Петър Петров Петров' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Ще се обадим утре.' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Мария Георгиева Петрова', exact: true })).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Избери Петър Петров Петров' }).check()
    await page.getByRole('button', { name: 'Отбележи обаждане' }).click()
    await expect(page.getByText('Отбелязахме обаждане за 1 човек.')).toBeVisible()
    await expect(page.getByText('Няма хора за обаждане в този изглед.')).toBeVisible()
    await page.getByRole('button', { name: 'Всички поискали' }).click()
    await expect(page).toHaveURL(/show=all/)
    await expect(page.getByRole('link', { name: 'Петър Петров Петров' })).toBeVisible()
    await expect(page.getByText('Обадени сме', { exact: true })).toBeVisible()
  })

  test('a started signup opens from the phone list', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin/signups')
    await page.getByRole('listitem').filter({ hasText: 'ivan.admin-e2e@example.com' }).getByRole('link', { name: 'Иван Иванов Иванов', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Иван Иванов Иванов', exact: true })).toBeVisible()
    await expect(page.getByText(/Започнал е, но не е завършил/)).toBeVisible()
    await expect(page.getByText('Няма ЕГН', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Бележка от екипа')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Запази' })).toBeVisible()
  })
})

async function signIn(page: Page) {
  await page.context().addCookies([
    { name: 'tb_session', value: SESSION, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' },
  ])
}

function seedStaffRoster() {
  const sql = `
INSERT INTO signups (
  id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, role,
  mir_code, region_code, town_name, section_place, draft_section, published_section, notes,
  staff_note, staff_called_at, staff_called_by, rounds_first, rounds_runoff, created_at, updated_at
) VALUES
(
  'e2e-maria',
  '${STAFF_EMAIL}',
  '${SESSION}',
  'e2emaria',
  '{"firstName":"Мария","middleName":"Георгиева","lastName":"Петрова","phone":"0888111222","email":"${STAFF_EMAIL}"}',
  1, 0, 1, '0041010002', 'section',
  '23', '23', 'гр. София', 'ул. Витоша 1', '', '234600101', '',
  '', '', '', 1, 1, datetime('now'), datetime('now')
),
(
  'e2e-ivan',
  'ivan.admin-e2e@example.com',
  'e2e-ivan-session',
  'e2eivan1',
  '{"firstName":"Иван","middleName":"Иванов","lastName":"Иванов","phone":"0888333444","email":"ivan.admin-e2e@example.com"}',
  1, 0, 0, '', 'mobile',
  '24', '24', 'гр. София', 'ул. Пример 2', '244600199', '', '',
  '', '', '', 0, 0, datetime('now'), datetime('now')
),
(
  'e2e-call',
  'call.admin-e2e@example.com',
  'e2e-call-session',
  'e2ecall1',
  '{"firstName":"Петър","middleName":"Петров","lastName":"Петров","phone":"0888555666","email":"call.admin-e2e@example.com","callRequestedAt":"2026-10-02T08:00:00.000Z","callMessage":"За секцията","rounds":{"first":true,"runoff":false}}',
  1, 0, 1, '', 'section',
  '23', '23', 'гр. София', 'ул. Обаждане 3', '', '', '',
  'Ще се обадим утре.', '', '', 1, 0, datetime('now'), datetime('now')
)
ON CONFLICT(email) DO UPDATE SET
  session_token = excluded.session_token,
  payload = excluded.payload,
  email_confirmed = 1,
  submitted = excluded.submitted,
  egn = excluded.egn,
  role = excluded.role,
  mir_code = excluded.mir_code,
  town_name = excluded.town_name,
  section_place = excluded.section_place,
  draft_section = excluded.draft_section,
  published_section = excluded.published_section,
  staff_note = excluded.staff_note,
  staff_called_at = excluded.staff_called_at,
  staff_called_by = excluded.staff_called_by,
  rounds_first = excluded.rounds_first,
  rounds_runoff = excluded.rounds_runoff;
INSERT INTO staff (email, role, invited_by, created_at)
VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';
`
  execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', '--command', sql], {
    cwd: new URL('.', import.meta.url).pathname.replace(/e2e\/$/, ''),
    stdio: 'pipe',
  })
}

async function contrastOf(locator: Locator) {
  return locator.evaluate((element) => {
    function channel(color: string) {
      const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
      if (!match) return null
      return [Number(match[1]), Number(match[2]), Number(match[3])] as const
    }
    function paint(start: Element | null) {
      let node = start as HTMLElement | null
      while (node) {
        const color = getComputedStyle(node).backgroundColor
        const rgb = channel(color)
        if (rgb && !color.endsWith(', 0)')) return rgb
        node = node.parentElement
      }
      return [255, 255, 255] as const
    }
    function lum([r, g, b]: readonly number[]) {
      const part = (value: number) => {
        const scaled = value / 255
        return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * part(r) + 0.7152 * part(g) + 0.0722 * part(b)
    }
    const fg = channel(getComputedStyle(element).color) ?? [0, 0, 0]
    const bg = paint(element)
    const lighter = Math.max(lum(fg), lum(bg))
    const darker = Math.min(lum(fg), lum(bg))
    return (lighter + 0.05) / (darker + 0.05)
  })
}
