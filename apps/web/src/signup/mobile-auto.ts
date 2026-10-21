import type { SignupD1 } from './db-core'
import { planMobileTeams, type MobileArea, type MobileDraft, type MobilePerson, type MobilePlan, type MobileSkipReason } from './mobile-teams'
import { loadMobileContext, loadMobilePeople, type MobileDraftRow } from './mobile-teams-db'

/**
 * Mobile-team areas for „Направи чернови за страната“ (and „Чернови за мобилни екипи“). Runs after
 * the section drafts are written, so a target is never a section that already has a section person.
 *
 * - Manual mobile drafts („Запази“ on the person page) always stay.
 * - An automatic draft stays as long as it is still valid: the person is still an active mobile
 *   volunteer, every target is still uncovered and not reserved, the area is in the МИР of the
 *   person's section, and a whole-РИК person has a whole-МИР area. Otherwise it is planned again.
 *   So a rerun does not churn drafts.
 * - With keepAll (the „only people with nothing“ mode) every existing draft stays.
 * Drafts only: no published section, numbering, mail or Brevo.
 */
type Database = Pick<SignupD1, 'prepare'>

export interface MobileAutoPlan {
  people: MobilePerson[]
  kept: MobileDraftRow[]
  /** Automatic drafts to drop: stale, or of someone no longer an active mobile volunteer. */
  stale: string[]
  plan: MobilePlan
}

export async function planMobileAreasForRun(db: Database, options: { keepAll?: boolean } = {}): Promise<MobileAutoPlan> {
  const people = await loadMobilePeople(db)
  const context = await loadMobileContext(db)
  return planMobileAreasFrom({ people, drafts: context.drafts, priority: context.priority, held: await heldSections(db), reserved: context.reserved, keepAll: options.keepAll })
}

/** Pure part of planMobileAreasForRun, for tests and the dry run. */
export function planMobileAreasFrom(input: {
  people: MobilePerson[]
  drafts: MobileDraftRow[]
  priority: Parameters<typeof planMobileTeams>[0]['priority']
  /** Sections with a section person (draft or published, not withdrawn). */
  held: ReadonlySet<string>
  /** taken_sections: reserved by other organisations. */
  reserved: ReadonlySet<string>
  keepAll?: boolean
}): MobileAutoPlan {
  const byId = new Map(input.people.map((person) => [person.id, person]))
  const blocked = new Set([...input.held, ...input.reserved])
  const staleTeams = new Set<string>()
  const used = new Set<string>()
  const stale = new Set<string>()
  // Manual first so their targets win over an automatic draft that overlaps them.
  const ordered = [...input.drafts].sort((a, b) => Number(a.source !== 'manual') - Number(b.source !== 'manual') || a.signupId.localeCompare(b.signupId))
  for (const draft of ordered) {
    const person = byId.get(draft.signupId)
    if (!person) {
      // Withdrawn, not submitted or no longer mobile: an automatic draft goes; a manual one is left for a person to remove.
      if (draft.source !== 'manual') stale.add(draft.signupId)
      continue
    }
    if (draft.source === 'manual' || input.keepAll) {
      for (const target of draft.targets) used.add(target.code)
      continue
    }
    if (!autoDraftValid(draft, person, blocked, used)) staleTeams.add(draft.teamKey)
    else for (const target of draft.targets) used.add(target.code)
  }
  const kept: MobileDraftRow[] = []
  used.clear()
  const teamsPerMir = new Map<string, number>()
  const seenTeams = new Set<string>()
  for (const draft of ordered) {
    if (!byId.has(draft.signupId) || stale.has(draft.signupId)) continue
    if (draft.source !== 'manual' && staleTeams.has(draft.teamKey)) {
      stale.add(draft.signupId)
      continue
    }
    kept.push(draft)
    for (const target of draft.targets) used.add(target.code)
    if (!seenTeams.has(draft.teamKey)) {
      seenTeams.add(draft.teamKey)
      teamsPerMir.set(draft.mir, (teamsPerMir.get(draft.mir) ?? 0) + 1)
    }
  }
  const keptIds = new Set(kept.map((draft) => draft.signupId))
  const plan = planMobileTeams({
    people: input.people.filter((person) => !keptIds.has(person.id)),
    priority: input.priority,
    unavailable: new Set([...blocked, ...used]),
    teamsPerMir,
  })
  return { people: input.people, kept, stale: [...stale], plan }
}

function autoDraftValid(draft: MobileDraftRow, person: MobilePerson, blocked: ReadonlySet<string>, used: ReadonlySet<string>) {
  if (draft.targets.length === 0) return false
  const pinned = person.pinnedMir ?? ''
  if (pinned && draft.mir !== pinned) return false
  if (person.wholeMir && draft.areaKey !== draft.mir) return false
  return draft.targets.every((target) => !blocked.has(target.code) && !used.has(target.code))
}

