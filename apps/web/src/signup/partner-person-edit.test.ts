import { describe, expect, it } from 'vitest'
import { cleanPartnerEdit, partnerEditSql, planPartnerEdit, type PartnerEditable } from './partner-person-edit'

// Synthetic data only.
const before: PartnerEditable = {
  firstName: 'Тест',
  middleName: '',
  lastName: 'Тестов',
  email: 'test@example.test',
  phone: '0888000000',
  region: 'София',
  municipality: 'Столична',
  placeNote: '',
}

describe('„И аз“ person edit', () => {
  it('only the changed fields, email lower-cased and phone normalised', () => {
    const plan = planPartnerEdit(before, cleanPartnerEdit({ ...before, email: ' New@Example.TEST ', phone: '+359 888 111 222', placeNote: '  кв.   Лозенец ' }))
    expect(plan).toMatchObject({ ok: true, namesChanged: false })
    if (!plan.ok) return
    expect(plan.changes.map((change) => [change.column, change.after])).toEqual([
      ['email', 'new@example.test'],
      ['phone', '0888111222'],
      ['place_note', 'кв. Лозенец'],
    ])
    expect(partnerEditSql(plan.changes)).toBe('UPDATE partner_people SET email = ?3, phone = ?4, place_note = ?5, updated_at = ?1 WHERE id = ?2')
  })

  it('no change is a no-op', () => {
    expect(planPartnerEdit(before, cleanPartnerEdit(before))).toEqual({ ok: true, changes: [], namesChanged: false })
  })

  it('names flag the rename transition', () => {
    const plan = planPartnerEdit(before, cleanPartnerEdit({ ...before, middleName: 'Петров' }))
    expect(plan).toMatchObject({ ok: true, namesChanged: true, changes: [{ column: 'middle_name', before: '', after: 'Петров' }] })
  })

  it('refuses missing names, a bad email or phone; an empty phone is fine', () => {
    expect(planPartnerEdit(before, cleanPartnerEdit({ ...before, lastName: ' ' }))).toMatchObject({ ok: false })
    expect(planPartnerEdit(before, cleanPartnerEdit({ ...before, email: 'nope' }))).toMatchObject({ ok: false })
    expect(planPartnerEdit(before, cleanPartnerEdit({ ...before, phone: '12' }))).toMatchObject({ ok: false })
    expect(planPartnerEdit(before, cleanPartnerEdit({ ...before, phone: '' }))).toMatchObject({ ok: true })
  })

  it('clips long input', () => {
    expect(cleanPartnerEdit({ firstName: 'а'.repeat(200) }).firstName).toHaveLength(80)
  })
})
