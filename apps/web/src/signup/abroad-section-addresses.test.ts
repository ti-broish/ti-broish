import { afterEach, describe, expect, it, vi } from 'vitest'
import { abroadSectionAddress, mfaAbroadSection } from './abroad-section-addresses'
import { MFA_ABROAD_SECTIONS } from './abroad-section-addresses.data'
import { abroadLocation } from './brevo-location'
import { lookupSectionPlaces } from './section-places-lookup'

describe('MFA abroad section addresses', () => {
  it('has a non-empty address, country and 32* code for every row', () => {
    const rows = Object.entries(MFA_ABROAD_SECTIONS)
    expect(rows.length).toBeGreaterThan(600)
    for (const [code, row] of rows) {
      expect(code).toMatch(/^32\d{7}$/)
      expect(row.address.trim()).not.toBe('')
      expect(row.country.trim()).not.toBe('')
      expect(row.country).not.toMatch(/секци/)
    }
  })

  it('returns the address of an abroad section', () => {
    expect(abroadSectionAddress('320922343')).toBe('The Green House Hotel, 4 Grove Road, Bournemouth, BH1 3A')
    expect(mfaAbroadSection('32 092 23 43')?.place).toBe('Борнмът')
  })

  it('returns nothing for domestic or unknown codes', () => {
    expect(abroadSectionAddress('234615001')).toBe('')
    expect(abroadSectionAddress('329999999')).toBe('')
    expect(abroadSectionAddress('')).toBe('')
  })

  it('LOCATION keeps the abroad list label and falls back to the MFA table', () => {
    expect(abroadLocation({ country: 'Германия', city: 'Дуисбург', placeLabel: 'Дуисбург' }, {}, '320271068')).toBe('Дуисбург, Германия')
    expect(abroadLocation(undefined, { townName: 'Bournemouth' }, '320922343')).toBe(
      'Борнмът, Обединено кралство Великобритания и Северна Ирландия',
    )
  })
})

describe('lookupSectionPlaces for abroad sections', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the MFA address without calling the API', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('no network')
    })
    vi.stubGlobal('fetch', fetchMock)
    const places = await lookupSectionPlaces(['320922343'])
    expect(places['320922343']).toEqual({
      address: 'The Green House Hotel, 4 Grove Road, Bournemouth, BH1 3A',
      area: 'Обединено кралство Великобритания и Северна Ирландия',
      town: 'Борнмът',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
