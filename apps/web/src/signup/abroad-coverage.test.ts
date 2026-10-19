import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  compareAbroadSections,
  isAbroadSectionCode,
  parsePrioritySectionsCsv,
  summarizeCoverage,
  tierLetterOf,
  TIER_RANK,
} from './abroad-coverage'

const fixture = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/abroad-priority-sample.csv'), 'utf8')

describe('tierLetterOf / TIER_RANK', () => {
  it('reads the leading letter and ranks C before A', () => {
    expect(tierLetterOf('A_da_member')).toBe('A')
    expect(tierLetterOf('c_no_ppdb_seat')).toBe('C')
    expect(tierLetterOf('x_unknown')).toBeNull()
    expect(TIER_RANK.C).toBeLessThan(TIER_RANK.D)
    expect(TIER_RANK.D).toBeLessThan(TIER_RANK.B)
    expect(TIER_RANK.B).toBeLessThan(TIER_RANK.A)
  })
})

describe('isAbroadSectionCode', () => {
  it('accepts 32######## after stripping spaces', () => {
    expect(isAbroadSectionCode('320021001')).toBe(true)
    expect(isAbroadSectionCode('32 0021 001')).toBe(true)
    expect(isAbroadSectionCode('234600101')).toBe(false)
    expect(isAbroadSectionCode('32002100')).toBe(false)
  })
})

describe('parsePrioritySectionsCsv', () => {
  it('imports the sample fixture across A/B/C/D and two countries', () => {
    const parsed = parsePrioritySectionsCsv(fixture)
    expect(parsed.errors).toEqual([])
    expect(parsed.imported).toBe(6)
    expect(parsed.rejected).toBe(0)
    expect(parsed.rows.map((row) => row.tierLetter).sort().join('')).toBe('ABBCCD')
    expect(new Set(parsed.rows.map((row) => row.country))).toEqual(new Set(['Австрия', 'Германия']))
    expect(parsed.rows[0]).toMatchObject({
      sectionCode: '320021001',
      city: 'Виена',
      members: 9,
      ppdbSeats: 3,
      daSeats: 2,
      tierLetter: 'A',
    })
  })

  it('accepts Bulgarian header aliases and rejects bad rows', () => {
    const text = [
      'секция,държава,град,място,членове,ниво,ppdb_seats,da_seats,ppdb_seats_without_nominee,party_seats_allocated_in_file',
      '320021001,Австрия,Виена,Виена,1,A_ok,1,0,0,1',
      '234600101,Австрия,Виена,Виена,1,A_ok,1,0,0,1',
      '320021002,Австрия,Виена,Виена,1,Z_bad,1,0,0,1',
    ].join('\n')
    const parsed = parsePrioritySectionsCsv(text)
    expect(parsed.imported).toBe(1)
    expect(parsed.rejected).toBe(2)
    expect(parsed.errors).toHaveLength(2)
    expect(parsed.rows[0]?.sectionCode).toBe('320021001')
  })
})

describe('summarizeCoverage / compareAbroadSections', () => {
  it('counts by tier and country and sorts C before A', () => {
    const { rows } = parsePrioritySectionsCsv(fixture)
    const summary = summarizeCoverage(rows)
    expect(summary.total).toBe(6)
    expect(summary.byTier).toEqual({ A: 1, B: 2, C: 2, D: 1 })
    expect(summary.byCountry).toEqual([
      { country: 'Австрия', count: 3 },
      { country: 'Германия', count: 3 },
    ])

    const sorted = [...rows].sort(compareAbroadSections)
    expect(sorted.map((row) => row.tierLetter)).toEqual(['C', 'C', 'D', 'B', 'B', 'A'])
  })
})
