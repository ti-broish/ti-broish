import { describe, expect, it } from 'vitest'
import { FIXTURES } from './results-fixtures'
import { electionLabel, withElectionLabel, type ResultsUnit } from './results'

describe('electionLabel', () => {
  it('shows the election with its year, not the first round’s date', () => {
    expect(electionLabel('Президентски избори 25.10.2026')).toBe('Президентски избори 2026')
    expect(electionLabel('Президентски избори 25.10.2026 г.')).toBe('Президентски избори 2026')
    expect(electionLabel('Президентски избори 2026')).toBe('Президентски избори 2026')
    expect(electionLabel('Варна')).toBe('Варна')
  })

  it('renames the country unit and the election crumb only', () => {
    const index = withElectionLabel(FIXTURES.index as ResultsUnit)
    expect(index.name).toBe('Президентски избори 2026')
    const municipality = withElectionLabel(FIXTURES['0306'] as ResultsUnit)
    expect(municipality.name).toBe((FIXTURES['0306'] as ResultsUnit).name)
    expect(municipality.crumbs?.[0]?.name).toBe('Президентски избори 2026')
    expect(municipality.crumbs?.slice(1)).toEqual((FIXTURES['0306'] as ResultsUnit).crumbs?.slice(1))
  })
})
