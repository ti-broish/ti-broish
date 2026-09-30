import { describe, expect, it } from 'vitest'
import { cityRegionOutlines, placeOutline, travelOutline, type HomePlace } from './model'
import { campaignFromSearch, locationEditable, mirOf, needsWiderTravel, placeChangeAllowed, sofiaMir, validEgn } from './rules'

const mladost: HomePlace = {
  regionCode: 'sofia-merged',
  regionName: 'София-град',
  municipalityName: 'Столична',
  townName: 'гр. София',
  cityRegionCode: '15',
  cityRegionName: 'Младост',
}

describe('campaign source', () => {
  it('keeps a personal code separate from a partner source', () => {
    const params = new URLSearchParams('source=iaz.bg&ref=Ab3kLm')
    expect(campaignFromSearch(params)).toEqual({ source: 'iaz.bg', referredBy: 'Ab3kLm' })
  })

  it('treats a dotted ref as a source', () => {
    expect(campaignFromSearch(new URLSearchParams('ref=iaz.bg'))).toEqual({ source: 'iaz.bg', referredBy: null })
  })
})

describe('EGN', () => {
  it('accepts a real date and checksum', () => {
    expect(validEgn('0041010002')).toBe(true)
  })

  it('rejects a bad checksum and an impossible date', () => {
    expect(validEgn('0041010003')).toBe(false)
    expect(validEgn('0002300005')).toBe(false)
  })
})

describe('Sofia MIR', () => {
  it('keeps a district move inside one MIR and blocks a jump to another', () => {
    expect(sofiaMir('Младост')).toBe('23')
    expect(sofiaMir('Люлин')).toBe('25')
    const lyulin = { ...mladost, cityRegionCode: '11', cityRegionName: 'Люлин' }
    expect(placeChangeAllowed(mladost, { ...mladost, cityRegionName: 'Лозенец', cityRegionCode: '09' }, true)).toBe(true)
    expect(placeChangeAllowed(mladost, lyulin, true)).toBe(false)
    expect(mirOf(mladost)).toBe('23')
  })

  it('locks location edits only inside the election window after assignment', () => {
    expect(locationEditable(true, new Date('2026-10-19T12:00:00Z'))).toBe(false)
    expect(locationEditable(true, new Date('2026-11-05T12:00:00Z'))).toBe(false)
    expect(locationEditable(true, new Date('2026-10-18T12:00:00Z'))).toBe(true)
    expect(locationEditable(false, new Date('2026-10-20T12:00:00Z'))).toBe(true)
  })
})

describe('travel', () => {
  it('asks for a wider radius only when the chosen address has no paper section', () => {
    const machineOnly = { ...mladost, paperCount: 0, machineCount: 2 }
    expect(needsWiderTravel(machineOnly, 'cityRegion')).toBe(true)
    expect(needsWiderTravel(machineOnly, 'municipality')).toBe(false)
    expect(needsWiderTravel({ ...mladost, paperCount: 1, machineCount: 1 }, 'cityRegion')).toBe(false)
  })

  it('outlines the home district on the place step and the chosen nearby districts when traveling', () => {
    expect(placeOutline(mladost)[0]?.query).toContain('район Младост')
    expect(travelOutline({ place: mladost, radius: null, extraCityRegions: [], travelMunicipalities: [] })[0]?.query).toContain('район Младост')
    expect(travelOutline({ place: mladost, radius: 'cityRegion', extraCityRegions: [], travelMunicipalities: [] })[0]?.query).toContain('район Младост')
    const outlines = travelOutline({
      place: mladost,
      radius: 'nearby',
      extraCityRegions: [{ code: '09', name: 'Лозенец' }],
      travelMunicipalities: [],
    })
    expect(outlines.map((item) => item.query)).toEqual([
      expect.stringContaining('район Младост'),
      expect.stringContaining('район Лозенец'),
    ])
  })

  it('draws every city district and marks the chosen ones when the list is known', () => {
    const districts = [
      { code: '15', name: 'Младост' },
      { code: '09', name: 'Лозенец' },
      { code: '11', name: 'Люлин' },
    ]
    const onPlace = cityRegionOutlines(mladost, districts)
    expect(onPlace.map((item) => [item.id, item.selected])).toEqual([
      ['district:15', true],
      ['district:09', false],
      ['district:11', false],
    ])
    const nearby = travelOutline(
      {
        place: mladost,
        radius: 'nearby',
        extraCityRegions: [{ code: '09', name: 'Лозенец' }],
        travelMunicipalities: [],
      },
      districts,
    )
    expect(nearby.map((item) => [item.id, item.selected])).toEqual([
      ['district:15', true],
      ['district:09', true],
      ['district:11', false],
    ])
    const inside = travelOutline(
      { place: mladost, radius: 'cityRegion', extraCityRegions: [], travelMunicipalities: [] },
      districts,
    )
    expect(inside.filter((item) => item.selected).map((item) => item.id)).toEqual(['district:15'])
    const reversed = cityRegionOutlines(mladost, [...districts].reverse())
    expect(reversed.map((item) => [item.id, item.selected])).toEqual([
      ['district:15', true],
      ['district:11', false],
      ['district:09', false],
    ])
    const municipality = travelOutline(
      { place: mladost, radius: 'municipality', extraCityRegions: [], travelMunicipalities: [] },
      districts,
    )
    expect(municipality.map((item) => item.id)).toEqual(['municipality'])
  })
})
