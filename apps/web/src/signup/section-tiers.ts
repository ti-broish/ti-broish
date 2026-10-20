import { LAST_TURNOUT } from './last-turnout.data'

/**
 * Draft order for sections (after the priority list):
 *   1. paper,   more than 50 voted last time
 *   2. machine, more than 50 voted
 *   3. paper,   50 or fewer voted, by registered voters (desc)
 *   4. machine, 50 or fewer voted, by registered voters (desc)
 * A section with no last-election data (new since April) goes last within its type:
 * paper after tier 3, machine after tier 4.
 * Paper or machine is the current election's desk (sectionDesk on today's API voter counts), not April's.
 * Tiers 2 and 4 cover every machine section, not only the ones on the priority list.
 */
export const VOTED_THRESHOLD = 50

export interface Turnout {
  voted: number
  registered: number
}

export type TierDesk = 'paper' | 'machine' | 'unknown'

export interface SectionTier {
  tier: 1 | 2 | 3 | 4 | null
  /** 0 best. 0..5: t1, t2, t3, paper without data, t4, machine without data. */
  rank: number
  /** Second key inside the tier, larger first: voted for tiers 1–2, registered for 3–4. */
  weight: number
}

let parsed: Map<string, Turnout> | null = null

export function lastTurnout(): ReadonlyMap<string, Turnout> {
  if (parsed) return parsed
  parsed = parseTurnout(LAST_TURNOUT)
  return parsed
}

export function parseTurnout(raw: string) {
  const map = new Map<string, Turnout>()
  for (const entry of raw.split(';')) {
    const [code, voted, registered] = entry.split(',')
    if (!code || !/^\d{9}$/.test(code)) continue
    map.set(code, { voted: Number(voted) || 0, registered: Number(registered) || 0 })
  }
  return map
}

/** Unknown desk (no current voter count) is ranked with paper: it is drafted like paper. */
export function sectionTier(desk: TierDesk, turnout: Turnout | null | undefined): SectionTier {
  const machine = desk === 'machine'
  if (!turnout) return { tier: null, rank: machine ? 5 : 3, weight: 0 }
  if (turnout.voted > VOTED_THRESHOLD) return machine ? { tier: 2, rank: 1, weight: turnout.voted } : { tier: 1, rank: 0, weight: turnout.voted }
  return machine ? { tier: 4, rank: 4, weight: turnout.registered } : { tier: 3, rank: 2, weight: turnout.registered }
}

export function tierLabel(tier: SectionTier) {
  if (tier.tier === 1) return 'хартиена, гласували > 50'
  if (tier.tier === 2) return 'машинна, гласували > 50'
  if (tier.tier === 3) return 'хартиена, гласували ≤ 50'
  if (tier.tier === 4) return 'машинна, гласували ≤ 50'
  return tier.rank === 5 ? 'машинна, нова' : 'хартиена, нова'
}
