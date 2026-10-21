import { describe, expect, it } from 'vitest'
import { cityRegionOutlines, placeOutline, travelOutline, type HomePlace } from './model'
import { ELECTION_DAY } from './election'
import { egnAgeProblem } from './record'
import {
  adultOnElectionDay,
  birthdayAt,
  campaignFromSearch,
  egnBirthDate,
  locationEditable,
  mirOf,
  needsWiderTravel,
  placeChangeAllowed,
  sofiaMir,
  UNDERAGE_MESSAGE,
  UNDERAGE_REASON,
  validEgn,
} from './rules'

/** A valid ЕГН for a birth date: month + 40 for the 2000s, + 20 for the 1800s. */
function egnFor(year: number, month: number, day: number, serial = 123) {
  const coded = year >= 2000 ? month + 40 : year < 1900 ? month + 20 : month
  const body = `${String(year % 100).padStart(2, '0')}${String(coded).padStart(2, '0')}${String(day).padStart(2, '0')}${String(serial).padStart(3, '0')}`
  const weights = [2, 4, 8, 5, 10, 9, 7, 3, 6]
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0) % 11
  return `${body}${sum === 10 ? 0 : sum}`
}

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

describe('ЕГН birth date and 18 years on election day', () => {
  it('reads the century from the month: +20 the 1800s, +40 the 2000s, otherwise the 1900s', () => {
    expect(egnBirthDate(egnFor(1985, 3, 14))).toBe('1985-03-14')
    expect(egnBirthDate(egnFor(2005, 7, 2))).toBe('2005-07-02')
    expect(egnFor(2005, 7, 2).slice(2, 4)).toBe('47')
    expect(egnBirthDate(egnFor(1899, 12, 31))).toBe('1899-12-31')
    expect(egnFor(1899, 12, 31).slice(2, 4)).toBe('32')
    expect(validEgn(egnFor(1899, 12, 31))).toBe(true)
  })

  it('rejects a date that does not exist', () => {
    expect(egnBirthDate('0002300005')).toBeNull()
    expect(egnBirthDate('0753000000')).toBeNull() // 2007-13-00
    expect(egnBirthDate('0742310000')).toBeNull() // 31 February 2007
    expect(egnBirthDate('0302290000')).toBeNull() // 29 February 1903, not a leap year
    expect(egnBirthDate('12345')).toBeNull()
    expect(adultOnElectionDay('0742310000')).toBe(false)
  })

  it('is the election day of pvr2026', () => {
    expect(ELECTION_DAY).toBe('2026-10-25')
    expect(UNDERAGE_MESSAGE).toBe('Трябва да навършиш 18 години до деня на изборите (25.10.2026 г.).')
    expect(UNDERAGE_REASON).toBe('не навършва 18 години до деня на изборите (25.10.2026 г.)')
  })

  it('lets in someone who turns 18 on election day and not the day after', () => {
    expect(adultOnElectionDay(egnFor(2008, 10, 25))).toBe(true)
    expect(adultOnElectionDay(egnFor(2008, 10, 24))).toBe(true)
    expect(adultOnElectionDay(egnFor(2008, 10, 26))).toBe(false)
    expect(adultOnElectionDay(egnFor(2010, 1, 1))).toBe(false)
    expect(adultOnElectionDay(egnFor(1950, 6, 15))).toBe(true)
    expect(adultOnElectionDay(egnFor(1899, 12, 31))).toBe(true)
  })

  it('takes the election day as a parameter for other elections', () => {
    expect(adultOnElectionDay(egnFor(2008, 10, 25), '2026-10-24')).toBe(false)
    expect(adultOnElectionDay(egnFor(2008, 10, 25), '2026-11-01')).toBe(true)
  })

  it('turns a 29 February birthday into 28 February in a common year, and keeps it in a leap year', () => {
    expect(egnBirthDate(egnFor(2008, 2, 29))).toBe('2008-02-29')
    expect(birthdayAt('2008-02-29', 18)).toBe('2026-02-28')
    expect(birthdayAt('2004-02-29', 20)).toBe('2024-02-29')
    expect(adultOnElectionDay(egnFor(2008, 2, 29), '2026-02-28')).toBe(true)
    expect(adultOnElectionDay(egnFor(2008, 2, 29), '2026-02-27')).toBe(false)
    expect(adultOnElectionDay(egnFor(2006, 2, 28), '2024-02-28')).toBe(true)
    expect(adultOnElectionDay(egnFor(2008, 2, 29))).toBe(true)
  })

  it('rejects a new or changed under-18 ЕГН on the server and keeps the one already saved', () => {
    const young = egnFor(2008, 10, 26)
    expect(egnAgeProblem(young, null)).toBe(UNDERAGE_MESSAGE)
    expect(egnAgeProblem(young, '')).toBe(UNDERAGE_MESSAGE)
    expect(egnAgeProblem(young, egnFor(2009, 1, 1))).toBe(UNDERAGE_MESSAGE)
    expect(egnAgeProblem(young, young)).toBeNull()
    expect(egnAgeProblem(egnFor(2008, 10, 25), null)).toBeNull()
    expect(egnAgeProblem('', egnFor(2009, 1, 1))).toBeNull()
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
