import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { MOBILE_DRAFTS_TABLE } from '../src/signup/mobile-teams-sql'
import { PRIORITY_SECTIONS_TABLE } from '../src/signup/priority-sections-sql'

const STAFF_EMAIL = 'maria.admin-e2e@example.com'
const SESSION = 'e2e-admin-session'

test('the roster stays out of the menu and asks for a confirmed team email', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.site-nav')).not.toContainText('Записани')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Админ' })).toBeVisible()
  await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Изпрати код' })).toBeVisible()
  await expect(page.getByLabel('Код от писмото')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Достъп' })).toHaveCount(0)
  await page.goto('/admin/sections')
  await expect(page.getByRole('button', { name: 'Публикувай черновите в този изглед (без имейл)' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Направи чернови за страната' })).toHaveCount(0)
})

test.describe('staff admin', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Админ' })).toBeVisible()
    // Wait for adminSession so signupDatabase creates local D1 tables before seeding.
    await expect(page.getByText('Влез с потвърдения си имейл.')).toBeVisible({ timeout: 30_000 })
    await page.close()
    seedStaffRoster()
  })

  test('a team email stays signed out until the mail code matches', async ({ page }) => {
    await page.goto('/admin')
    await page.getByLabel('Имейл').fill('ivan.admin-e2e@example.com')
    await page.getByRole('button', { name: 'Изпрати код' }).click()
    await expect(page.getByText('Този имейл не е поканен в екипа.')).toBeVisible()
    await expect(page.getByLabel('Код от писмото')).toHaveCount(0)
    expect(await sessionValue(page)).toBeUndefined()

    await page.getByLabel('Имейл').fill(STAFF_EMAIL)
    await page.getByRole('button', { name: 'Изпрати код' }).click()
    await expect(page.getByRole('heading', { name: 'Админ' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Начало' })).toHaveCount(0)
    expect(await sessionValue(page)).toBeUndefined()
    const preview = page.getByText(/Кодът е \d{6}\./)
    await expect(preview).toBeVisible()
    const code = ((await preview.textContent()) ?? '').match(/\d{6}/)?.[0] ?? ''
    expect(code).toMatch(/^\d{6}$/)
    const wrong = code === '000000' ? '111111' : '000000'
    await page.getByLabel('Код от писмото').fill(wrong)
    await page.getByRole('button', { name: 'Влез в списъка' }).click()
    await expect(page.getByText('Кодът не съвпада.')).toBeVisible()
    expect(await sessionValue(page)).toBeUndefined()

    await page.getByLabel('Код от писмото').fill(code)
    await page.getByRole('button', { name: 'Влез в списъка' }).click()
    await expect(page.getByRole('heading', { name: 'Начало' })).toBeVisible()
    expect(await sessionValue(page)).toBe(SESSION)
  })

  test('desktop sidebar shows the roster and keeps high-contrast labels', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin')
    const nav = page.getByRole('navigation', { name: 'Админ' })
    await expect(nav.getByRole('link', { name: 'Записвания' })).toBeVisible()
    const aside = page.locator('aside')
    const heading = page.getByRole('heading', { name: 'Начало' })
    const asideBox = await aside.boundingBox()
    const logoBox = await aside.locator('img[alt="Ти Броиш"]').boundingBox()
    const headingBefore = await heading.boundingBox()
    expect(asideBox?.width ?? 999).toBeLessThanOrEqual(90)
    expect(logoBox?.height ?? 0).toBeGreaterThanOrEqual(48)
    expect(logoBox?.width ?? 0).toBeGreaterThanOrEqual(48)
    await aside.hover()
    await expect(page.locator('aside span').filter({ hasText: /^Админ$/ })).toBeVisible()
    await expect(aside.getByText(STAFF_EMAIL, { exact: true })).toBeVisible()
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(180)
    const headingDuring = await heading.boundingBox()
    expect(Math.abs((headingDuring?.x ?? 0) - (headingBefore?.x ?? 0))).toBeLessThan(2)
    await page.mouse.move(1100, 420)
    await expect(aside.getByText(STAFF_EMAIL, { exact: true })).toBeHidden()
    await expect.poll(async () => (await aside.boundingBox())?.width ?? 999).toBeLessThanOrEqual(90)
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
    await page.getByRole('radio', { name: 'Мобилен екип' }).check()
    await page.getByRole('checkbox', { name: '1 ноември, балотаж' }).uncheck()
    await page.getByLabel('Бележка от екипа').fill('Обадихме се, ще дойде и на двата дни.')
    await page.getByLabel('Отбележи, че сме се обадили').check()
    await page.getByLabel('Телефон').fill('0888999000')
    await page.getByRole('radio', { name: 'В гр. София' }).check()
    await page.getByRole('button', { name: 'Запази' }).click()
    await expect(page.getByText('Записахме промените.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'История' })).toBeVisible()
    await expect(page.getByText('Роля: Секция → Мобилен екип').first()).toBeVisible()
    await expect(page.getByText('Дни: 25 октомври и 1 ноември → 25 октомври').first()).toBeVisible()
    await expect(page.getByText('Бележка от екипа: Празна бележка → Обадихме се, ще дойде и на двата дни.').first()).toBeVisible()
    await expect(page.getByText('Пътуване: Само в Младост → В гр. София').first()).toBeVisible()
    await expect(page.getByText('Обадили сме се', { exact: true })).toBeVisible()
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
    await expect(page.getByRole('cell', { name: 'call.admin-e2e@example.com' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Мария Георгиева Петрова', exact: true })).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Избери Петър Петров Петров' }).check()
    await page.getByRole('button', { name: 'Отбележи обаждане' }).click()
    await expect(page.getByText('Отбелязахме обаждане за 1 човек.')).toBeVisible()
    await expect(page.getByText('Няма хора за обаждане в този изглед.')).toBeVisible()
    await page.getByRole('button', { name: 'Всички поискали' }).click()
    await expect(page).toHaveURL(/show=all/)
    await expect(page.getByRole('link', { name: 'Петър Петров Петров' })).toBeVisible()
    await expect(page.getByText('Обадили сме се', { exact: true })).toBeVisible()
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

  test('admin unregisters a volunteer, frees the section, filters them, then restores', async ({ page }) => {
    seedStaffRoster()
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/signups')
    await page.getByRole('row', { name: 'withdraw.admin-e2e@example.com' }).getByRole('link', { name: 'Анна Ангелова Ангелова', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Анна Ангелова Ангелова', exact: true })).toBeVisible()
    await expect(page.getByText('Публикувана 234600177', { exact: true })).toBeVisible()
    await page.locator('#withdraw-reason').selectOption({ label: 'Отказа се (обаждане)' })
    await page.locator('#withdraw-note').fill('Обади се след разпределението.')
    await page.getByRole('button', { name: 'Отпиши', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Отписан' })).toBeVisible()
    await expect(page.getByText(/Предишна секция: 234600177/)).toBeVisible()
    await expect(page.getByText('Няма секция', { exact: true })).toBeVisible()
    await expect(page.getByText(/Отписване:/).first()).toBeVisible()
    await page.getByRole('link', { name: 'Към записванията' }).click()
    await page.getByRole('button', { name: 'Отписани' }).click()
    await expect(page).toHaveURL(/view=withdrawn/)
    const withdrawnRow = page.getByRole('row', { name: 'withdraw.admin-e2e@example.com' })
    await expect(withdrawnRow.getByRole('cell', { name: 'withdraw.admin-e2e@example.com' })).toBeVisible()
    await expect(withdrawnRow.getByText('Отписан', { exact: true })).toBeVisible()
    await expect(page.getByTestId('withdrawn-counts')).toHaveText(/^Отписани: \d+ · обработени \d+ · необработени [1-9]\d*$/)
    await withdrawnRow.getByRole('button', { name: 'Обработен', exact: true }).click()
    await expect(withdrawnRow.getByText('Обработен', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Необработени', exact: true }).click()
    await expect(page).toHaveURL(/processed=no/)
    await expect(page.getByRole('row', { name: 'withdraw.admin-e2e@example.com' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Обработени', exact: true }).click()
    await expect(page).toHaveURL(/processed=yes/)
    const processedRow = page.getByRole('row', { name: 'withdraw.admin-e2e@example.com' })
    await processedRow.getByRole('link', { name: 'Анна Ангелова Ангелова', exact: true }).click()
    await expect(page.getByText('Обработен', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Махни „обработен“' }).click()
    await expect(page.getByText('Необработен', { exact: true })).toBeVisible()
    await expect(page.getByText(/Отписан: Обработен → Необработен/).first()).toBeVisible()
    await page.getByRole('button', { name: 'Върни' }).click()
    await expect(page.getByText('Завършил записването.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Отпиши' })).toBeVisible()
    await expect(page.getByText('Няма секция', { exact: true })).toBeVisible()
  })

  test('Чужбина shows coverage upload and draft-only distribute controls', async ({ page }) => {
    seedStaffRoster()
    seedAbroadVolunteer()
    await signIn(page)
    await page.goto('/admin/sections')
    await page.getByRole('button', { name: 'Чужбина', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Обхват чужбина (приоритетни секции)' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Разпределение чужбина' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Преглед (без запис)' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Запиши като чернови' })).toBeVisible()
    await expect(page.getByLabel('CSV с приоритетни секции в чужбина')).toBeVisible()

    const sample = readFileSync(new URL('../src/signup/fixtures/abroad-priority-sample.csv', import.meta.url), 'utf8')
    await page.getByLabel('CSV с приоритетни секции в чужбина').setInputFiles({
      name: 'abroad-priority-sample.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(sample),
    })
    await expect(page.getByText(/Записани са \d+ секции в чужбина/)).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Преглед (без запис)' }).click()
    await expect(page.getByText(/Предложение:/)).toBeVisible({ timeout: 20_000 })
  })

  test('Секции takes a priority CSV, badges priority sections, filters them and counts coverage', async ({ page }) => {
    seedStaffRoster()
    await signIn(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin/sections')
    const panel = page.getByTestId('priority-panel')
    await panel.locator('summary').click()
    await panel.getByLabel('CSV с приоритетни секции').setInputFiles({
      name: 'priority-sections.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('\uFEFFСИК;Населено място;Община;Област;R;level;T\n234600101;гр.София;Столична;СОФИЯ 23 ИР;4.5;elevated;1\n234699999;гр.София;Столична;СОФИЯ 23 ИР;3.1;watch;2\n'),
    })
    await expect(page.getByText(/Записани са 2 приоритетни секции/)).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByTestId('priority-coverage')).toContainText('покрити 1 от 2')
    await expect(panel.getByRole('cell', { name: '234699999' })).toBeVisible()
    await expect(panel.getByRole('cell', { name: 'Без човек' })).toBeVisible()
    await page.getByTestId('state-published').click()
    await page.getByRole('button', { name: '★ Само приоритетни' }).click()
    await expect(page).toHaveURL(/prio=true/)
    const table = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Човек' }) })
    const maria = table.getByRole('row', { name: /maria\.admin-e2e@example.com/ })
    await expect(maria.getByTestId('priority-badge').first()).toHaveText('★ повишен · R 4.50')
    await page.goto('/admin')
    await expect(page.getByTestId('priority-stat')).toContainText('1/2')
  })

  test('reserved sections: dry run, commit, conflict list, blocked draft and removal', async ({ page }) => {
    seedReservedVolunteer()
    await signIn(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    try {
      await page.goto('/admin/sections?q=' + encodeURIComponent('reserved.admin-e2e@example.com'))
      const panel = page.getByTestId('reserved-panel')
      await panel.locator('summary').click()
      await panel.getByLabel('Организация за резервациите').fill('E2E Резерв')
      await panel.getByLabel('CSV с резервирани секции').setInputFiles({
        name: 'reserved.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('СИК\n234600150\n234600151\n234600151\nabc\n'),
      })
      const preview = panel.getByTestId('reserved-preview')
      await expect(preview).toContainText('Валидни 2: нови 2', { timeout: 20_000 })
      await expect(preview).toContainText('Невалидни редове 1')
      await expect(preview).toContainText('Повторени 1')
      await expect(preview).toContainText('Наши хора на тези секции: 1')
      await expect(preview.getByRole('cell', { name: /reserved\.admin-e2e@example\.com/ })).toBeVisible()
      await panel.getByRole('button', { name: 'Запиши резервациите' }).click()
      await expect(page.getByText(/Записано: нови 2/)).toBeVisible({ timeout: 20_000 })
      await expect(panel.getByTestId('reserved-conflicts')).toContainText('234600150')

      const people = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Човек' }) })
      const row = people.getByRole('row', { name: /reserved\.admin-e2e@example\.com/ })
      await expect(row.getByTestId('reserved-badge').first()).toContainText('Резервирана от E2E Резерв')
      await row.getByLabel('Чернова за reserved.admin-e2e@example.com').fill('234600151')
      await row.getByRole('button', { name: 'Сложи чернова' }).click()
      await expect(page.getByText('Секция 234600151 е резервирана от E2E Резерв. Там не записваме наши хора.').first()).toBeVisible()
      await page.reload()
      await expect(page.getByLabel('Чернова за reserved.admin-e2e@example.com')).toHaveValue('234600150')

      await page.getByTestId('reserved-panel').locator('summary').click()
      const chip = page.getByTestId('reserved-panel').getByRole('listitem').filter({ hasText: 'E2E Резерв' })
      await chip.getByRole('button', { name: 'Махни всички' }).click()
      await chip.getByRole('button', { name: 'Да, махни всички 2' }).click()
      await expect(page.getByText('Махнахме 2 резервации на E2E Резерв.')).toBeVisible()
    } finally {
      runLocalD1("DELETE FROM taken_sections WHERE organisation = 'E2E Резерв'; DELETE FROM signups WHERE id = 'e2e-reserved';")
    }
  })

  test('mobile teams: „Предложи“ picks open priority sections in reach, saves a draft, and the button previews', async ({ page }) => {
    seedMobileTeam()
    await signIn(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    try {
      await page.goto('/admin/signups/e2e-mobile')
      const card = page.getByTestId('mobile-card')
      await expect(card).toContainText('Няма чернова за мобилен екип.')
      const suggestions = card.getByTestId('mobile-suggestions')
      // The first click can land before hydration on a cold dev server, so retry it.
      await expect(async () => {
        await card.getByRole('button', { name: 'Предложи' }).click()
        await expect(suggestions).toContainText('МИР 29 · с.Мобилно', { timeout: 5_000 })
      }).toPass({ timeout: 40_000 })
      await expect(suggestions).toContainText('299900001')
      await expect(suggestions).toContainText('299900002')
      await expect(suggestions).not.toContainText('299900003')
      await expect(suggestions).not.toContainText('299900004')
      await expect(suggestions).not.toContainText('299900005')
      await suggestions.getByRole('button', { name: 'Запиши като чернова' }).first().click()
      await expect(card.getByTestId('mobile-badge')).toContainText('Мобилен · МИР 29 · с.Мобилно · 2 секц.')

      await page.goto('/admin/sections')
      const panel = page.getByTestId('mobile-panel')
      await panel.locator('summary').click()
      await expect(panel.getByTestId('mobile-drafts')).toContainText('Мира Мобилна')
      await expect(panel.getByTestId('mobile-drafts')).toContainText('299900001')
      await panel.getByRole('button', { name: 'Преглед за мобилни екипи' }).click()
      await expect(panel.getByTestId('mobile-preview')).toContainText('Преглед (нищо не е записано)', { timeout: 20_000 })
    } finally {
      runLocalD1(
        "DELETE FROM mobile_drafts WHERE signup_id = 'e2e-mobile'; DELETE FROM priority_sections WHERE section_code LIKE '2999%'; DELETE FROM taken_sections WHERE organisation = 'E2E Мобилен резерв'; DELETE FROM signups WHERE id IN ('e2e-mobile', 'e2e-mobile-covered');",
      )
    }
  })

  test('Секции names the oblast, district and section in Bulgarian', async ({ page }) => {
    seedStaffRoster()
    await signIn(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin/sections')
    await expect(page.getByRole('columnheader', { name: 'Област' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Район' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Обхват' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Къде е секцията' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Къде е публикуваната' })).toBeVisible()
    const table = page.getByRole('table')
    await expect(table.getByText('София-град').first()).toBeVisible()
    await expect(table.getByText('ул. Обаждане 3')).toBeVisible()
    await expect(table.getByText('МИР 23').first()).toBeVisible()
    await expect(page.getByText(/радиус:/)).toHaveCount(0)
    await expect(page.getByText('cityRegion')).toHaveCount(0)
    await expect(page.getByText('settlement')).toHaveCount(0)
    await page.getByTestId('state-published').click()
    // Other specs publish people in parallel, so look inside Мария's row.
    const maria = table.getByRole('row', { name: /maria\.admin-e2e@example.com/ })
    await expect(maria.getByRole('cell', { name: 'Столична', exact: true })).toBeVisible()
    await expect(maria.getByText('Младост', { exact: true })).toBeVisible()
    await expect(maria.getByText('Само в Младост')).toBeVisible()
    await expect(maria.getByText('ул. Витоша 1')).toBeVisible()
    await expect(maria.getByText('234600101')).toBeVisible()
    await expect(maria.getByText('община Столична')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('cityRegion')).toHaveCount(0)
    await expect(page.getByText(/радиус:/)).toHaveCount(0)
  })

  test('a name in Секции opens that person', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/sections')
    await page.getByRole('link', { name: 'Петър Петров' }).click()
    await expect(page).toHaveURL(/\/admin\/signups\/e2e-call$/)
    await expect(page.getByRole('heading', { name: 'Петър Петров Петров' })).toBeVisible()
  })

  test('staff downloads the power of attorney PDF for a person with a published section', async ({ page }) => {
    await signIn(page)
    const response = await page.request.get('/admin/signups/e2e-maria/palnomoshtno.pdf')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/pdf')
    expect((await response.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  test('Brevo sections CSV export is available and downloads the attribute header', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/signups')
    await page.getByText('Инструменти').click()
    const button = page.getByRole('button', { name: 'CSV за Brevo: секции и адреси' })
    await expect(button).toBeVisible()
    await expect(page.getByText(/обновява съществуващи контакти в Brevo по EMAIL/i)).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await button.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^ti-broish-brevo-sekcii-\d{4}-\d{2}-\d{2}\.csv$/)
    const file = join(tmpdir(), `ti-broish-brevo-sekcii-e2e-${Date.now()}.csv`)
    await download.saveAs(file)
    const text = readFileSync(file, 'utf8')
    expect(text.replace(/^\uFEFF/, '').split('\n')[0]).toBe(
      'EMAIL,FIRSTNAME,LASTNAME,SMS,MIR,SECTION_ID,SECTION_CODE,SECTION_ID_TEXT,SECTION_ADDRESS,SECTION_PLACE,ROLE,SECTION_PUBLISHED',
    )
  })

  test('Секции offers the Brevo sections CSV for the current MIR and search', async ({ page }) => {
    seedStaffRoster()
    await signIn(page)
    await page.goto('/admin/sections?view=mir&mir=23&q=' + encodeURIComponent('Мария'))
    await expect(page.getByRole('heading', { name: 'Brevo: секции и адреси' })).toBeVisible()
    const exportPanel = page.getByRole('region', { name: 'Brevo: секции и адреси' })
    await expect(exportPanel.getByText('Обхват: всички публикувани секции, МИР 23, търсене „Мария“.')).toBeVisible()
    const syncPanel = page.getByRole('region', { name: 'Brevo: директна синхронизация' })
    await expect(syncPanel).toBeVisible()
    await expect(syncPanel.getByText('Не създава кампании и не праща имейли.', { exact: false })).toBeVisible()
    const button = page.getByRole('button', { name: 'CSV за Brevo: секции и адреси' })
    await expect(button).toBeVisible()
    const downloadPromise = page.waitForEvent('download')
    await button.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^ti-broish-brevo-sekcii-\d{4}-\d{2}-\d{2}\.csv$/)
    const file = join(tmpdir(), `ti-broish-brevo-sekcii-sections-e2e-${Date.now()}.csv`)
    await download.saveAs(file)
    const lines = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim().split('\n')
    expect(lines[0]).toBe('EMAIL,FIRSTNAME,LASTNAME,SMS,MIR,SECTION_ID,SECTION_CODE,SECTION_ID_TEXT,SECTION_ADDRESS,SECTION_PLACE,ROLE,SECTION_PUBLISHED')
    const emails = lines.slice(1).map((line) => line.split(',')[0])
    expect(emails).toContain(STAFF_EMAIL)
    expect(emails).not.toContain('ivan.admin-e2e@example.com')
    expect(emails).not.toContain('call.admin-e2e@example.com')
  })

  test('the Brevo list picker searches lists by typing and drives the dry run', async ({ page }) => {
    const syncRequests: string[] = []
    await mockBrevoServerFns(page, syncRequests)
    await signIn(page)
    await page.goto('/admin/sections?view=mir&mir=23')
    const syncPanel = page.getByRole('region', { name: 'Brevo: директна синхронизация' })
    const combobox = syncPanel.getByRole('combobox', { name: 'Списък в Brevo' })
    const listbox = syncPanel.getByRole('listbox', { name: 'Списъци в Brevo' })

    // Defaults to the configured list (95), not the newest one.
    await expect(combobox).toHaveValue('Представители със секция ПВР 2026 (120 контакта)')
    await expect(listbox).toBeHidden()

    await combobox.click()
    await expect(combobox).toHaveAttribute('aria-expanded', 'true')
    await expect(listbox.getByRole('option')).toHaveCount(5)
    await expect(listbox.getByRole('option', { selected: true })).toHaveText('Представители със секция ПВР 2026 (120 контакта)')

    // Case-insensitive Cyrillic filter; duplicate names carry „ · #id“.
    await combobox.fill('ДОБРО')
    await expect(listbox.getByRole('option')).toHaveText(['Доброволци · #101 (12 контакта)', 'доброволци · #12 (1 контакт)'])
    await combobox.press('ArrowDown')
    await combobox.press('Enter')
    await expect(listbox).toBeHidden()
    await expect(combobox).toHaveValue('доброволци · #12 (1 контакт)')

    // Escape closes without changing the selection.
    await combobox.fill('несъществуващ')
    await expect(listbox.getByText('Няма такъв списък.')).toBeVisible()
    await combobox.press('Escape')
    await expect(listbox).toBeHidden()
    await expect(combobox).toHaveValue('доброволци · #12 (1 контакт)')

    // The id matches too.
    await combobox.fill('94')
    await expect(listbox.getByRole('option')).toHaveText(['ТЕСТ ti-broish staging (0 контакта)'])
    await combobox.press('Enter')
    await expect(combobox).toHaveValue('ТЕСТ ti-broish staging (0 контакта)')

    await syncPanel.getByRole('button', { name: 'Провери колко' }).click()
    await expect(syncPanel.getByRole('status')).toHaveText('Ще се синхронизира 1 контакт към списък „ТЕСТ ti-broish staging“.')
    await expect(syncPanel.getByRole('button', { name: 'Синхронизирай 1 контакт към „ТЕСТ ti-broish staging“' })).toBeVisible()
    expect(syncRequests).toHaveLength(1)
    expect(syncRequests[0]).toContain('94')
    expect(syncRequests[0]).toContain('dryRun')
  })

  test('distribution lists only finished signups and marks paper against machine', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/sections')
    await expect(page.getByText('Тук са само хората, които са завършили записването.')).toBeVisible()
    await expect(page.getByText('Хартиена', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Машинна', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('call.admin-e2e@example.com')).toBeVisible()
    await expect(page.getByText('ivan.admin-e2e@example.com')).toHaveCount(0)
    await page.getByTestId('state-draft').click()
    await expect(page.getByText('ivan.admin-e2e@example.com')).toHaveCount(0)
    await page.getByTestId('state-published').click()
    await expect(page.getByRole('table').getByText(STAFF_EMAIL)).toBeVisible()
    await expect(page.getByText('ivan.admin-e2e@example.com')).toHaveCount(0)
    await page.getByTestId('state-none').click()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('button', { name: 'Направи чернови за страната' })).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByRole('button', { name: 'Направи чернови за страната' }).click()
    await page.getByRole('button', { name: 'Да, запиши черновите (без публикуване, корекциите остават)' }).click()
    const notice = page.getByText(/Записахме \d+ чернов/)
    await expect(notice).toBeVisible({ timeout: 90_000 })
    await page.waitForLoadState('networkidle')
    await expect(notice).toBeVisible()
    await page.getByRole('button', { name: 'Изчисти черновите' }).click()
    await page.getByRole('button', { name: 'Да, изчисти автоматичните чернови (ръчните и публикуваните остават)' }).click()
    await expect(page.getByText(/Изчистихме \d+ автоматичн|Няма автоматични чернови/)).toBeVisible()
    await page.getByTestId('state-published').click()
    await expect(page.getByRole('table').getByText(STAFF_EMAIL)).toBeVisible()
  })

  test('Пълномощни explains missing Drive credentials and keeps upload disabled', async ({ page }) => {
    await mockPalnomoshtniServerFns(page, { missingHealth: true, uploads: [] })
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/palnomoshtni')
    await expect(page.getByRole('heading', { name: 'Пълномощни' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Drive и Brevo' })).toContainText('GOOGLE_SERVICE_ACCOUNT_JSON')
    await expect(page.getByRole('region', { name: 'Drive и Brevo' })).toContainText('Качването към Drive е изключено')
    await expect(page.getByRole('button', { name: /Качи/ })).toBeDisabled()
  })

  test('Пълномощни matches signed PDFs, skips duplicates, uploads and syncs Brevo', async ({ page }) => {
    const uploads: string[] = []
    const brevoCalls: string[] = []
    await mockPalnomoshtniServerFns(page, { missingHealth: false, uploads, brevoCalls })
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/palnomoshtni')
    await expect(page.getByRole('heading', { name: 'Пълномощни' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Мария Георгиева Петрова' })).toBeVisible()
    // Names in „Хора“ open the admin profile, like Записани and Секции.
    await expect(page.getByRole('cell', { name: 'Мария Георгиева Петрова' }).getByRole('link', { name: 'Мария Георгиева Петрова' })).toHaveAttribute('href', '/admin/signups/e2e-maria')
    const pdf = Buffer.from('%PDF-1.4 test')
    await page.getByLabel('Подписани PDF или ZIP').setInputFiles([
      { name: '0001_234600101_Petrova_signed.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: '0002_234600102_Ivanov_SIGNED (1).PDF', mimeType: 'application/pdf', buffer: pdf },
      { name: '0001_234600101_Petrova_signed (1).pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: '9999_000000000_Nobody_signed.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') },
    ])
    await expect(page.getByText('Съвпаднали 1, без съвпадение 1, дубликати 1, не PDF 1')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'дубликат' })).toBeVisible()
    await expect(page.getByText('без _signed')).toHaveCount(0)
    await expect(page.getByText('няма човек с този номер')).toBeVisible()
    await expect(page.getByText('не е PDF (разширение)')).toBeVisible()
    await page.getByRole('button', { name: 'Качи 1 подписани' }).click()
    await expect(page.getByRole('status')).toHaveText('Качени 1 от 1; Brevo (DOCUMENT_URL): 1 обновени / 0 грешки.')
    await expect(page.getByRole('table', { name: 'Резултат от качването' }).getByRole('cell', { name: 'обновен', exact: true })).toBeVisible()
    await expect(page.getByRole('table', { name: 'Резултат от качването' }).getByRole('link', { name: 'Иван Иванов Иванов' })).toHaveAttribute('href', '/admin/signups/e2e-ivanov')
    expect(uploads).toEqual(['e2e-ivanov'])
    // The upload itself syncs DOCUMENT_URL on the server; no second Brevo round trip from the page.
    expect(brevoCalls).toEqual([])
  })

  test('Пълномощни shows the Brevo sync result after an upload (the button is not silent)', async ({ page }) => {
    const uploads: string[] = []
    const brevoCalls: string[] = []
    await mockPalnomoshtniServerFns(page, { missingHealth: false, uploads, brevoCalls, signed: true })
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/palnomoshtni')
    await expect(page.getByRole('cell', { name: 'Мария Георгиева Петрова' })).toBeVisible()
    await page.getByLabel('Подписани PDF или ZIP').setInputFiles([
      { name: '0002_234600102_Ivanov_signed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') },
    ])
    await page.getByRole('button', { name: 'Качи 1 подписани' }).click()
    const upload = page.getByRole('region', { name: 'Качване на подписани' })
    await expect(upload.getByRole('status')).toHaveText('Качени 1 от 1; Brevo (DOCUMENT_URL): 1 обновени / 0 грешки.')
    const brevo = page.getByRole('region', { name: 'Синхрон с Brevo' })
    await brevo.getByRole('button', { name: 'Синхронизирай с Brevo' }).click()
    await expect(brevo.getByRole('status')).toHaveText('Brevo (DOCUMENT_URL): 1 обновени / 1 грешки: Contact does not exist')
    await expect(brevo.getByRole('list', { name: 'Грешки при синхрон с Brevo' })).toContainText('Contact does not exist')
    expect(brevoCalls.some((body) => body.includes('allSigned'))).toBe(true)
  })

  test('Пълномощни shows a Brevo error when the sync call itself fails', async ({ page }) => {
    await mockPalnomoshtniServerFns(page, { missingHealth: false, uploads: [], signed: true, brevoThrows: true })
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/palnomoshtni')
    await expect(page.getByRole('cell', { name: 'Мария Георгиева Петрова' })).toBeVisible()
    const brevo = page.getByRole('region', { name: 'Синхрон с Brevo' })
    await brevo.getByRole('button', { name: 'Синхронизирай с Brevo' }).click()
    await expect(brevo.getByRole('status')).toHaveText('Brevo: Key not found (unauthorized)')
  })

  test('Пълномощни shows a Brevo sync failure next to the uploaded file', async ({ page }) => {
    const uploads: string[] = []
    await mockPalnomoshtniServerFns(page, { missingHealth: false, uploads, brevoFails: true })
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/palnomoshtni')
    await expect(page.getByRole('cell', { name: 'Мария Георгиева Петрова' })).toBeVisible()
    await page.getByLabel('Подписани PDF или ZIP').setInputFiles([
      { name: '0002_234600102_Ivanov_signed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') },
    ])
    await page.getByRole('button', { name: 'Качи 1 подписани' }).click()
    await expect(page.getByRole('status')).toContainText('Качени 1 от 1; Brevo (DOCUMENT_URL): 0 обновени / 1 грешки')
    const results = page.getByRole('table', { name: 'Резултат от качването' })
    await expect(results.getByRole('cell', { name: 'качен', exact: true })).toBeVisible()
    await expect(results.getByRole('cell', { name: 'грешка: В Brevo няма атрибут DOCUMENT_URL.' })).toBeVisible()
  })

  test('Пълномощни re-syncs stored Drive links to Brevo without uploading', async ({ page }) => {
    const uploads: string[] = []
    const brevoCalls: string[] = []
    await mockPalnomoshtniServerFns(page, { missingHealth: false, uploads, brevoCalls, signed: true })
    await signIn(page)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin/palnomoshtni')
    await expect(page.getByRole('cell', { name: 'Мария Георгиева Петрова' })).toBeVisible()
    const upload = page.getByRole('region', { name: 'Качване на подписани' })
    const brevo = page.getByRole('region', { name: 'Синхрон с Brevo' })
    await expect(brevo.getByRole('button', { name: 'Синхронизирай с Brevo' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Действия' }).getByRole('button', { name: 'Синхронизирай с Brevo' })).toHaveCount(0)
    const uploadBox = await upload.boundingBox()
    const brevoBox = await brevo.boundingBox()
    expect(uploadBox && brevoBox && brevoBox.y > uploadBox.y + uploadBox.height - 1).toBe(true)
    await brevo.getByRole('button', { name: 'Синхронизирай с Brevo' }).click()
    await expect(page.getByText('Brevo (DOCUMENT_URL): 1 обновени / 1 грешки: Contact does not exist')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Грешки при синхрон с Brevo' })).toContainText('Contact does not exist')
    expect(uploads).toEqual([])
    expect(brevoCalls.some((body) => body.includes('allSigned'))).toBe(true)
  })
})

const MOCK_BREVO_LISTS = [
  { id: 101, name: 'Доброволци', subscribers: 12 },
  { id: 95, name: 'Представители със секция ПВР 2026', subscribers: 120 },
  { id: 94, name: 'ТЕСТ ti-broish staging', subscribers: 0 },
  { id: 12, name: 'доброволци', subscribers: 1 },
  { id: 7, name: 'Newsletter', subscribers: 3 },
]

const MOCK_PALNOMOSHTNI_PEOPLE = [
  {
    id: 'e2e-maria',
    number: 1,
    name: 'Мария Георгиева Петрова',
    lastName: 'Петрова',
    section: '234600101',
    mir: '23',
    generatedAt: '2026-10-18T10:00:00.000Z',
    signedAt: null,
    driveUrl: 'https://drive.google.com/file/d/old-maria/view',
    hasDriveFile: true,
  },
  {
    id: 'e2e-ivanov',
    number: 2,
    name: 'Иван Иванов Иванов',
    lastName: 'Иванов',
    section: '234600102',
    mir: '23',
    generatedAt: null,
    signedAt: null,
    driveUrl: null,
    hasDriveFile: false,
  },
]

async function mockPalnomoshtniServerFns(
  page: Page,
  opts: {
    missingHealth: boolean
    uploads: string[]
    onBrevo?: (body: string) => void
    brevoFails?: boolean
    brevoThrows?: boolean
    brevoCalls?: string[]
    signed?: boolean
  },
) {
  const missingMessage =
    'Липсват GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN. Липсва DESIGNATION_DRIVE_FOLDER_ID (или DRIVE_FOLDER_ID). Качването към Drive е изключено.'
  await page.route('**/admin/palnomoshtni/upload**', async (route) => {
    const url = new URL(route.request().url())
    opts.uploads.push(url.searchParams.get('personId') ?? '')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        url: 'https://drive.google.com/file/d/new/view',
        replaced: false,
        brevo: opts.brevoFails
          ? { ok: false, attribute: 'DOCUMENT_URL', error: 'В Brevo няма атрибут DOCUMENT_URL.' }
          : { ok: true, attribute: 'DOCUMENT_URL' },
      }),
    })
  })
  await page.route('**/_serverFn/**', async (route) => {
    const segment = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    let exported = ''
    try {
      exported = (JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { export?: string }).export ?? ''
    } catch {
      exported = ''
    }
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: body }) })
    if (exported.startsWith('adminDesignationStatus_')) {
      return reply({
        ok: true,
        counts: opts.signed
          ? { published: 2, numbered: 2, generated: 2, signed: 2, missing: 0 }
          : { published: 2, numbered: 2, generated: 1, signed: 0, missing: 2 },
        people: MOCK_PALNOMOSHTNI_PEOPLE,
        mirs: [{ code: '23', label: '23 София-град', count: 2 }],
        zipEligible: 2,
        zipBatchLimit: 100,
      })
    }
    if (exported.startsWith('adminDesignationHealth_')) {
      if (opts.missingHealth) {
        return reply({
          ok: true,
          canUpload: false,
          message: missingMessage,
          health: {
            credentialKind: 'none',
            missingSecrets: [
              'GOOGLE_SERVICE_ACCOUNT_JSON',
              'GOOGLE_OAUTH_CLIENT_ID',
              'GOOGLE_OAUTH_CLIENT_SECRET',
              'GOOGLE_OAUTH_REFRESH_TOKEN',
            ],
            folderId: '',
            folderIdSource: 'none',
            tokenOk: false,
            folderOk: false,
            folderName: '',
            folderIsFolder: false,
            folderError: 'Липсва DESIGNATION_DRIVE_FOLDER_ID (или DRIVE_FOLDER_ID).',
            brevoKey: false,
            brevoAttribute: 'DOCUMENT_URL',
            brevoListId: null,
          },
        })
      }
      return reply({
        ok: true,
        canUpload: true,
        message: 'Услуга: служебен акаунт; токенът е получен; папка „ТЕСТ пълномощни“ е достъпна. Brevo: DOCUMENT_URL, списък 94.',
        health: {
          credentialKind: 'service-account',
          missingSecrets: [],
          folderId: 'folder',
          folderIdSource: 'DESIGNATION_DRIVE_FOLDER_ID',
          tokenOk: true,
          folderOk: true,
          folderName: 'ТЕСТ пълномощни',
          folderIsFolder: true,
          folderError: '',
          brevoKey: true,
          brevoAttribute: 'DOCUMENT_URL',
          brevoListId: 94,
        },
      })
    }
    if (exported.startsWith('adminDesignationSyncBrevo_')) {
      opts.onBrevo?.(route.request().postData() ?? '')
      const body = route.request().postData() ?? ''
      opts.brevoCalls?.push(body)
      if (opts.brevoThrows) {
        return reply({ ok: false, attribute: 'DOCUMENT_URL', total: 2, results: [], nextOffset: null, message: 'Brevo: Key not found (unauthorized)' })
      }
      if (body.includes('allSigned')) {
        return reply({
          ok: false,
          attribute: 'DOCUMENT_URL',
          updated: 1,
          failed: 1,
          nextOffset: null,
          results: [
            { personId: 'e2e-maria', ok: true },
            { personId: 'e2e-ivanov', ok: false, error: 'Contact does not exist' },
          ],
          message: 'Brevo (DOCUMENT_URL): 1 обновени / 1 грешки: Contact does not exist',
        })
      }
      if (opts.brevoFails) {
        return reply({
          ok: false,
          attribute: 'DOCUMENT_URL',
          updated: 0,
          failed: 1,
          nextOffset: null,
          results: [{ personId: 'e2e-ivanov', ok: false, error: 'В Brevo няма атрибут DOCUMENT_URL.' }],
          message: 'Brevo (DOCUMENT_URL): 0 обновени / 1 грешки: В Brevo няма атрибут DOCUMENT_URL.',
        })
      }
      return reply({
        ok: true,
        attribute: 'DOCUMENT_URL',
        updated: 1,
        failed: 0,
        nextOffset: null,
        results: [{ personId: 'e2e-ivanov', ok: true }],
        message: 'Brevo (DOCUMENT_URL): 1 обновени / 0 грешки.',
      })
    }
    return route.continue()
  })
}

/** Answer the Brevo admin server functions with plain JSON so no Brevo key or network is needed. */
async function mockBrevoServerFns(page: Page, syncRequests: string[]) {
  await page.route('**/_serverFn/**', async (route) => {
    const segment = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    let exported = ''
    try {
      exported = (JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { export?: string }).export ?? ''
    } catch {
      exported = ''
    }
    // Plain (non-seroval) JSON is accepted by the client fetcher; it unwraps `.result`.
    const reply = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: body }) })
    if (exported.startsWith('adminBrevoStatus_')) {
      return reply({ ok: true, configured: true, listId: 95, templateId: null, senderEmail: 'team@tibroish.bg', senderName: 'Ти броиш' })
    }
    if (exported.startsWith('adminBrevoHealth_')) {
      return reply({ ok: false, message: 'Проверката на Brevo е изключена в теста.' })
    }
    if (exported.startsWith('adminBrevoLists_')) {
      return reply({ ok: true, configured: true, lists: MOCK_BREVO_LISTS, defaultListId: 95 })
    }
    if (exported.startsWith('adminBrevoSyncSections_')) {
      syncRequests.push(route.request().postData() ?? '')
      return reply({
        ok: true,
        dryRun: true,
        total: 1,
        listId: 94,
        listName: 'ТЕСТ ti-broish staging',
        samples: ['m***@example.com'],
        lackingSection: 0,
        lackingSms: 0,
        message: 'Ще се синхронизира 1 контакт към списък „ТЕСТ ti-broish staging“.',
      })
    }
    return route.continue()
  })
}

async function signIn(page: Page) {
  await page.context().addCookies([
    { name: 'tb_session', value: SESSION, url: 'http://127.0.0.1:3000', httpOnly: true, sameSite: 'Lax' },
  ])
}

async function sessionValue(page: Page) {
  const cookies = await page.context().cookies('http://127.0.0.1:3000')
  return cookies.find((cookie) => cookie.name === 'tb_session')?.value
}

function seedReservedVolunteer() {
  const sql = `
DELETE FROM taken_sections WHERE organisation = 'E2E Резерв';
INSERT INTO signups (
  id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, role,
  mir_code, region_code, town_name, section_place, draft_section, published_section, notes,
  rounds_first, rounds_runoff, radius, created_at, updated_at
) VALUES (
  'e2e-reserved',
  'reserved.admin-e2e@example.com',
  'e2e-reserved-session',
  'e2eres01',
  '{"firstName":"Рая","middleName":"","lastName":"Резервова","phone":"0888000222","email":"reserved.admin-e2e@example.com","role":"section","rounds":{"first":true,"runoff":true},"place":{"regionCode":"23","regionName":"София-град","municipalityName":"Столична","townName":"гр. София"}}',
  1, 0, 1, '', 'section',
  '23', '23', 'гр. София', 'ул. Резерв 1', '234600150', '', '',
  1, 1, 'settlement', datetime('now'), datetime('now')
)
ON CONFLICT(email) DO UPDATE SET
  session_token = excluded.session_token,
  payload = excluded.payload,
  email_confirmed = 1,
  submitted = 1,
  withdrawn = 0,
  mir_code = '23',
  draft_section = '234600150',
  published_section = NULL;
`
  runLocalD1(sql)
}

function seedMobileTeam() {
  // 001 and 002 are open priority sections in the person's village; 003 is reserved by another org;
  // 004 already has a section person; 005 is in another village, out of reach without a car.
  const sql = `
${MOBILE_DRAFTS_TABLE};
${PRIORITY_SECTIONS_TABLE};
DELETE FROM mobile_drafts WHERE signup_id = 'e2e-mobile';
DELETE FROM priority_sections WHERE section_code LIKE '2999%';
INSERT INTO priority_sections (section_code, town, municipality, oblast, r, level, components, updated_at) VALUES
  ('299900001', 'с.Мобилно', 'Мобилна', 'ШУМЕН', 4.2, 'elevated', '{}', datetime('now')),
  ('299900002', 'с. Мобилно', 'Мобилна', 'ШУМЕН', 3.1, 'watch', '{}', datetime('now')),
  ('299900003', 'с.Мобилно', 'Мобилна', 'ШУМЕН', 4.9, 'elevated', '{}', datetime('now')),
  ('299900004', 'с.Мобилно', 'Мобилна', 'ШУМЕН', 4.8, 'elevated', '{}', datetime('now')),
  ('299900005', 'с.Другo', 'Мобилна', 'ШУМЕН', 4.7, 'elevated', '{}', datetime('now'));
INSERT INTO taken_sections (section_code, mir_code, place, organisation, note, created_at) VALUES ('299900003', '29', '', 'E2E Мобилен резерв', '', datetime('now'))
  ON CONFLICT(section_code) DO UPDATE SET organisation = excluded.organisation;
INSERT INTO signups (
  id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, role,
  mir_code, region_code, town_name, section_place, draft_section, published_section, notes,
  rounds_first, rounds_runoff, radius, has_car, created_at, updated_at
) VALUES (
  'e2e-mobile',
  'mobile.admin-e2e@example.com',
  'e2e-mobile-session',
  'e2emob01',
  '{"firstName":"Мира","middleName":"","lastName":"Мобилна","phone":"0888000333","email":"mobile.admin-e2e@example.com","role":"mobile","mobileTeam":true,"rounds":{"first":true,"runoff":true},"place":{"regionCode":"29","regionName":"Шумен","municipalityCode":"99","municipalityName":"Мобилна","townName":"с.Мобилно"}}',
  1, 0, 1, '', 'mobile',
  '29', '29', 'с.Мобилно', '', NULL, NULL, '',
  1, 1, 'settlement', 0, datetime('now'), datetime('now')
), (
  'e2e-mobile-covered',
  'mobile.covered-e2e@example.com',
  'e2e-mobile-covered-session',
  'e2emob02',
  '{"firstName":"Кира","lastName":"Покрита","role":"section"}',
  1, 0, 1, '', 'section',
  '29', '29', 'с.Мобилно', '', '299900004', NULL, '',
  1, 1, 'settlement', 0, datetime('now'), datetime('now')
)
ON CONFLICT(email) DO UPDATE SET payload = excluded.payload, submitted = 1, withdrawn = 0, role = excluded.role,
  mir_code = '29', draft_section = excluded.draft_section, published_section = NULL, radius = 'settlement', has_car = 0;
`
  runLocalD1(sql)
}

function seedAbroadVolunteer() {
  const sql = `
INSERT INTO signups (
  id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, role,
  mir_code, region_code, town_name, section_place, draft_section, published_section, notes,
  rounds_first, rounds_runoff, radius, created_at, updated_at
) VALUES (
  'e2e-abroad',
  'abroad.admin-e2e@example.com',
  'e2e-abroad-session',
  'e2eabr01',
  '{"firstName":"Анна","middleName":"","lastName":"Лондон","phone":"0888000111","email":"abroad.admin-e2e@example.com","role":"section","rounds":{"first":true,"runoff":true},"place":{"regionCode":"32","regionName":"Извън страната","countryName":"Австрия","townName":"Виена"}}',
  1, 0, 1, '', 'section',
  '32', '32', 'Виена', 'Виена', '', '', '',
  1, 1, 'settlement', datetime('now'), datetime('now')
)
ON CONFLICT(email) DO UPDATE SET
  session_token = excluded.session_token,
  payload = excluded.payload,
  email_confirmed = 1,
  submitted = 1,
  role = 'section',
  mir_code = '32',
  region_code = '32',
  town_name = 'Виена',
  draft_section = NULL,
  published_section = NULL;
`
  runLocalD1(sql)
}

function seedStaffRoster() {
  const sql = `
INSERT INTO signups (
  id, email, session_token, referral_code, payload, email_confirmed, withdrawn, submitted, egn, role,
  mir_code, region_code, town_name, section_place, draft_section, published_section, notes,
  staff_note, staff_called_at, staff_called_by, rounds_first, rounds_runoff, radius, created_at, updated_at
) VALUES
(
  'e2e-maria',
  '${STAFF_EMAIL}',
  '${SESSION}',
  'e2emaria',
  '{"firstName":"Мария","middleName":"Георгиева","lastName":"Петрова","phone":"0888111222","email":"${STAFF_EMAIL}","role":"section","rounds":{"first":true,"runoff":true},"radius":"cityRegion","place":{"regionCode":"23","regionName":"София-град","municipalityName":"Столична","townName":"гр. София","cityRegionName":"Младост","sectionPlace":"ул. Витоша 1"}}',
  1, 0, 1, '0041010002', 'section',
  '23', '23', 'гр. София', 'ул. Витоша 1', '', '234600101', '',
  '', '', '', 1, 1, 'cityRegion', datetime('now'), datetime('now')
),
(
  'e2e-ivan',
  'ivan.admin-e2e@example.com',
  'e2e-ivan-session',
  'e2eivan1',
  '{"firstName":"Иван","middleName":"Иванов","lastName":"Иванов","phone":"0888333444","email":"ivan.admin-e2e@example.com"}',
  1, 0, 0, '', 'mobile',
  '24', '24', 'гр. София', 'ул. Пример 2', '244600199', '', '',
  '', '', '', 0, 0, '', datetime('now'), datetime('now')
),
(
  'e2e-call',
  'call.admin-e2e@example.com',
  'e2e-call-session',
  'e2ecall1',
  '{"firstName":"Петър","middleName":"Петров","lastName":"Петров","phone":"0888555666","email":"call.admin-e2e@example.com","callRequestedAt":"2026-10-02T08:00:00.000Z","callMessage":"За секцията","rounds":{"first":true,"runoff":false}}',
  1, 0, 1, '', 'section',
  '23', '23', 'гр. София', 'ул. Обаждане 3', '', '', '',
  'Ще се обадим утре.', '', '', 1, 0, '', datetime('now'), datetime('now')
),
(
  'e2e-withdraw',
  'withdraw.admin-e2e@example.com',
  'e2e-withdraw-session',
  'e2ewith1',
  '{"firstName":"Анна","middleName":"Ангелова","lastName":"Ангелова","phone":"0888777888","email":"withdraw.admin-e2e@example.com","role":"section","rounds":{"first":true,"runoff":true},"submitted":true}',
  1, 0, 1, '0041010003', 'section',
  '23', '23', 'гр. София', 'ул. Отпис 4', '234600188', '234600177', '',
  '', '', '', 1, 1, 'cityRegion', datetime('now'), datetime('now')
)
ON CONFLICT(email) DO UPDATE SET
  session_token = excluded.session_token,
  payload = excluded.payload,
  email_confirmed = 1,
  submitted = excluded.submitted,
  withdrawn = excluded.withdrawn,
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
  rounds_runoff = excluded.rounds_runoff,
  radius = excluded.radius,
  withdrawn_at = NULL,
  withdrawn_by = NULL,
  withdrawn_reason = NULL,
  withdrawn_note = NULL,
  withdrawal_processed_at = NULL,
  withdrawal_processed_by = NULL;
INSERT INTO staff (email, role, invited_by, created_at)
VALUES ('${STAFF_EMAIL}', 'admin', 'e2e', datetime('now'))
ON CONFLICT(email) DO UPDATE SET role = 'admin';
`
  runLocalD1(sql)
}

function runLocalD1(sql: string) {
  // Other workers write to the same local D1, so a busy database is retried.
  for (let attempt = 1; ; attempt += 1) {
    try {
      execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'ti-broish-signup-staging', '--local', '--command', sql], {
        cwd: new URL('.', import.meta.url).pathname.replace(/e2e\/$/, ''),
        stdio: 'pipe',
      })
      return
    } catch (error) {
      const busy = /SQLITE_BUSY|database is locked/.test(String((error as { stdout?: unknown }).stdout ?? '') + String((error as { stderr?: unknown }).stderr ?? '') + String(error))
      if (!busy || attempt >= 5) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt)
    }
  }
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
