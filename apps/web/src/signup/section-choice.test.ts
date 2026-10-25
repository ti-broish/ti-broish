import { describe, expect, it } from 'vitest'
import type { HomePlace } from './model'
import { placeWithAddress, placeWithSection, sectionChoices } from './section-choice'
import { placeSummaries } from './sections'

const sofia: HomePlace = {
  regionCode: 'sofia-merged',
  regionName: 'София',
  municipalityCode: '46',
  municipalityName: 'Столична',
  townId: 68134,
  townName: 'гр. София',
  cityRegionCode: '01',
  cityRegionName: 'Средец',
}

const sections = [
  { id: '244601003', place: '31 СУЧЕМ, ул. Example 1', votersCount: 500, isMachine: true },
  { id: '244601001', place: '31 СУЧЕМ, ул. Example 1', votersCount: 500, isMachine: true },
  { id: '244601002', place: '31 СУЧЕМ, ул. Example 1', votersCount: 200, isMachine: false },
  { id: '244601010', place: 'Читалище, ул. Other 2', votersCount: 200, isMachine: false },
]
const [school, hall] = placeSummaries(sections)

describe('placeWithAddress', () => {
  it('sets the section when the address has only one', () => {
    expect(placeWithAddress(sofia, hall, true)).toMatchObject({ sectionId: '244601010', sectionPlace: hall?.place, paperCount: 1, machineCount: 0 })
  })

  it('leaves the section to pick when the address has several', () => {
    expect(placeWithAddress({ ...sofia, sectionId: '244601010' }, school, true)).toMatchObject({ sectionId: undefined, sectionPlace: school?.place })
  })

  it('clears the section when the address is cleared', () => {
    expect(placeWithAddress({ ...sofia, sectionId: '244601010', sectionPlace: hall?.place }, undefined, true)).toMatchObject({
      sectionId: undefined,
      sectionPlace: undefined,
      paperCount: null,
      machineCount: null,
    })
  })

  it('never sets a section for the signup address preference', () => {
    expect(placeWithAddress(sofia, hall, false).sectionId).toBeUndefined()
  })
})

describe('sectionChoices', () => {
  it('lists the sections at the address by number', () => {
    expect(sectionChoices(school)).toEqual([
      { id: '244601001', label: '001 (244601001)' },
      { id: '244601002', label: '002 (244601002)' },
      { id: '244601003', label: '003 (244601003)' },
    ])
  })

  it('has nothing to choose for one section or no address', () => {
    expect(sectionChoices(hall)).toEqual([])
    expect(sectionChoices(undefined)).toEqual([])
  })
})

describe('placeWithSection', () => {
  it('sets a section at the chosen address', () => {
    expect(placeWithSection(sofia, school, '244601002').sectionId).toBe('244601002')
  })

  it('ignores a section from another address or an empty choice', () => {
    expect(placeWithSection(sofia, school, '244601010').sectionId).toBeUndefined()
    expect(placeWithSection(sofia, school, '').sectionId).toBeUndefined()
  })
})
