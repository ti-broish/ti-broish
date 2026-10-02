import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyStaffEdit, buildAdminPerson, nextStaffCall, progressLabel, sealStaffProfile, signupProgress, staffGapText, staffWrite } from './admin-progress'
import { emptyProfile } from './model'

describe('signup progress', () => {
  it('separates a finished signup from one that only started', () => {
    expect(signupProgress({ submitted: true, withdrawn: false })).toBe('finished')
    expect(signupProgress({ submitted: false, withdrawn: false })).toBe('started')
    expect(signupProgress({ submitted: true, withdrawn: true })).toBe('withdrawn')
    expect(progressLabel('finished')).toBe('Завършил')
    expect(progressLabel('started')).toBe('Започнал')
  })

  it('describes the missing piece for the team', () => {
    expect(staffGapText(emptyProfile())).toBe('Липсват имена, имейл или телефон.')
    expect(staffGapText({ ...emptyProfile(), withdrawn: true, firstName: '', email: '', phone: '' })).toBe('Липсват имена, имейл или телефон.')
  })

  it('keeps an existing callback and clears it when the mark is removed', () => {
    expect(nextStaffCall({ at: '', by: '' }, true, 'ada@example.com', '2026-10-02T10:00:00.000Z')).toEqual({
      at: '2026-10-02T10:00:00.000Z',
      by: 'ada@example.com',
    })
    expect(nextStaffCall({ at: '2026-10-01T10:00:00.000Z', by: 'ada@example.com' }, true, 'other@example.com', '2026-10-02T10:00:00.000Z')).toEqual({
      at: '2026-10-01T10:00:00.000Z',
      by: 'ada@example.com',
    })
    expect(nextStaffCall({ at: '2026-10-01T10:00:00.000Z', by: 'ada@example.com' }, false, 'ada@example.com', '2026-10-02T10:00:00.000Z')).toEqual({
      at: '',
      by: '',
    })
  })

  it('writes the corrected details onto the profile', () => {
    const next = applyStaffEdit(emptyProfile(), {
      firstName: ' Иван ',
      middleName: 'Иванов',
      lastName: 'Иванов',
      phone: '0888000000',
      role: 'mobile',
      roundsFirst: true,
      roundsRunoff: false,
      experience: 'counted',
    })
    expect(next.firstName).toBe('Иван')
    expect(next.phone).toBe('0888000000')
    expect(next.role).toBe('mobile')
    expect(next.rounds).toEqual({ first: true, runoff: false })
    expect(next.experience).toBe('counted')
  })

  it('keeps the column flags and does not put the team note in the volunteer payload', () => {
    const sealed = sealStaffProfile(
      { ...emptyProfile(), firstName: 'Мария', email: 'old@example.com' },
      '{"firstName":"Мария","email":"old@example.com"}',
      {
        email: 'maria@example.com',
        submitted: true,
        withdrawn: false,
        emailConfirmed: true,
        notes: 'от колоната',
        role: 'section',
        experience: '',
        roundsFirst: null,
        roundsRunoff: null,
      },
    )
    expect(sealed.email).toBe('maria@example.com')
    expect(sealed.emailConfirmed).toBe(true)
    expect(sealed.submitted).toBe(true)
    expect(sealed.role).toBe('section')
    expect(sealed.notes).toBe('от колоната')
    const kept = sealStaffProfile(
      { ...emptyProfile(), role: 'mobile' },
      '{"role":"mobile"}',
      {
        email: 'a@b.c',
        submitted: false,
        withdrawn: false,
        emailConfirmed: false,
        notes: '',
        role: 'section',
        experience: '',
        roundsFirst: null,
        roundsRunoff: null,
      },
    )
    expect(kept.role).toBe('mobile')
    const write = staffWrite(
      { ...sealed, egn: '0041010002' },
      { at: '2026-10-02T10:00:00.000Z', by: 'ada@example.com' },
      'Ще дойде.',
    )
    const payload = JSON.parse(write.payload) as { email?: string; egn?: string; staffNote?: string }
    expect(payload.email).toBe('maria@example.com')
    expect(payload.egn).toBe('')
    expect(payload.staffNote).toBeUndefined()
    expect(write.staffNote).toBe('Ще дойде.')
    expect(write.staffCalledBy).toBe('ada@example.com')
    expect(write).not.toHaveProperty('email')
    const person = buildAdminPerson(sealed, {
      id: '1',
      town: 'гр. София',
      place: 'ул. Витоша 1',
      radius: '',
      imported: false,
      draftSection: '',
      publishedSection: '234600101',
      hasEgn: true,
      staffNote: 'Ще дойде.',
      staffCalledAt: '',
      staffCalledBy: '',
    })
    expect(person.hasEgn).toBe(true)
    expect(person.place).toBe('ул. Витоша 1')
    expect(person.gap).toBe('Липсват имена, имейл или телефон.')
  })

  it('leaves the team callback out of a volunteer save', () => {
    const source = readFileSync(new URL('./db.ts', import.meta.url), 'utf8')
    const start = source.indexOf('ON CONFLICT(email)')
    const conflict = source.slice(start, source.indexOf('`', start))
    expect(conflict).not.toMatch(/staff_note\s*=/)
    expect(conflict).not.toMatch(/staff_called_at\s*=/)
    expect(conflict).not.toMatch(/staff_called_by\s*=/)
  })
})