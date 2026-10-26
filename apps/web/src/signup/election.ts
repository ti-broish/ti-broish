/**
 * Presidential election 2026 (ЦИК: pvr2026), Europe/Sofia calendar days.
 * The one place these dates live; the пълномощно config and the 18-years ЕГН rule read them from here.
 */
export const ELECTION_DAY = '2026-10-25'
export const RUNOFF_DAY = '2026-11-01' // confirmed (Harry, 26.10.2026)

/**
 * The first round is over from the day after ELECTION_DAY (Sofia calendar). From then on a signup is for
 * the runoff only: the „25 октомври“ day is not offered and the copy names RUNOFF_DAY alone.
 */
export function firstRoundPassed(now = new Date()) {
  return sofiaDay(now) > ELECTION_DAY
}

const BG_MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември']

/** '2026-11-01' → '1 ноември' */
export function bgDayMonth(isoDay: string) {
  const [, month, day] = isoDay.split('-')
  return `${Number(day)} ${BG_MONTHS[Number(month) - 1]}`
}

export const ELECTION_LABEL = bgDayMonth(ELECTION_DAY)
export const RUNOFF_LABEL = bgDayMonth(RUNOFF_DAY)

/** '2026-10-25' → '25.10.2026' */
export function bgDate(isoDay: string) {
  const [year, month, day] = isoDay.split('-')
  return `${day}.${month}.${year}`
}

/** The calendar day in Sofia, e.g. '2026-10-25'. */
export function sofiaDay(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export interface ProtocolWindow {
  day: string
  opens: Date
  closes: Date
}

/** Protocols can be sent until the end of this many days after election day (Sofia), e.g. 25.10 → 28.10 23:59:59. */
export const PROTOCOL_DAYS_AFTER = 3

/** '2026-10-25' + 3 → '2026-10-28' (calendar days, no time zone involved). */
export function addDays(isoDay: string, days: number) {
  const date = new Date(`${isoDay}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** The first instant of the Sofia calendar day after `isoDay`, i.e. right after 23:59:59 that day. */
export function endOfSofiaDay(isoDay: string) {
  const next = addDays(isoDay, 1)
  // Sofia is UTC+2 or UTC+3; take whichever midnight actually falls on `next` in Sofia.
  for (const offset of ['+02:00', '+03:00']) {
    const candidate = new Date(`${next}T00:00:00${offset}`)
    if (sofiaDay(candidate) === next && sofiaDay(new Date(candidate.getTime() - 1)) === isoDay) return candidate
  }
  return new Date(`${next}T00:00:00+02:00`)
}

/**
 * Protocols are sent from when the polls close (20:00 Sofia, UTC+2 after the clock change on 25.10)
 * until the end of the third day after election day (`daysAfter`), so late counts and re-sends still get in.
 */
const PROTOCOL_WINDOWS = [
  { day: ELECTION_DAY, opens: '2026-10-25T20:00:00+02:00', daysAfter: PROTOCOL_DAYS_AFTER },
  { day: RUNOFF_DAY, opens: '2026-11-01T20:00:00+02:00', daysAfter: PROTOCOL_DAYS_AFTER },
]

/**
 * The windows above. `endOfElectionDay` is the API's /results/meta.json `endOfElectionDayTimestamp`:
 * when it falls on one of these election days, it moves that day's opening time. Anything else is ignored.
 */
export function protocolWindows(endOfElectionDay?: string | null): ProtocolWindow[] {
  const end = endOfElectionDay ? new Date(endOfElectionDay) : null
  const endValid = end && !Number.isNaN(end.getTime())
  return PROTOCOL_WINDOWS.map((window) => {
    const closes = endOfSofiaDay(addDays(window.day, window.daysAfter))
    const fromMeta = endValid && sofiaDay(end) === window.day && end < closes
    return { day: window.day, opens: fromMeta ? end : new Date(window.opens), closes }
  })
}

/** True while protocols can be sent: from the polls closing until the end of the third day after election day. */
export function isProtocolOpen(now = new Date(), endOfElectionDay?: string | null) {
  return protocolWindows(endOfElectionDay).some((window) => now >= window.opens && now < window.closes)
}

/** The window that is open now, or the next one; null after the last one closed. */
export function currentOrNextProtocolWindow(now = new Date(), endOfElectionDay?: string | null) {
  return protocolWindows(endOfElectionDay).find((window) => now < window.closes) ?? null
}

/** '20:00 ч. на 25 октомври' for a window boundary, in Sofia time. */
export function bgDateTime(date: Date) {
  const time = new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  const day = new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long' }).format(date)
  return `${time} ч. на ${day}`
}

/** '28 октомври' for a window's last day (closes is the midnight right after it), in Sofia time. */
export function bgLastDay(closes: Date) {
  return new Intl.DateTimeFormat('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long' }).format(new Date(closes.getTime() - 1))
}
