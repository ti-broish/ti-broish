const CAMPAIGN_NAME_MAX = 120

/** "2026-10-18 15:46" in Europe/Sofia, whatever the Worker's clock zone is. */
export function sofiaStamp(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`
}

/** Campaign name in Brevo: Sofia time plus the subject, so drafts are easy to tell apart. */
export function brevoCampaignName(subject: string, date: Date) {
  const name = `Ти Броиш ${sofiaStamp(date)} · ${subject.trim()}`
  return name.length > CAMPAIGN_NAME_MAX ? `${name.slice(0, CAMPAIGN_NAME_MAX - 1)}…` : name
}

export function brevoCampaignUrl(campaignId: number) {
  return `https://app.brevo.com/marketing-campaign/edit/${campaignId}`
}