async function heldSections(db: Database) {
  const held = new Set<string>()
  const rows = await db
    .prepare(
      `SELECT COALESCE(draft_section, '') AS draft_section, COALESCE(published_section, '') AS published_section FROM signups
       WHERE COALESCE(withdrawn, 0) = 0 AND (COALESCE(draft_section, '') != '' OR COALESCE(published_section, '') != '')`,
    )
    .all<{ draft_section: string; published_section: string }>()
  for (const row of rows.results ?? []) {
    if (row.draft_section) held.add(row.draft_section)
    if (row.published_section) held.add(row.published_section)
  }
  return held
}

/** Only ever an automatic row: a manual draft is never overwritten, and a withdrawn or non-mobile person never gets one. */
export const WRITE_AUTO_MOBILE_DRAFT_SQL = `INSERT INTO mobile_drafts (signup_id, team_key, mir_code, municipality_code, area_key, area_label, targets, source, created_by, created_at, updated_at)
  SELECT s.id, ?, ?, ?, ?, ?, ?, 'auto', ?, ?, ?
  FROM signups s
  WHERE s.id = ?
    AND COALESCE(s.submitted, 0) = 1
    AND COALESCE(s.withdrawn, 0) = 0
    AND (COALESCE(s.role, '') = 'mobile' OR json_extract(s.payload, '$.mobileTeam') = 1)
  ON CONFLICT(signup_id) DO UPDATE SET team_key = excluded.team_key, mir_code = excluded.mir_code,
    municipality_code = excluded.municipality_code, area_key = excluded.area_key, area_label = excluded.area_label,
    targets = excluded.targets, source = 'auto', created_by = excluded.created_by, updated_at = excluded.updated_at
  WHERE mobile_drafts.source != 'manual'`

export const DELETE_AUTO_MOBILE_DRAFT_SQL = `DELETE FROM mobile_drafts WHERE signup_id = ? AND source != 'manual'`

/** Write the plan: drop the stale automatic drafts, then save the new ones. Returns how many were written and removed. */
export async function writeMobileAreas(db: Database, planned: MobileAutoPlan, by: string, now: string) {
  let removed = 0
  for (const id of planned.stale) {
    const result = await db.prepare(DELETE_AUTO_MOBILE_DRAFT_SQL).bind(id).run().catch(() => null)
    if (result && changes(result)) removed += 1
  }
  let drafted = 0
  for (const draft of planned.plan.drafts) {
    if (await saveAutoDraft(db, draft, by, now)) drafted += 1
  }
  return { drafted, removed }
}

async function saveAutoDraft(db: Database, draft: MobileDraft, by: string, now: string) {
  const area: MobileArea = draft.area
  const result = await db
    .prepare(WRITE_AUTO_MOBILE_DRAFT_SQL)
    .bind(draft.teamKey, area.mir, area.municipality, area.key, area.label, JSON.stringify(area.targets), by, now, now, draft.personId)
    .run()
    .catch(() => null)
  return Boolean(result && changes(result))
}

function changes(result: unknown) {
  const value = (result as { meta?: { changes?: unknown } }).meta?.changes
  return typeof value === 'number' ? value > 0 : true
}

/**
 * „Мобилни екипи: …“ for the button's summary. sectionDrafts: mobile people who got a section
 * draft in this run; noSection: mobile people left without a free section in their reach.
 */
export function describeMobileRun(input: {
  /** Omit both when only areas were planned (the mobile panel's own button). */
  sectionDrafts?: number
  noSection?: number
  planned: MobileAutoPlan
  written: { drafted: number; removed: number }
  dryRun?: boolean
}) {
  const { planned } = input
  const fresh = input.dryRun ? planned.plan.drafts.length : input.written.drafted
  const withArea = planned.kept.length + fresh
  const targets = new Set([
    ...planned.kept.flatMap((draft) => draft.targets.map((target) => target.code)),
    ...planned.plan.drafts.flatMap((draft) => draft.area.targets.map((target) => target.code)),
  ]).size
  const count = (reason: MobileSkipReason) => planned.plan.skipped.filter((row) => row.reason === reason).length
  const noArea = planned.plan.skipped.length
  const sections = input.sectionDrafts === undefined ? '' : `${draftWord(input.sectionDrafts)} за секция, ${input.noSection ?? 0} без свободна секция; `
  const sentences = [`Мобилни екипи: ${sections}${withArea} с район за обикаляне (${targets} приоритетни секции), ${noArea} без район.`]
  const why = [
    count('no-priority-in-reach') ? `${count('no-priority-in-reach')} без непокрита приоритетна секция в обхвата` : '',
    count('no-place') ? `${count('no-place')} без МИР или населено място` : '',
    count('no-days') ? `${count('no-days')} без избран ден` : '',
    count('abroad') ? `${count('abroad')} извън страната` : '',
  ].filter(Boolean)
  if (why.length) sentences.push(`Без район: ${why.join(', ')}.`)
  if (fresh || planned.kept.length) sentences.push(`Нови райони: ${fresh}, запазени: ${planned.kept.length}.`)
  if (planned.stale.length) sentences.push(`Пренаредени или махнати стари райони: ${planned.stale.length}.`)
  return sentences.join(' ')
}

function draftWord(count: number) {
  return count === 1 ? '1 чернова' : `${count} чернови`
}

export type { MobileDraftRow }
