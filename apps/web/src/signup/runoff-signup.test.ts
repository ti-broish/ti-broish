import { describe, expect, it } from 'vitest'
import { ELECTION_LABEL, RUNOFF_LABEL, bgDayMonth, firstRoundPassed } from './election'
import { ASSIGNMENT_WAVES, assignmentWavePassed, nextAssignment } from './model'

describe('signups for the runoff', () => {
  it('names the days in Bulgarian', () => {
    expect(bgDayMonth('2026-11-01')).toBe('1 ноември')
    expect(ELECTION_LABEL).toBe('25 октомври')
    expect(RUNOFF_LABEL).toBe('1 ноември')
  })

  it('treats the first round as over from the next Sofia day', () => {
    expect(firstRoundPassed(new Date('2026-10-25T20:59:00Z'))).toBe(false) // 23:59 Sofia, 25.10
    expect(firstRoundPassed(new Date('2026-10-25T22:00:00Z'))).toBe(true) // 00:00 Sofia, 26.10
  })

  it('does not name a past wave once every runoff wave is behind us', () => {
    const runoffOnly = { rounds: { first: false, runoff: true } }
    const onWaveDay = nextAssignment(runoffOnly, new Date('2026-10-26T09:00:00Z'))
    expect(onWaveDay?.label).toBe('26 октомври')
    expect(assignmentWavePassed(onWaveDay, new Date('2026-10-26T09:00:00Z'))).toBe(false)
    const later = new Date('2026-10-28T09:00:00Z')
    const wave = nextAssignment(runoffOnly, later)
    expect(assignmentWavePassed(wave, later)).toBe(true)
  })

  it('keeps the waves in date order', () => {
    const days = ASSIGNMENT_WAVES.map((wave) => wave.iso)
    expect([...days].sort()).toEqual(days)
  })
})
