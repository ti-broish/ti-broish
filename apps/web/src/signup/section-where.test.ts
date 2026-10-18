import { describe, expect, it } from 'vitest'
import {
  addressTownIds,
  assembleDirectory,
  readSectionPlaces,
  readTownRefs,
  sectionPlaceOf,
  sectionSpot,
  signupSpot,
  splitSection,
} from './section-where'

describe('signup place in Bulgarian', () => {
  it('names the oblast, district and reach instead of the radius id', () => {
    const spot = signupSpot({
      region: '23',
      regionName: 'София-град',
      municipality: 'Столична',
      town: 'гр. София',
      cityRegion: 'Младост',
      place: 'ул. Витоша 1',
      radius: 'cityRegion',
    })
    expect(spot).toEqual({
      oblast: 'София-град',
      municipality: 'Столична',
      town: 'гр. София',
      district: 'Младост',
      address: 'ул. Витоша 1',
      reach: 'Само в Младост',
    })
    expect(JSON.stringify(spot)).not.toContain('cityRegion')
  })

  it('uses the oblast name when the stored region name is missing', () => {
    const spot = signupSpot({
      region: '14',
      municipality: 'Радомир',
      town: 'гр. Радомир',
      place: 'ул. Пример 2',
      radius: 'settlement',
    })
    expect(spot.oblast).toBe('Перник')
    expect(spot.reach).toBe('В гр. Радомир')
    expect(spot.reach).not.toContain('settlement')
  })

  it('says the municipality and the other oblasts the person accepted', () => {
    const municipality = signupSpot({
      region: '26',
      regionName: 'София',
      municipality: 'Елин Пелин',
      town: 'гр. Елин Пелин',
      radius: 'municipality',
    })
    expect(municipality.reach).toBe('В община Елин Пелин')

    const distant = signupSpot({
      region: '23',
      regionName: 'София-град',
      municipality: 'Столична',
      town: 'гр. София',
      cityRegion: 'Младост',
      radius: 'distant',
      distantRegionCodes: ['26'],
      travelMunicipalities: [{ regionCode: '26', regionName: 'София', code: '10', name: 'Горна Малина' }],
    })
    expect(distant.reach).toContain('И в други области')
    expect(distant.reach).toContain('София')
    expect(distant.reach).toContain('Горна Малина')
    expect(distant.reach).not.toContain('distant')
  })

  it('names a foreign city and country', () => {
    const spot = signupSpot({
      region: '32',
      regionName: 'Извън страната',
      countryName: 'Германия',
      town: 'Берлин',
      radius: 'region',
    })
    expect(spot.oblast).toBe('Германия')
    expect(spot.municipality).toBe('')
    expect(spot.reach).toBe('В Германия')
  })

  it('leaves the reach blank when the person has not chosen one', () => {
    expect(signupSpot({ region: '23', town: 'гр. София' }).reach).toBe('')
  })
})

describe('where a section id is', () => {
  const directory = assembleDirectory({
    regions: [
      { code: '16', name: 'Пловдив град', municipalities: [{ code: '22', name: 'Пловдив' }] },
      { code: '14', name: 'Перник', municipalities: [{ code: '36', name: 'Радомир' }] },
      { code: '23', name: 'София 23 МИР', municipalities: [{ code: '46', name: 'Столична' }] },
      { code: '26', name: 'София област', municipalities: [{ code: '10', name: 'Горна Малина' }, { code: '17', name: 'Елин Пелин' }] },
      { code: '04', name: 'Велико Търново', municipalities: [{ code: '28', name: 'Свищов' }] },
    ],
    towns: [
      { mir: '16', municipality: '22', cityRegions: [{ code: '06', name: 'Тракия' }, { code: '01', name: 'Централен' }] },
    ],
    sections: [{ id: '162206075', place: 'СУ Свети Седмочисленици ЖК Тракия, ул.Съединение № 81' }],
  })

  it('shows the address, oblast, municipality and district', () => {
    expect(sectionSpot('162206075', directory)).toEqual({
      address: 'СУ Свети Седмочисленици ЖК Тракия, ул.Съединение № 81',
      area: 'Пловдив град, община Пловдив, район Тракия',
    })
  })

  it('skips the district when the section has none', () => {
    expect(sectionSpot('143600022', directory).area).toBe('Перник, община Радомир')
    expect(sectionSpot('042800030', directory).area).toBe('Велико Търново, община Свищов')
    expect(sectionSpot('261700030', directory).area).toBe('София област, община Елин Пелин')
    expect(sectionSpot('261000008', directory).area).toBe('София област, община Горна Малина')
  })

  it('calls Sofia city one oblast, not the MIR title', () => {
    expect(sectionSpot('234600101', directory).area).toBe('София-град, община Столична')
  })

  it('still names the oblast when the directory is empty', () => {
    expect(sectionSpot('162206075', { regions: {}, municipalities: {}, districts: {}, addresses: {}, towns: {} }).area).toBe('Пловдив')
  })

  it('ignores a short code', () => {
    expect(splitSection('16')).toBeNull()
    expect(sectionSpot('16', directory)).toEqual({ address: '', area: '' })
  })

  it('names the settlement when the directory has a town', () => {
    const withTown = assembleDirectory({
      regions: [{ code: '23', name: 'София 23 МИР', municipalities: [{ code: '46', name: 'Столична' }] }],
      towns: [],
      sections: [{ id: '234602012', place: '19 СОУ Елиас Канети, ул.КАЗБЕК № 16', town: 'гр.София' }],
    })
    expect(sectionSpot('234602012', withTown)).toEqual({
      address: '19 СОУ Елиас Канети, ул.КАЗБЕК № 16',
      area: 'София-град, община Столична',
      town: 'гр.София',
    })
  })
})

