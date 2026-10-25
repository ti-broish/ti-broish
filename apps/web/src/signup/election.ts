/**
 * Presidential election 2026 (ЦИК: pvr2026), Europe/Sofia calendar days.
 * The one place these dates live; the пълномощно config and the 18-years ЕГН rule read them from here.
 */
export const ELECTION_DAY = '2026-10-25'
export const RUNOFF_DAY = '2026-11-01'

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

/**
 * Protocols are sent from when the polls close (20:00 Sofia, UTC+2 after the clock change on 25.10)
 * until 12:00 the next day, so sections that finish counting after midnight can still send.
 */
const PROTOCOL_WINDOWS = [
  { day: ELECTION_DAY, opens: '2026-10-25T20:00:00+02:00', closes: '2026-10-26T12:00:00+02:00' },
  { day: RUNOFF_DAY, opens: '2026-11-01T20:00:00+02:00', closes: '2026-11-02T12:00:00+02:00' },
]

/**
 * The windows above. `endOfElectionDay` is the API's /results/meta.json `endOfElectionDayTimestamp`:
 * when it falls on one of these election days, it moves that day's opening time. Anything else is ignored.
 */
export function protocolWindows(endOfElectionDay?: string | null): ProtocolWindow[] {
  const end = endOfElectionDay ? new Date(endOfElectionDay) : null
  const endValid = end && !Number.isNaN(end.getTime())
  return PROTOCOL_WINDOWS.map((window) => {
    const closes = new Date(window.closes)
    const fromMeta = endValid && sofiaDay(end) === window.day && end < closes
    return { day: window.day, opens: fromMeta ? end : new Date(window.opens), closes }
  })
}

/** True while protocols can be sent: from the polls closing until 12:00 Sofia the next day. */
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
