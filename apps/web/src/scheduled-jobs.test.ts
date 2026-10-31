import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RIK_SYNC_INTERVAL_MINUTES } from './signup/rik/config'
import { HOURLY_CRON, PRODUCTION_CRONS, RIK_QUARTER_CRON, scheduledJobs } from './scheduled-jobs'

describe('scheduled jobs', () => {
  it('reads the РИК on every trigger and runs the published pipeline only hourly', () => {
    expect(scheduledJobs(HOURLY_CRON)).toEqual({ rik: true, published: true })
    expect(scheduledJobs(RIK_QUARTER_CRON)).toEqual({ rik: true, published: false })
  })

  it('the production triggers in wrangler.jsonc are the ones the handler knows', () => {
    const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    const lists = [...config.matchAll(/"crons":\s*(\[[^\]]*\])/g)].map((match) => JSON.parse(match[1]!) as string[])
    expect(lists).toContainEqual([...PRODUCTION_CRONS])
  })

  it('together the triggers fire every RIK_SYNC_INTERVAL_MINUTES, at :07 and three more quarters', () => {
    const minutes = PRODUCTION_CRONS.flatMap((cron) => cron.split(' ')[0]!.split(',').map(Number)).sort((a, b) => a - b)
    expect(minutes).toEqual([7, 22, 37, 52])
    const gaps = minutes.map((minute, i) => (minutes[(i + 1) % minutes.length]! - minute + 60) % 60)
    expect(gaps.every((gap) => gap === RIK_SYNC_INTERVAL_MINUTES)).toBe(true)
  })
})
