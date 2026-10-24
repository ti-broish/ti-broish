// Clearly fake signals for reviewing the home page before anything is published.
// Served only by /api/violations?demo=1 outside production (see violations.server.ts). Never real data.
import { REGION_CODES, regionName } from './regions'
import type { FeedItem } from './violations'

const TEXTS = [
  'Примерен сигнал: председателят на СИК не допуска застъпник в секцията.',
  'Примерен сигнал: агитационни материали на по-малко от 50 метра от входа.',
  'Примерен сигнал: машината не отпечатва контролна разписка от 30 минути.',
  'Примерен сигнал: избирател е снимал бюлетината си в кабината.',
  'Примерен сигнал: опашка от над час, секцията работи само с една кабина.',
  'Примерен сигнал: в секцията няма достъп за хора в инвалидна количка.',
]

// Busier regions get more samples so the map shows a spread of colours.
const WEIGHT: Record<string, number> = { '23': 7, '24': 6, '25': 5, '16': 5, '03': 4, '02': 4, '32': 3, '27': 3, '22': 2, '09': 2 }

export function demoItems(now = Date.now()): FeedItem[] {
  const items: FeedItem[] = []
  let n = 0
  for (const region of REGION_CODES) {
    const count = WEIGHT[region] ?? (Number(region) % 3 === 0 ? 0 : 1)
    for (let i = 0; i < count; i += 1) {
      const abroad = region === '32'
      const municipality = String((i % 3) + 1).padStart(2, '0')
      n += 1
      items.push({
        id: `DEMO${String(n).padStart(22, '0')}`,
        video: n % 7 === 0,
        text: TEXTS[n % TEXTS.length],
        createdAt: '',
        town: abroad ? 'Примерен град' : `Примерно място, ${regionName(region)}`,
        municipality: abroad ? null : `Примерна община ${municipality}`,
        country: abroad ? 'Примерна държава' : null,
        region,
        municipalityKey: abroad ? null : region + municipality,
        section: abroad ? null : `${region}${municipality}00${String(i + 1).padStart(3, '0')}`,
        demo: true,
      })
    }
  }
  // Interleave regions by time, newest first.
  items.sort((a, b) => ((Number(a.id.slice(4)) * 37) % 101) - ((Number(b.id.slice(4)) * 37) % 101))
  return items.map((item, index) => ({ ...item, createdAt: new Date(now - index * 6 * 60_000).toISOString() }))
}
