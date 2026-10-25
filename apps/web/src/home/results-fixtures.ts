// Fixed results for the e2e dev server only (VITE_RESULTS_FIXTURES=1 in playwright.config.ts), so the specs do not
// depend on what api.tibroish.bg has on the day. Never loaded by a production build.
import type { ElectionMeta, ResultsUnit, UnitStats } from './results'

const stats = (patch: Partial<UnitStats>): UnitStats => ({
  voters: 0,
  sectionsWithResults: 0,
  validVotes: 0,
  invalidVotes: 0,
  violationsCount: 0,
  sectionsCount: 0,
  processedViolations: 0,
  publishedViolations: 0,
  streamsCount: 0,
  highRisk: 0,
  midRisk: 0,
  populated: 0,
  ...patch,
})

const ELECTION = { segment: '', name: 'Президентски избори 25.10.2026', type: 'election' }
const VARNA = { segment: '03', name: 'Варна', type: 'electionRegion' }
const MUNICIPALITY = { segment: '0306', name: 'Варна', type: 'municipality' }

const section = (n: number, risk = 'low', violations = 0) => ({
  id: String(n).padStart(3, '0'),
  segment: `030600${String(n).padStart(3, '0')}`,
  name: `Секция ${String(n).padStart(3, '0')}`,
  type: 'section',
  stats: stats({ voters: 500 + n, sectionsCount: 1, violationsCount: violations, highRisk: risk === 'high' ? 1 : 0, midRisk: risk === 'mid' ? 1 : 0 }),
})

export const FIXTURES: Record<string, ResultsUnit | ElectionMeta> = {
  meta: { name: 'Президентски избори 25.10.2026', endOfElectionDayTimestamp: '2026-10-25T20:00:00+02:00', parties: [] },
  index: {
    id: null,
    segment: '',
    name: 'Президентски избори 25.10.2026',
    type: 'election',
    nodesType: 'electionRegions',
    results: [],
    crumbs: [],
    stats: stats({ voters: 3000, sectionsCount: 3, violationsCount: 3, publishedViolations: 3, highRisk: 1 }),
    nodes: [
      { id: '03', segment: '03', name: 'Варна', type: 'electionRegion', stats: stats({ voters: 2000, sectionsCount: 2, violationsCount: 1, highRisk: 1 }) },
      { id: '16', segment: '16', name: 'Пловдив град', type: 'electionRegion', stats: stats({ voters: 1000, sectionsCount: 1, violationsCount: 2 }) },
    ],
  },
  '03': {
    id: '03',
    segment: '03',
    name: 'Варна',
    type: 'electionRegion',
    nodesType: 'municipalities',
    results: [],
    crumbs: [ELECTION],
    stats: stats({ voters: 2000, sectionsCount: 2, violationsCount: 1, highRisk: 1 }),
    nodes: [{ id: '06', segment: '0306', name: 'Варна', type: 'municipality', stats: stats({ voters: 2000, sectionsCount: 2, violationsCount: 1, highRisk: 1 }) }],
  },
  '0306': {
    id: '06',
    segment: '0306',
    name: 'Варна',
    type: 'municipality',
    nodesType: 'towns',
    results: [],
    crumbs: [ELECTION, VARNA],
    stats: stats({ voters: 2000, sectionsCount: 2, violationsCount: 1, highRisk: 1 }),
    nodes: [
      {
        id: 10135,
        segment: null,
        name: 'гр.Варна',
        type: 'town',
        nodes: [{ id: null, segment: null, name: 'ОУ „Христо Ботев“', type: 'address', nodes: [section(1, 'high', 1), section(2)] }],
      },
    ],
  },
  '030600001': {
    id: '001',
    segment: '030600001',
    name: 'Секция 001',
    type: 'section',
    results: [],
    riskLevel: 'high',
    crumbs: [ELECTION, VARNA, MUNICIPALITY],
    abroad: false,
    place: 'ОУ „Христо Ботев“',
    town: { id: 10135, name: 'гр.Варна' },
    protocols: [],
    stats: stats({ voters: 501, sectionsCount: 1, violationsCount: 1, highRisk: 1 }),
  },
}
