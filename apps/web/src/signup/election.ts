const PROTOCOL_DAYS = ['2026-10-25', '2026-11-01']

export function isProtocolDay(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return PROTOCOL_DAYS.includes(day)
}
