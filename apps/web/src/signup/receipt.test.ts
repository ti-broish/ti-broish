import { describe, expect, it } from 'vitest'
import { emptyProfile, type HomePlace } from './model'
import { receiptClaimed, signupReceiptMail } from './receipt'

const home: HomePlace = {
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
  machineCount: 0,
}

describe('signup receipt', () => {
  it('confirms the answers and leaves the national number out', () => {
    const mail = signupReceiptMail(
      {
        ...emptyProfile(),
        firstName: 'Мария',
        middleName: 'Иванова',
        lastName: 'Петрова',
        email: 'maria@example.com',
        phone: '0888123456',
        egn: '0041010002',
        emailConfirmed: true,
        role: 'section',
        rounds: { first: true, runoff: true },
        experience: 'never',
        place: home,
        radius: 'cityRegion',
        consent: true,
        submitted: true,
      },
      'https://tibroish.bg/profil',
    )
    expect(mail.subject).toBe('Записването ти е прието — Ти Броиш')
    expect(mail.to).toBe('maria@example.com')
    expect(mail.text).toContain('Здравей, Мария,')
    expect(mail.text).toContain('Име: Мария Иванова Петрова')
    expect(mail.text).toContain('Телефон: 0888123456')
    expect(mail.text).toContain('Роля: Секция')
    expect(mail.text).toContain('Дни: 25 октомври и 1 ноември')
    expect(mail.text).toContain('Опит: За първи път')
    expect(mail.text).toContain('Място: София-град, Столична, гр. София, Младост, ул. Пример 1')
    expect(mail.text).toContain('Докъде: Само в Младост')
    expect(mail.text).toContain('https://tibroish.bg/profil')
    expect(mail.text).not.toContain('0041010002')
    expect(mail.html).not.toContain('0041010002')
    expect(mail.html).toContain('href="https://tibroish.bg/profil"')
  })

  it('escapes a name that contains markup', () => {
    const mail = signupReceiptMail(
      {
        ...emptyProfile(),
        firstName: '<Мария>',
        lastName: 'Петрова',
        email: 'maria@example.com',
        role: 'mobile',
        hasCar: false,
        hasDrone: true,
        rounds: { first: true, runoff: false },
      },
      'https://tibroish.bg/profil?x=1&y=2',
    )
    expect(mail.text).toContain('Дни: 25 октомври')
    expect(mail.text).toContain('Без кола')
    expect(mail.text).toContain('Има дрон')
    expect(mail.html).toContain('&lt;Мария&gt;')
    expect(mail.html).not.toContain('<Мария>')
    expect(mail.html).toContain('href="https://tibroish.bg/profil?x=1&amp;y=2"')
  })

  it('treats a search-trigger write as a claimed receipt', () => {
    expect(receiptClaimed(1)).toBe(true)
    expect(receiptClaimed(11)).toBe(true)
    expect(receiptClaimed(0)).toBe(false)
    expect(receiptClaimed(null)).toBe(false)
  })
})
