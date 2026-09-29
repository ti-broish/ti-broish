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
  await expect(page.getByRole('group', { name: 'Имаш ли кола?' })).toBeVisible()
})

test('a mobile team inside the city only answers about a drone', async ({ page }) => {
  await seedProfile(page, registered({ role: 'mobile', radius: 'cityRegion', hasCar: null, hasDrone: null }))
  await page.goto('/signup?step=seats')
  await expect(page.getByRole('heading', { name: 'Дрон' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Имаш ли кола?' })).toHaveCount(0)
  await expect(page.getByText('Имаш дрон или можеш да го оперираш?')).toBeVisible()
})

test('car seats appear only when traveling, and a drone stays with the mobile team', async ({ page }) => {
  await seedProfile(page, registered({ role: 'mobile', radius: 'municipality', hasCar: null, hasDrone: null }))
  await page.goto('/signup?step=seats')
  await expect(page.getByRole('heading', { name: 'Кола и дрон' })).toBeVisible()
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
  await page.getByLabel('Име', { exact: true }).fill('Мария')
  await page.getByLabel('Фамилия').fill('Петрова')
  await page.getByLabel('Имейл', { exact: true }).fill('maria@example.com')
  await page.getByLabel('Телефон').fill('0888000001')
  await page.getByRole('button', { name: 'Добави пазител' }).click()
  await expect(page.getByText('В групата · maria@example.com')).toBeVisible()

  await page.getByRole('button', { name: 'Добавям хора извън групата, като координатор' }).click()
  await page.getByLabel('Име', { exact: true }).fill('Петър')
  await page.getByLabel('Фамилия').fill('Георгиев')
  await page.getByLabel('Имейл', { exact: true }).fill('peter@example.com')
  await page.getByLabel('Телефон').fill('0888000002')
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
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/profil')
  const registeredHeading = page.getByRole('heading', { name: 'Записан си' })
  await expect(registeredHeading).toBeVisible()
  await expect(page.getByRole('heading', { name: '5 октомври' })).toBeVisible()
  const text = await page.locator('main').innerText()
  expect(text.indexOf('Записан си')).toBeLessThan(text.indexOf('5 октомври'))
  expect(text.indexOf('5 октомври')).toBeLessThan(text.indexOf('Материали'))
  expect(text.indexOf('Материали')).toBeLessThan(text.indexOf('Покани'))
  expect(text.indexOf('Покани')).toBeLessThan(text.indexOf('Твоите данни'))
  expect(text.indexOf('Твоите данни')).toBeLessThan(text.indexOf('Оттегли записването'))

  const facts = page.getByRole('region', { name: 'Твоите данни' })
  const phoneHeading = await registeredHeading.boundingBox()
  const phoneSummary = await facts.boundingBox()
  expect(phoneSummary!.y).toBeGreaterThan(phoneHeading!.y + phoneHeading!.height)
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

  await page.setViewportSize({ width: 1280, height: 800 })
  const status = page.getByRole('region', { name: 'Записан си' })
  const wideStatus = await status.boundingBox()
  const wideSummary = await facts.boundingBox()
  expect(wideSummary!.y).toBeLessThan(wideStatus!.y + wideStatus!.height)
  expect(wideStatus!.y).toBeLessThan(wideSummary!.y + wideSummary!.height)
  expect(wideSummary!.x).toBeGreaterThan(wideStatus!.x)
  expect((await page.locator('main').boundingBox())!.width).toBeGreaterThan(700)
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
  await expect(page.getByRole('link', { name: 'Продължи записването' })).toHaveAttribute('href', /step=egn/)
  await expect(page.getByRole('region', { name: 'Твоите данни' }).getByRole('definition').filter({ hasText: 'Липсва' })).toBeVisible()
  await expect(page.locator('main')).not.toContainText('0041010002')
})

test('an assigned profile leads with the section and the badge', async ({ page }) => {
  await seedProfile(page, registered({ assignedSection: '234600101' }))
  await page.goto('/profil')
  await expect(page.getByRole('heading', { name: '234600101' })).toBeVisible()
  await expect(page.getByText('25 октомври и 1 ноември. Екипът вече е определил секцията.')).toBeVisible()
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
    await expect(link).toHaveCSS('color', 'rgb(255, 255, 255)')
  }
  await expect(page.getByRole('link', { name: 'Сподели в WhatsApp' })).toHaveCSS('background-color', 'rgb(7, 94, 84)')
  const instagram = await page.getByRole('link', { name: 'Сподели в Instagram' }).evaluate((element) => getComputedStyle(element).backgroundImage)
  expect(instagram).toContain('rgb(214, 41, 118)')
  expect(instagram).not.toContain('rgb(240, 148, 51)')
})

test('instructions link the handbook and the signal form', async ({ page }) => {
  await page.goto('/instructions')
  await expect(page.getByRole('heading', { name: 'Преди да влезеш в секцията' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Наръчник на пазителя на вота' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Уроци от досегашните кампании' })).toBeVisible()
  const lesson = page.getByRole('link', { name: 'Как броим' })
  await expect(lesson).toHaveAttribute('href', 'https://www.youtube.com/watch?v=9WAcSKL-hQg')
  await expect(lesson).toHaveAttribute('target', '_blank')
  await page.goto('/privacy-notice')
  await expect(page.getByRole('heading', { name: 'Декларация за поверителност' })).toBeVisible()
  await expect(page.getByText('ЕИК 177151578')).toBeVisible()
  await expect(page.getByText('Записването е за пълнолетни.')).toBeVisible()
  await page.goto('/instructions')
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

test('an invalid confirm link stays on the page', async ({ page }) => {
  await page.goto('/potvardi')
  await expect(page.getByRole('heading', { name: 'Линкът не е валиден' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Нещо се обърка' })).toHaveCount(0)
  await page.goto('/potvardi?companion=not-a-real-token')
  await expect(page.getByRole('heading', { name: 'Линкът не е валиден' })).toBeVisible()
})

test('a profile with no days continues on the days step', async ({ page }) => {
  await seedProfile(page, registered({ rounds: { first: false, runoff: false }, consent: false, submitted: false }))
  await page.goto('/profil')
  await expect(page.getByText('Остава поне един от двата дни.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Продължи записването' })).toHaveAttribute('href', /step=rounds/)
})

test('an unconfirmed email is not shown as waiting for a section', async ({ page }) => {
  await seedProfile(page, registered({ emailConfirmed: false, submitted: true }))
  await page.goto('/profil')
  await expect(page.getByRole('heading', { name: 'Записването не е готово' })).toBeVisible()
  await expect(page.getByText('Остава да потвърдиш имейла.')).toBeVisible()
  await expect(page.getByRole('heading', { name: '5 октомври' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Продължи записването' })).toHaveAttribute('href', /step=confirm/)
})

test('review will not finish while a step is still empty', async ({ page }) => {
  await seedProfile(page, registered({ radius: null, consent: true, submitted: false }))
  await page.goto('/signup?step=review')
  await expect(page.getByRole('link', { name: 'Попълни липсващото' })).toHaveAttribute('href', /step=travel/)
  await page.getByRole('link', { name: 'Попълни липсващото' }).click()
  await expect(page.getByRole('heading', { name: 'Докъде можеш да стигнеш' })).toBeVisible()
})

test('someone without a profile can label the call request', async ({ page }) => {
  await page.goto('/profil')
  await expect(page.getByRole('heading', { name: 'Още нямаш профил' })).toBeVisible()
  await expect(page.getByLabel('Име', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Телефон')).toBeVisible()
  await expect(page.getByLabel('За какво е обаждането')).toBeVisible()
})

test('a confirmed email can sign in from a fresh browser', async ({ page, browser }) => {
  const email = `vhod-${Date.now()}@example.com`
  await page.goto('/signup?step=contact')
  await page.getByLabel('Име', { exact: true }).fill('Никола')
  await page.getByLabel('Презиме').fill('Николов')
  await page.getByLabel('Фамилия').fill('Николов')
  await page.getByLabel('Имейл').fill(email)
  await page.getByLabel('Телефон').fill('0888123456')
  await page.getByRole('button', { name: 'Изпрати код за потвърждение' }).click()
  await page.getByRole('button', { name: 'Продължи с този код' }).click()
  await expect(page.getByRole('heading', { name: 'ЕГН за разпределението' })).toBeVisible()

  const fresh = await browser.newContext()
  const other = await fresh.newPage()
  await other.goto('/vhod', { waitUntil: 'networkidle' })
  await expect(other.getByRole('heading', { name: 'Влез в профила си' })).toBeVisible()
  await expect(other.getByText('tb_session')).toHaveCount(0)
  const emailField = other.getByLabel('Имейл')
  await emailField.fill(email)
  await expect(emailField).toHaveValue(email)
  await other.getByRole('button', { name: 'Изпрати код' }).click()
  await expect(other.locator('main')).toContainText(/Кодът е \d{6}/)
  const code = (await other.locator('main').innerText()).match(/Кодът е (\d{6})/)?.[1]
  await other.getByLabel('Код от писмото').fill(code ?? '')
  await other.getByRole('button', { name: 'Влез' }).click()
  await expect(other.getByRole('heading', { name: 'Никола, това е профилът ти' })).toBeVisible()
  await fresh.close()
})
