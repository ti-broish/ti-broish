/**
 * Presidential election 2026 (ЦИК: pvr2026), Europe/Sofia calendar days.
 * The one place these dates live; the пълномощно config and the 18-years ЕГН rule read them from here.
 */
export const ELECTION_DAY = '2026-10-25'
export const RUNOFF_DAY = '2026-11-01'

const PROTOCOL_DAYS = [ELECTION_DAY, RUNOFF_DAY]

/** '2026-10-25' → '25.10.2026' */
export function bgDate(isoDay: string) {
  const [year, month, day] = isoDay.split('-')
  return `${day}.${month}.${year}`
}

export function isProtocolDay(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return PROTOCOL_DAYS.includes(day)
}
