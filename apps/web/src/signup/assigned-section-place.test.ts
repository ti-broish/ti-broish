import { describe, expect, it, vi } from 'vitest'
import { assignedPlaceFromSpot, assignedSectionLine, assignedSectionQuery } from './assigned-section-place'

import { resolveAssignedSectionPlace } from './assigned-section-resolve'

// Someone in с. Мусачево picked section 261700019 at signup and was assigned 261700022 in с. Елешница.
const PREFERENCE = 'НАРОДНО ЧИТАЛИЩЕ "ОТЕЦ ПАИСИЙ", пл. "Възраждане"'
const directory = {
  '261700019': { address: 'НАРОДНО ЧИТАЛИЩЕ "ОТЕЦ ПАИСИЙ", пл."Възраждане"', area: 'София област, община Елин Пелин', town: 'с. Мусачево' },
  '261700022': { address: 'НАРОДНО ЧИТАЛИЩЕ "ЕЛИН ПЕЛИН 1929"', area: 'София област, община Елин Пелин', town: 'с. Елешница' },
}

describe('assigned section place', () => {
  it('takes the address and settlement of the assigned section, not the preference', async () => {
    const lookup = vi.fn(async (codes: string[]) => Object.fromEntries(codes.map((code) => [code, directory[code as keyof typeof directory]])))
    const place = await resolveAssignedSectionPlace('261700022', [49388], lookup)
    expect(lookup).toHaveBeenCalledWith(['261700022'], { '261700022': [49388] })
    expect(place).toEqual({ section: '261700022', address: 'НАРОДНО ЧИТАЛИЩЕ "ЕЛИН ПЕЛИН 1929"', settlement: 'с. Елешница' })
    expect(assignedSectionLine(place)).toBe('НАРОДНО ЧИТАЛИЩЕ "ЕЛИН ПЕЛИН 1929", с. Елешница')
    expect(assignedSectionLine(place)).not.toContain('ОТЕЦ ПАИСИЙ')
    expect(assignedSectionLine(place)).not.toContain(PREFERENCE)
    expect(assignedSectionQuery(place)).toBe('НАРОДНО ЧИТАЛИЩЕ "ЕЛИН ПЕЛИН 1929", с. Елешница, България')
  })

  it('gives nothing when the lookup fails or does not know the section', async () => {
    expect(await resolveAssignedSectionPlace('261700022', [], async () => ({}))).toBeNull()
    expect(
      await resolveAssignedSectionPlace('261700022', [], async () => {
        throw new Error('api down')
      }),
    ).toBeNull()
    expect(await resolveAssignedSectionPlace('2617', [], async () => directory)).toBeNull()
    expect(assignedSectionLine(null)).toBe('')
    expect(assignedSectionQuery(null)).toBeNull()
  })

  it('never shows the area fallback as a settlement', () => {
    expect(assignedPlaceFromSpot('111800077', { address: '', area: 'Ловеч, община Ловеч' })).toBeNull()
    expect(assignedPlaceFromSpot('111800077', { address: 'ул Никола Помов-комитата №2', area: 'Ловеч, община Ловеч' })).toEqual({
      section: '111800077',
      address: 'ул Никола Помов-комитата №2',
      settlement: '',
    })
  })

  it('does not repeat a settlement the address already names', () => {
    expect(assignedSectionLine({ section: '234600101', address: 'гр.София, ул. Пример 1', settlement: 'гр.София' })).toBe('гр.София, ул. Пример 1')
  })

  it('names the place and the country abroad', () => {
    const place = assignedPlaceFromSpot('320481190', {
      address: 'Calle León y Castillo Nº 270 - planta baja, 35005 Las Palmas de Gran Canaria',
      area: 'Испания',
      town: 'Лас Палмас де Гран Канария',
    })
    expect(place?.settlement).toBe('Лас Палмас де Гран Канария, Испания')
    expect(assignedSectionQuery(place)).toBe('Calle León y Castillo Nº 270 - planta baja, 35005 Las Palmas de Gran Canaria, Лас Палмас де Гран Канария, Испания')
  })
})
