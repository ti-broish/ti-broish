import { describe, expect, it } from 'vitest'
import { FIXTURES } from './results-fixtures'
import {
  aggregateData,
  crumbHref,
  evideoUrl,
  formatCount,
  formatDateTime,
  initialMode,
  regionData,
  showOfficialStreaming,
  sortRows,
  unitTitle,
  validUnitPath,
  type ResultsUnit,
} from './results'

const index = FIXTURES.index as ResultsUnit
const municipality = FIXTURES['0306'] as ResultsUnit

describe('results units', () => {
  it('takes the unit codes the API has pages for', () => {
    for (const unit of ['03', '0306', '32001', '244601', '244601001']) expect(validUnitPath(unit)).toBe(true)
    for (const unit of ['3', '030', '0306001', 'index', 'meta', '03a', '']) expect(validUnitPath(unit)).toBe(false)
  })

  it('titles units like the results site', () => {
    expect(unitTitle({ type: 'electionRegion', id: '03', name: 'Варна' })).toBe('03. Варна')
    expect(unitTitle({ type: 'municipality', id: '06', name: 'Варна' })).toBe('Община Варна')
    expect(unitTitle({ type: 'district', id: '01', name: 'Средец' })).toBe('Район Средец')
    expect(crumbHref('')).toBe('/')
    expect(crumbHref('24')).toBe('/24')
  })

  it('sums stats for towns and addresses, which come without them', () => {
    const town = aggregateData(municipality.nodes![0]!)
    expect(town.stats.voters).toBe(501 + 502)
    expect(town.stats.violationsCount).toBe(1)
    expect(town.nodes?.[0]?.stats?.highRisk).toBe(1)
  })

  it('colours the map by signals and says so in the tooltip', () => {
    const data = regionData(index.nodes!, 'violations', 'risk')
    expect(data['16'].color).toBe('rgb(255,0,0)')
    expect(data['03'].color).toBe('rgb(239,238,95)')
    expect(data['03'].rows.map((row) => row.label)).toEqual(['Общ брой сигнали', 'Обработени сигнали', 'Публикувани сигнали'])
    expect(regionData(index.nodes!, 'sectionsWithResults', 'risk')['03'].rows[1]).toEqual({ label: 'Високорискови секции', value: '1' })
  })

  it('sorts the table by the shown measure', () => {
    const rows = sortRows(index.nodes!.map((node) => aggregateData(node)), 'violations', 'risk')
    expect(rows.map((row) => row.node.segment)).toEqual(['16', '03'])
    expect(rows[0].tooltipField).toBe('Подадени сигнали')
    expect(sortRows(index.nodes!.map((node) => aggregateData(node)), 'voters', 'risk')[0].node.segment).toBe('03')
  })

  it('starts on signals once there are any', () => {
    expect(initialMode(index.stats)).toBe('violations')
    expect(initialMode({ ...index.stats, violationsCount: 0 })).toBe('sectionsWithResults')
  })

  it('formats counts and times like the results site', () => {
    expect(formatCount(1234567)).toBe('1 234 567')
    expect(formatDateTime('2026-10-25T07:30:00.000Z')).toBe('09:30, 25-ти октомври 2026')
    expect(formatDateTime('2026-11-01T10:05:00.000Z')).toBe('12:05, 1-ви ноември 2026')
  })

  it('links the official stream and shows it from ten minutes before the polls close', () => {
    expect(evideoUrl('244601001')).toBe('https://evideo.bg/pvr2026/24.html#244601001')
    const meta = { endOfElectionDayTimestamp: '2026-10-25T20:00:00+02:00' }
    expect(showOfficialStreaming(meta, Date.parse('2026-10-25T19:45:00+02:00'))).toBe(false)
    expect(showOfficialStreaming(meta, Date.parse('2026-10-25T19:55:00+02:00'))).toBe(true)
    expect(showOfficialStreaming(null)).toBe(false)
  })
})
