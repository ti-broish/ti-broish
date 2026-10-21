import { describe, expect, it } from 'vitest'
import { describeMobileRun, planMobileAreasFrom, WRITE_AUTO_MOBILE_DRAFT_SQL, DELETE_AUTO_MOBILE_DRAFT_SQL } from './mobile-auto'
import type { MobilePerson, MobilePrioritySection } from './mobile-teams'
import type { MobileDraftRow } from './mobile-teams-db'
import { MOBILE_DRAFTS_TABLE } from './mobile-teams-sql'

function person(patch: Partial<MobilePerson> & Pick<MobilePerson, 'id'>): MobilePerson {
  return {
    email: `${patch.id}@example.com`,
    mir: '26',
    regionCode: '26',
    radius: 'region',
    townName: 'гр.Хасково',
    municipalityCode: '34',
    cityRegionCode: '',
    extraCityRegionCodes: [],
    distantMirs: [],
    travelStops: [],
    hasCar: true,
    carSeats: 3,
    hasDrone: false,
    roundsFirst: true,
    roundsRunoff: true,
    companions: [],
    ...patch,
  }
}

const prio = (sectionCode: string, r: number | null): MobilePrioritySection => ({ sectionCode, r, level: r === null ? 'quarantine' : 'elevated', town: 'с.Село', municipality: 'Хасково' })

function draft(signupId: string, codes: string[], patch: Partial<MobileDraftRow> = {}): MobileDraftRow {
  return {
    signupId,
    teamKey: signupId,
    mir: codes[0]?.slice(0, 2) ?? '26',
    municipality: codes[0]?.slice(2, 4) ?? '34',
    areaKey: `${codes[0]?.slice(0, 2)}:${codes[0]?.slice(2, 4)}`,
    areaLabel: 'МИР 26 · община Хасково',
    targets: codes.map((code) => ({ code, r: 4, level: 'elevated', town: 'с.Село' })),
    source: 'auto',
    updatedAt: '',
    ...patch,
  }
}

const priority = ['263400001', '263400002', '263400003', '263400004', '263400005', '263400006', '263400007'].map((code, i) => prio(code, 5 - i / 10))

describe('planMobileAreasFrom', () => {
  it('gives an area of uncovered priority sections, never a section with a section person or a reserved one', () => {
    const planned = planMobileAreasFrom({ people: [person({ id: 'm', pinnedMir: '26' })], drafts: [], priority, held: new Set(['263400001']), reserved: new Set(['263400002']) })
    expect(planned.plan.drafts).toHaveLength(1)
    expect(planned.plan.drafts[0].area.targets.map((target) => target.code)).toEqual(['263400003', '263400004', '263400005', '263400006', '263400007'])
  })

  it('keeps a valid automatic draft (a rerun does not churn) and plans only the people without one', () => {
    const drafts = [draft('a', ['263400001', '263400002'])]
    const people = [person({ id: 'a' }), person({ id: 'b' })]
    const planned = planMobileAreasFrom({ people, drafts, priority, held: new Set(), reserved: new Set() })
    expect(planned.kept.map((row) => row.signupId)).toEqual(['a'])
    expect(planned.stale).toEqual([])
    expect(planned.plan.drafts.map((row) => row.personId)).toEqual(['b'])
    expect(planned.plan.drafts[0].area.targets.map((target) => target.code)).not.toContain('263400001')
  })

  it('replans an automatic draft whose target now has a section person, or that sits outside the МИР of the section', () => {
    const drafts = [draft('a', ['263400001', '263400002']), draft('b', ['273400001'])]
    const people = [person({ id: 'a' }), person({ id: 'b', pinnedMir: '26' })]
    const planned = planMobileAreasFrom({ people, drafts, priority, held: new Set(['263400001']), reserved: new Set() })
    expect(planned.stale.sort()).toEqual(['a', 'b'])
    expect(planned.plan.drafts.map((row) => row.personId).sort()).toEqual(['a', 'b'])
    expect(planned.plan.drafts.flatMap((row) => row.area.targets.map((target) => target.code))).not.toContain('263400001')
  })

  it('never touches a manual draft and never reuses its targets', () => {
    const drafts = [draft('a', ['263400001'], { source: 'manual' })]
    const planned = planMobileAreasFrom({ people: [person({ id: 'a' }), person({ id: 'b' })], drafts, priority, held: new Set(['263400001']), reserved: new Set() })
    expect(planned.kept.map((row) => row.signupId)).toEqual(['a'])
    expect(planned.stale).toEqual([])
    expect(planned.plan.drafts.map((row) => row.personId)).toEqual(['b'])
  })

  it('drops the automatic draft of someone withdrawn (not in the people list) and frees its targets', () => {
    const drafts = [draft('gone', ['263400001'])]
    const planned = planMobileAreasFrom({ people: [person({ id: 'b' })], drafts, priority, held: new Set(), reserved: new Set() })
    expect(planned.stale).toEqual(['gone'])
    expect(planned.plan.drafts[0].area.targets.map((target) => target.code)).toContain('263400001')
  })

  it('with keepAll, every existing draft stays', () => {
    const drafts = [draft('a', ['263400001'])]
    const planned = planMobileAreasFrom({ people: [person({ id: 'a' })], drafts, priority, held: new Set(['263400001']), reserved: new Set(), keepAll: true })
    expect(planned.kept).toHaveLength(1)
    expect(planned.stale).toEqual([])
    expect(planned.plan.drafts).toEqual([])
  })

  it('a whole-РИК person whose old area was one municipality gets the whole МИР', () => {
    const drafts = [draft('w', ['263400001'])]
    const planned = planMobileAreasFrom({ people: [person({ id: 'w', wholeMir: true, hasCar: null })], drafts, priority, held: new Set(), reserved: new Set() })
    expect(planned.stale).toEqual(['w'])
    expect(planned.plan.drafts[0].area.key).toBe('26')
  })
})

