import { describe, expect, it } from 'vitest'
import { describeMobilePlan, mobileAreas, mobileReaches, mobileTeams, planMobileTeams, type MobilePerson, type MobilePrioritySection } from './mobile-teams'
import { MOBILE_DRAFTS_GUARDS, MOBILE_DRAFTS_TABLE } from './mobile-teams-sql'

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

function prio(sectionCode: string, r: number | null, town = 'с.Село', municipality = 'Община'): MobilePrioritySection {
  return { sectionCode, r, level: r === null ? 'quarantine' : r > 4 ? 'elevated' : 'watch', town, municipality }
}

describe('mobileReaches', () => {
  it('keeps a settlement person in their town and МИР', () => {
    const p = person({ id: 'a', radius: 'settlement', hasCar: null, townName: 'с. Буново' })
    expect(mobileReaches(p, { sectionCode: '263400001', town: 'с.Буново' })).toBe(true)
    expect(mobileReaches(p, { sectionCode: '263400002', town: 'с.Друго' })).toBe(false)
    expect(mobileReaches(p, { sectionCode: '273400001', town: 'с.Буново' })).toBe(false)
  })

  it('without a car, a region radius shrinks to the home municipality', () => {
    const p = person({ id: 'a', hasCar: false })
    expect(mobileReaches(p, { sectionCode: '263400001', town: 'x' })).toBe(true)
    expect(mobileReaches(p, { sectionCode: '261000001', town: 'x' })).toBe(false)
  })

  it('with a car, a region radius covers the oblast, limited to the municipalities they listed', () => {
    const free = person({ id: 'a' })
    expect(mobileReaches(free, { sectionCode: '261000001', town: 'x' })).toBe(true)
    expect(mobileReaches(free, { sectionCode: '271000001', town: 'x' })).toBe(false)
    const listed = person({ id: 'b', travelStops: [{ regionCode: '26', code: '10' }] })
    expect(mobileReaches(listed, { sectionCode: '261000001', town: 'x' })).toBe(true)
    expect(mobileReaches(listed, { sectionCode: '262000001', town: 'x' })).toBe(false)
    expect(mobileReaches(listed, { sectionCode: '263400001', town: 'x' })).toBe(true)
  })

  it('distant adds the МИРs they picked; Sofia region covers МИР 23–25', () => {
    expect(mobileReaches(person({ id: 'a', radius: 'distant', distantMirs: ['27'] }), { sectionCode: '271000001', town: 'x' })).toBe(true)
    const sofia = person({ id: 'b', mir: '25', regionCode: 'sofia-merged', municipalityCode: '46' })
    expect(mobileReaches(sofia, { sectionCode: '234600001', town: 'гр.София' })).toBe(true)
    expect(mobileReaches(sofia, { sectionCode: '264600001', town: 'x' })).toBe(false)
  })

  it('never reaches abroad', () => {
    expect(mobileReaches(person({ id: 'a' }), { sectionCode: '320100001', town: 'x' })).toBe(false)
  })
})

