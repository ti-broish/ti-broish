import { describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({ env: {} }))

const { companionConfirmMail, confirmCodeMail, importConfirmMail } = await import('./mail')

describe('the verification-code letter', () => {
  const afterFirstRound = new Date('2026-10-27T10:00:00+02:00')
  const mail = confirmCodeMail('someone@example.com', '482913', afterFirstRound)

  it('puts the code on its own line, large in HTML', () => {
    expect(mail.subject).toBe('Код за потвърждение — Ти Броиш')
    expect(mail.text.split('\n')).toContain('482913')
    expect(mail.html).toMatch(/font-size:32px[^>]*>482913<\/p>/)
  })

  it('is for the runoff on 1 ноември and keeps the volunteer facts', () => {
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('балотажа на президентските избори на 1 ноември 2026 г.')
      expect(body).not.toContain('25 октомври')
      expect(body).toContain('доброволна дейност без заплащане')
      expect(body).toContain('Ще бъдеш представител на Инициативния комитет')
      expect(body).not.toContain('бъдете')
      expect(body).toContain('Кодът важи, докато не поискаш нов.')
      expect(body).toContain('Ако не си ти, просто игнорирай това писмо.')
    }
  })

  it('escapes the code in HTML', () => {
    expect(confirmCodeMail('a@example.com', '<b>', afterFirstRound).html).toContain('&lt;b&gt;')
  })
})

describe('the other volunteer letters', () => {
  it('use the same runoff and „ти“ copy', () => {
    const letters = [importConfirmMail('a@example.com', 'https://tibroish.bg/x'), companionConfirmMail('a@example.com', 'https://tibroish.bg/x')]
    for (const letter of letters) {
      expect(letter.text).not.toContain('бъдете')
      expect(letter.html).not.toContain('бъдете')
    }
  })
})