describe('describeMobileRun', () => {
  it('says how many mobile people got a section, an area, and how many were left without', () => {
    const planned = planMobileAreasFrom({
      people: [person({ id: 'a' }), person({ id: 'far', mir: '01', regionCode: '01', municipalityCode: '01' })],
      drafts: [],
      priority,
      held: new Set(),
      reserved: new Set(),
    })
    const text = describeMobileRun({ sectionDrafts: 2, noSection: 0, planned, written: { drafted: 1, removed: 0 } })
    expect(text).toContain('Мобилни екипи: 2 чернови за секция, 0 без свободна секция; 1 с район за обикаляне (5 приоритетни секции), 1 без район.')
    expect(text).toContain('1 без непокрита приоритетна секция в обхвата')
    expect(describeMobileRun({ planned, written: { drafted: 0, removed: 0 }, dryRun: true })).toMatch(/^Мобилни екипи: 1 с район/)
  })
})

type Db = { exec: (sql: string) => void; prepare: (sql: string) => { run: (...args: unknown[]) => { changes: number | bigint }; all: (...args: unknown[]) => unknown[] } }
async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}
const sqlite = await openDb()

describe.skipIf(!sqlite)('automatic mobile drafts in SQLite', () => {
  it('writes only for active mobile people and never overwrites or deletes a manual draft', () => {
    const db = sqlite!
    db.exec(`CREATE TABLE signups (id TEXT PRIMARY KEY, role TEXT, payload TEXT, submitted INTEGER, withdrawn INTEGER)`)
    db.exec(MOBILE_DRAFTS_TABLE)
    db.exec(`INSERT INTO signups VALUES ('m', 'mobile', '{}', 1, 0), ('s', 'section', '{}', 1, 0), ('w', 'mobile', '{}', 1, 1), ('k', 'mobile', '{}', 1, 0)`)
    db.exec(`INSERT INTO mobile_drafts (signup_id, team_key, mir_code, municipality_code, area_key, area_label, targets, source, created_at, updated_at) VALUES ('k', 'k', '26', '34', '26:34', 'ръчен', '[]', 'manual', 'x', 'x')`)
    const write = (id: string) => Number(db.prepare(WRITE_AUTO_MOBILE_DRAFT_SQL).run('t', '26', '34', '26:34', 'МИР 26', '[]', 'admin', 'now', 'now', id).changes)
    expect(write('m')).toBe(1)
    expect(write('s')).toBe(0)
    expect(write('w')).toBe(0)
    expect(write('k')).toBe(0)
    expect(Number(db.prepare(DELETE_AUTO_MOBILE_DRAFT_SQL).run('k').changes)).toBe(0)
    expect(Number(db.prepare(DELETE_AUTO_MOBILE_DRAFT_SQL).run('m').changes)).toBe(1)
    expect(db.prepare(`SELECT signup_id, source, area_label FROM mobile_drafts`).all()).toEqual([{ signup_id: 'k', source: 'manual', area_label: 'ръчен' }])
  })
})