describe('planMobileTeams', () => {
  const priority = [
    prio('261000001', 3.0, 'с.А'),
    prio('261000002', 2.0, 'с.Б'),
    prio('262000001', 4.5, 'с.В'),
    prio('262000002', 4.0, 'с.Г'),
    prio('262000003', null, 'с.Д'),
    prio('263400001', 1.0, 'гр.Хасково'),
  ]

  it('sends a team where the open high-R sections cluster, highest R first, up to 5 with a car', () => {
    const plan = planMobileTeams({ people: [person({ id: 'a' })], priority, unavailable: new Set() })
    expect(plan.drafts).toHaveLength(1)
    expect(plan.drafts[0].area.key).toBe('26:20')
    expect(plan.drafts[0].area.targets.map((target) => target.code)).toEqual(['262000001', '262000002', '262000003'])
  })

  it('skips covered and reserved sections and never gives one section to two teams', () => {
    const plan = planMobileTeams({
      people: [person({ id: 'a' }), person({ id: 'b' })],
      priority,
      unavailable: new Set(['262000001', '262000002']),
    })
    const all = plan.drafts.flatMap((draft) => draft.area.targets.map((target) => target.code))
    expect(all).not.toContain('262000001')
    expect(new Set(all).size).toBe(all.length)
    expect(new Set(plan.drafts.map((draft) => draft.area.key)).size).toBe(2)
  })

  it('without a car takes at most 3 targets', () => {
    const many = Array.from({ length: 6 }, (_, index) => prio(`26340000${index + 1}`, 3 - index * 0.1))
    const plan = planMobileTeams({ people: [person({ id: 'a', hasCar: false })], priority: many, unavailable: new Set() })
    expect(plan.drafts[0].area.targets).toHaveLength(3)
  })

  it('keeps a group that listed each other together on one area', () => {
    const a = person({ id: 'a', companions: [{ email: 'b@example.com', inGroup: true, samePlace: true }] })
    const b = person({ id: 'b', hasCar: false })
    expect(mobileTeams([a, b])).toHaveLength(1)
    const plan = planMobileTeams({ people: [a, b], priority, unavailable: new Set() })
    expect(plan.drafts.map((draft) => draft.personId).sort()).toEqual(['a', 'b'])
    expect(new Set(plan.drafts.map((draft) => draft.area.key)).size).toBe(1)
    // b has no car, so the shared area is in the home municipality.
    expect(plan.drafts[0].area.key).toBe('26:34')
  })

  it('serves the person with the fewest options first, so the flexible one goes elsewhere', () => {
    const tight = person({ id: 'z-tight', hasCar: false, municipalityCode: '20' })
    const loose = person({ id: 'a-loose' })
    const plan = planMobileTeams({ people: [loose, tight], priority, unavailable: new Set() })
    const byId = new Map(plan.drafts.map((draft) => [draft.personId, draft.area.key]))
    expect(byId.get('z-tight')).toBe('26:20')
    expect(byId.get('a-loose')).toBe('26:10')
  })

  it('spreads teams: a МИР that already has a team counts for less', () => {
    const areas = mobileAreas([person({ id: 'a', radius: 'distant', distantMirs: ['27'] })], [prio('261000001', 3.0), prio('271000001', 2.0)], new Map([['26', 2]]))
    expect(areas[0].mir).toBe('27')
  })

  it('reports who cannot be placed and why', () => {
    const plan = planMobileTeams({
      people: [
        person({ id: 'abroad', mir: '32', regionCode: '32' }),
        person({ id: 'nodays', roundsFirst: false, roundsRunoff: false }),
        person({ id: 'noplace', mir: '', regionCode: '', radius: 'settlement', townName: '' }),
        person({ id: 'far', mir: '01', regionCode: '01', municipalityCode: '01' }),
      ],
      priority,
      unavailable: new Set(),
    })
    expect(plan.drafts).toEqual([])
    expect(Object.fromEntries(plan.skipped.map((row) => [row.personId, row.reason]))).toEqual({
      abroad: 'abroad',
      nodays: 'no-days',
      noplace: 'no-place',
      far: 'no-priority-in-reach',
    })
    expect(describeMobilePlan(plan)).toContain('Без чернова: 1 без непокрита приоритетна секция в обхвата')
  })
})

type Db = { exec(sql: string): void; prepare(sql: string): { run(...args: unknown[]): unknown } }
async function openDb(): Promise<Db | null> {
  try {
    const mod = (await import(/* @vite-ignore */ 'node:sqlite')) as { DatabaseSync: new (path: string) => Db }
    return new mod.DatabaseSync(':memory:')
  } catch {
    return null
  }
}
const sqlite = await openDb()

describe.skipIf(!sqlite)('mobile_drafts guard (SQLite, as D1)', () => {
  it('refuses a reserved section as a mobile target, on insert and on update', () => {
    const db = sqlite!
    db.exec('CREATE TABLE taken_sections (section_code TEXT PRIMARY KEY, mir_code TEXT, place TEXT, organisation TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL)')
    db.exec(MOBILE_DRAFTS_TABLE)
    for (const sql of MOBILE_DRAFTS_GUARDS) db.exec(sql)
    db.prepare("INSERT INTO taken_sections (section_code, organisation, created_at) VALUES ('262000001', 'ГЕРБ', 'now')").run()
    const insert = (targets: string) =>
      db
        .prepare("INSERT INTO mobile_drafts (signup_id, team_key, mir_code, municipality_code, area_key, area_label, targets, created_at, updated_at) VALUES ('a', 'a', '26', '20', '26:20', 'x', ?, 'now', 'now')")
        .run(targets)
    expect(() => insert('[{"code":"262000001","r":4,"level":"watch","town":""}]')).toThrow(/reserved_section/)
    insert('[{"code":"262000002","r":4,"level":"watch","town":""}]')
    expect(() => db.prepare("UPDATE mobile_drafts SET targets = '[{\"code\":\"262000001\"}]' WHERE signup_id = 'a'").run()).toThrow(/reserved_section/)
  })
})
