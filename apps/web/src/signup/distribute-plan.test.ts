import { describe, expect, it } from 'vitest'
import { planCountryDistribution } from './distribute-plan'

type Row = Record<string, unknown>

function fakeDb(tables: { signups: Row[]; taken?: string[]; priority?: Row[] }) {
  const pick = (sql: string): Row[] => {
    if (sql.includes('FROM taken_sections')) return (tables.taken ?? []).map((section_code) => ({ section_code }))
    if (sql.includes('FROM priority_sections')) return tables.priority ?? []
    if (sql.includes('FROM companions')) return []
    if (sql.includes('payload')) return tables.signups
    return tables.signups.filter((row) => row.draft_section || row.published_section)
  }
  const statement = (sql: string) => ({
    bind: () => statement(sql),
    all: async () => ({ results: pick(sql) }),
    first: async () => pick(sql)[0] ?? null,
    run: async () => {
      throw new Error('planning must not write')
    },
  })
  return { prepare: (sql: string) => statement(sql) } as never
}

function signup(id: string, patch: Row = {}): Row {
  return {
    id,
    email: `${id}@example.com`,
    role: 'section',
    mir: '23',
    region_code: '23',
    city_region_code: '15',
    place: '',
    radius: 'cityRegion',
    extra_city_regions: '[]',
    distant_region_codes: '[]',
    travel_municipalities: '[]',
    draft_section: '',
    draft_locked: 0,
    published_section: '',
    payload: JSON.stringify({ place: { townId: 68134, municipalityCode: '46', cityRegionCode: '15' } }),
    ...patch,
  }
}

const sectionsApi = async (path: string) => {
  if (path.startsWith('sections?town=68134')) {
    return ['234615001', '234615002', '234615003', '234615004'].map((id) => ({ id, place: `Адрес ${id}`, town: { id: 68134 }, votersCount: 100 }))
  }
  return null
}

describe('planCountryDistribution', () => {
  it('with keepDrafts, leaves every draft alone, never reuses its section, and follows priority', async () => {
    const db = fakeDb({
      signups: [signup('drafted', { draft_section: '234615004' }), signup('empty'), signup('abroad', { mir: '32', region_code: '32' })],
      taken: ['234615003'],
      priority: [
        { section_code: '234615004', r: 0.9, level: 'elevated' },
        { section_code: '234615003', r: 0.8, level: 'elevated' },
        { section_code: '234615002', r: 0.1, level: 'watch' },
      ],
    })
    const planned = await planCountryDistribution(db, { keepDrafts: true, fetchJson: sectionsApi })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.assignments.map((row) => [row.personId, row.sectionId])).toEqual([['empty', '234615002']])
    expect(planned.plan.skipped.map((row) => [row.personId, row.reason])).toEqual([['abroad', 'abroad']])
  })

  it('without keepDrafts, an unlocked draft is recomputed as before', async () => {
    const db = fakeDb({ signups: [signup('drafted', { draft_section: '234615004' })] })
    const planned = await planCountryDistribution(db, { fetchJson: sectionsApi })
    expect(planned.ok && planned.plan.assignments.map((row) => row.personId)).toEqual(['drafted'])
  })

  it('loads every municipality of a travel oblast, not only towns where someone lives', async () => {
    const db = fakeDb({
      signups: [signup('far', { radius: 'distant', distant_region_codes: '["14"]', region_code: 'sofia-merged', city_region_code: '09' })],
    })
    const fetched: string[] = []
    const planned = await planCountryDistribution(db, {
      fetchJson: async (path: string) => {
        fetched.push(path)
        if (path === 'results/1432.json') {
          return { nodes: [{ id: 55871, type: 'town', nodes: [{ name: 'Перник', type: 'address', nodes: [{ segment: '143200001', type: 'section', stats: { voters: 200 } }] }] }] }
        }
        if (path.startsWith('sections?town=68134')) return [{ id: '234609001', place: 'Лозенец', town: { id: 68134 }, isMachine: true }]
        return null
      },
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(fetched).toContain('results/1432.json')
    expect(fetched.filter((path) => path === 'results/1432.json')).toHaveLength(1)
    expect(planned.sections.map((row) => row.id)).toContain('143200001')
    expect(planned.plan.assignments.map((row) => [row.personId, row.sectionId])).toEqual([['far', '143200001']])
  })
})