describe('which town list can name the section', () => {
  const towns = [
    { mir: '16', municipality: '22', id: 56784, cityRegions: [{ code: '01', name: 'Централен' }, { code: '06', name: 'Тракия' }] },
    { mir: '14', municipality: '36', id: 100, cityRegions: [] },
    { mir: '14', municipality: '36', id: 101, cityRegions: [] },
    { mir: '23', municipality: '46', id: 68134, cityRegions: [{ code: '15', name: 'Младост' }, { code: '02', name: 'Красно село' }] },
    { mir: '23', municipality: '46', id: 49597, cityRegions: [{ code: '24', name: 'Банкя' }] },
  ]

  it('uses the person town, a lone town, or the one district that matches', () => {
    const ids = addressTownIds(['162206075', '143600022', '234615001'], [56784], towns, new Set())
    expect(ids).toContain(56784)
    expect(ids).not.toContain(100)
    expect(ids).not.toContain(101)
    expect(ids).toContain(68134)
    expect(ids).not.toContain(49597)
  })

  it('does not fetch a town whose address is already known', () => {
    expect(addressTownIds(['162206075'], [], towns, new Set(['162206075']))).toEqual([])
  })

  it('reads town districts and section addresses from the API shape', () => {
    expect(readTownRefs('16', '22', [{ id: 56784, name: 'гр. Пловдив', cityRegions: [{ code: '6', name: 'Тракия' }] }])).toEqual([
      { mir: '16', municipality: '22', id: 56784, cityRegions: [{ code: '06', name: 'Тракия' }] },
    ])
    expect(readSectionPlaces([{ id: 162206075, place: 'СУ Свети Седмочисленици' }, { id: 'nope', place: 'x' }])).toEqual([
      { id: '162206075', place: 'СУ Свети Седмочисленици' },
    ])
  })

  it('reads the settlement name from sections?town payload', () => {
    expect(
      readSectionPlaces([
        { id: '234602012', place: '19 СОУ Елиас Канети, ул.КАЗБЕК № 16', town: { id: 68134, name: 'гр.София' } },
        { id: '261000008', place: 'Читалище', town: { id: 1, name: 'с. Владая' } },
        { id: '143600022', place: 'Училище без град' },
      ]),
    ).toEqual([
      { id: '234602012', place: '19 СОУ Елиас Канети, ул.КАЗБЕК № 16', town: 'гр.София' },
      { id: '261000008', place: 'Читалище', town: 'с. Владая' },
      { id: '143600022', place: 'Училище без град' },
    ])
  })
})

describe('section place for Brevo', () => {
  it('prefers the settlement and falls back to the area', () => {
    expect(sectionPlaceOf({ town: 'гр.София', area: 'София-град, община Столична' })).toBe('гр.София')
    expect(sectionPlaceOf({ town: '  ', area: 'Перник, община Радомир' })).toBe('Перник, община Радомир')
    expect(sectionPlaceOf({ area: 'София област, община Елин Пелин' })).toBe('София област, община Елин Пелин')
  })
})
