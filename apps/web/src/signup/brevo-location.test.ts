import { describe, expect, it } from 'vitest'
import { abroadLocation, isAbroadSection } from './brevo-location'
import { searchTownIds } from './section-places-lookup'

describe('abroad LOCATION', () => {
  it('recognises abroad section codes', () => {
    expect(isAbroadSection('320922343')).toBe(true)
    expect(isAbroadSection('234615001')).toBe(false)
  })

  it('uses the section label and country from the abroad list', () => {
    expect(abroadLocation({ country: 'Обединено кралство Великобритания и Северна Ирландия', city: 'Лондон', placeLabel: 'Лондон (Фелтъм)' })).toBe(
      'Лондон (Фелтъм), Обединено кралство Великобритания и Северна Ирландия',
    )
    expect(abroadLocation({ country: 'Белгия', city: 'Гент', placeLabel: '' })).toBe('Гент, Белгия')
  })

  it('falls back to the town and country the person gave, and never invents', () => {
    expect(abroadLocation(undefined, { townName: 'Bournemouth', countryName: 'Обединено кралство' })).toBe('Bournemouth, Обединено кралство')
    expect(abroadLocation(undefined, {})).toBe('')
  })
})

describe('searchTownIds', () => {
  const towns = [
    { mir: '01', municipality: '03', id: 1, cityRegions: [] },
    { mir: '01', municipality: '03', id: 2, cityRegions: [] },
    { mir: '23', municipality: '46', id: 68134, cityRegions: [{ code: '23', name: 'Панчарево' }] },
    { mir: '23', municipality: '46', id: 500, cityRegions: [] },
  ]

  it('searches every untried town of the municipality for a section without an address', () => {
    expect(searchTownIds(['010300126'], towns, new Set(), new Set([1]))).toEqual([2])
  })

  it('tries the district towns first, then the rest of the municipality', () => {
    expect(searchTownIds(['234623032'], towns, new Set(), new Set())).toEqual([68134, 500])
  })

  it('skips found sections, abroad sections and respects the cap', () => {
    expect(searchTownIds(['010300126'], towns, new Set(['010300126']), new Set())).toEqual([])
    expect(searchTownIds(['320922343'], towns, new Set(), new Set())).toEqual([])
    expect(searchTownIds(['010300126'], towns, new Set(), new Set(), 1)).toEqual([1])
  })
})
