import { describe, expect, it } from 'vitest'
import { brevoCampaignName, brevoCampaignUrl, sofiaStamp } from './brevo-campaign'

describe('sofiaStamp', () => {
  it('uses Europe/Sofia summer time (UTC+3)', () => {
    expect(sofiaStamp(new Date('2026-10-18T12:46:00Z'))).toBe('2026-10-18 15:46')
  })

  it('uses Europe/Sofia winter time (UTC+2)', () => {
    expect(sofiaStamp(new Date('2026-11-29T23:30:00Z'))).toBe('2026-11-30 01:30')
  })
})

describe('brevoCampaignName', () => {
  it('has the Sofia time and the subject', () => {
    expect(brevoCampaignName(' ТЕСТ staging — не изпращай ', new Date('2026-10-18T12:46:00Z'))).toBe(
      'Ти Броиш 2026-10-18 15:46 · ТЕСТ staging — не изпращай',
    )
  })

  it('stays short for long subjects', () => {
    const name = brevoCampaignName('а'.repeat(300), new Date('2026-10-18T12:46:00Z'))
    expect(name.length).toBe(120)
    expect(name.endsWith('…')).toBe(true)
  })
})

describe('brevoCampaignUrl', () => {
  it('links to the campaign in Brevo', () => {
    expect(brevoCampaignUrl(103)).toBe('https://app.brevo.com/marketing-campaign/edit/103')
  })
})
