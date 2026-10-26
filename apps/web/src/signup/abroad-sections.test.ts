// Abroad section addresses come from GET /sections/abroad of the API, cached, and an API failure
// never turns into blank addresses in Brevo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({ env: {} }))
vi.mock('@tanstack/react-start/server', () => ({ getCookie: () => '', getRequestUrl: () => new URL('https://tibroish.bg/'), setCookie: () => undefined }))

const TROMSO = {
  id: '320902332',
  code: '332',
  place: 'Тромсьо',
  address: 'Kvaløyvegen 332, 9016 Tromsø',
  town: { id: 100320, name: 'Тромсьо' },
  country: { code: '090', name: 'Норвегия' },
}
const CANBERRA = {
  id: '320010003',
  code: '003',
  place: 'Посолство',
  address: '26 Brisbane Ave., Barton, Canberra ACT 2600',
  town: { id: 100001, name: 'Канбера' },
  country: { code: '001', name: 'Австралия' },
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

// The module keeps its cache and last good copy per isolate: a fresh copy per test.
async function fresh() {
  vi.resetModules()
  return await import('./abroad-sections')
}

afterEach(() => vi.unstubAllGlobals())

describe('parseAbroadSections', () => {
  it('maps the API list by code with a label, country and address', async () => {
    const { parseAbroadSections } = await fresh()
    const parsed = parseAbroadSections([TROMSO, CANBERRA, { id: '234615001', place: 'x' }], 1)
    expect(Object.keys(parsed.sections).sort()).toEqual(['320010003', '320902332'])
    expect(parsed.sections['320902332']).toEqual({
      id: '320902332',
      place: 'Тромсьо',
      town: 'Тромсьо',
      country: 'Норвегия',
      address: 'Kvaløyvegen 332, 9016 Tromsø',
      label: 'Тромсьо',
    })
    expect(parsed.sections['320010003'].label).toBe('Канбера (Посолство)')
  })

  it('keeps a missing address blank and refuses an empty or broken answer', async () => {
    const { parseAbroadSections } = await fresh()
    expect(parseAbroadSections([{ ...TROMSO, address: null }]).sections['320902332'].address).toBe('')
    expect(() => parseAbroadSections([])).toThrow()
    expect(() => parseAbroadSections({ message: 'Unauthorized' })).toThrow()
  })
})

describe('loadAbroadSections', () => {
  it('fetches /sections/abroad from the API once and serves the copy while fresh', async () => {
    const { loadAbroadSections } = await fresh()
    const fetcher = vi.fn(async () => ok([TROMSO]))
    const now = Date.now()
    const first = await loadAbroadSections({ fetcher, now })
    const second = await loadAbroadSections({ fetcher, now: now + 5 * 60_000 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://api.tibroish.bg/sections/abroad')
    expect(second).toBe(first)
    expect(first.sections['320902332'].address).toBe('Kvaløyvegen 332, 9016 Tromsø')
  })

  it('picks up an address change after the copy goes stale', async () => {
    const { loadAbroadSections } = await fresh()
    const now = Date.now()
    await loadAbroadSections({ fetcher: async () => ok([{ ...TROMSO, address: 'Stakkevollvegen 1' }]), now })
    const pending: Promise<unknown>[] = []
    const waitUntil = (promise: Promise<unknown>) => void pending.push(promise)
    const fetcher = vi.fn(async () => ok([TROMSO]))
    // 11 minutes later the old copy is served while one refresh runs.
    const stale = await loadAbroadSections({ fetcher, waitUntil, now: now + 11 * 60_000 })
    expect(stale.sections['320902332'].address).toBe('Stakkevollvegen 1')
    await Promise.all(pending)
    const next = await loadAbroadSections({ fetcher, waitUntil, now: Date.now() })
    expect(next.sections['320902332'].address).toBe('Kvaløyvegen 332, 9016 Tromsø')
  })

  it('keeps the last good copy when the API fails, even past a day', async () => {
    const { loadAbroadSections } = await fresh()
    const now = Date.now()
    await loadAbroadSections({ fetcher: async () => ok([TROMSO]), now })
    const down = vi.fn(async () => new Response('Bad gateway', { status: 502 }))
    const later = await loadAbroadSections({ fetcher: down, now: now + 3 * 24 * 60 * 60_000 })
    expect(down).toHaveBeenCalled()
    expect(later.sections['320902332'].address).toBe('Kvaløyvegen 332, 9016 Tromsø')
  })

  it('throws without any copy; the OrNull variant gives null', async () => {
    const { loadAbroadSections, loadAbroadSectionsOrNull } = await fresh()
    const down = async () => {
      throw new Error('network down')
    }
    await expect(loadAbroadSections({ fetcher: down, now: Date.now() })).rejects.toThrow('network down')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await loadAbroadSectionsOrNull({ fetcher: down, now: Date.now() })).toBeNull()
  })
})

describe('abroadLocation with the API section', () => {
  it('keeps the abroad list label and falls back to the API label and country', async () => {
    const { abroadLocation } = await import('./brevo-location')
    expect(abroadLocation({ country: 'Германия', city: 'Дуисбург', placeLabel: 'Дуисбург' }, {}, { label: 'x', country: 'y' })).toBe('Дуисбург, Германия')
    expect(abroadLocation(undefined, { townName: 'Canberra' }, { label: 'Канбера (Посолство)', country: 'Австралия' })).toBe('Канбера (Посолство), Австралия')
    expect(abroadLocation(undefined, { townName: 'Canberra', countryName: 'Australia' })).toBe('Canberra, Australia')
  })
})

describe('lookupSectionPlaces for abroad sections', () => {
  it('takes abroad sections from one /sections/abroad call', async () => {
    vi.resetModules()
    const fetchMock = vi.fn(async (url: string) => (String(url).endsWith('/sections/abroad') ? ok([TROMSO, CANBERRA]) : ok([])))
    vi.stubGlobal('fetch', fetchMock)
    const { lookupSectionPlaces } = await import('./section-places-lookup')
    const places = await lookupSectionPlaces(['320902332', '32 001 00 03'])
    expect(places['320902332']).toEqual({ address: 'Kvaløyvegen 332, 9016 Tromsø', area: 'Норвегия', town: 'Тромсьо' })
    expect(places['320010003']).toEqual({ address: '26 Brisbane Ave., Barton, Canberra ACT 2600', area: 'Австралия', town: 'Канбера (Посолство)' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.tibroish.bg/sections/abroad')
  })
})

// A fake D1 for the Brevo section loaders: one abroad volunteer.
function fakeDb() {
  const person = {
    id: 'signup-1',
    email: 'volunteer@example.com',
    first_name: 'Иван',
    middle_name: '',
    last_name: 'Иванов',
    phone: '+359888000000',
    mir: '32',
    role: 'Член',
    published_section: '320902332',
    town_id: null,
    town_name: 'Тромсьо',
    country_name: 'Норвегия',
    submitted: 1,
    withdrawn: 0,
    email_confirmed: 1,
  }
  const statement = (sql: string) => {
    const s = {
      bind: () => s,
      first: async () => (/COUNT\(\*\)/.test(sql) ? { n: 1 } : null),
      all: async () => {
        if (/FROM signups/.test(sql) && !/designation_pdf_url/.test(sql)) return { results: [person] }
        return { results: [] }
      },
      run: async () => ({ meta: { changes: 0 } }),
    }
    return s
  }
  return { prepare: statement, batch: async () => [] } as never
}

describe('Brevo section fields when the API is down', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('the Секции sync stops with a message instead of sending a blank address', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    const { loadBrevoSectionFields } = await import('./admin')
    const result = await loadBrevoSectionFields(fakeDb(), { view: 'all', mir: '', q: '', publishedOnly: true })
    expect(result).toEqual({ error: expect.stringMatching(/чужбина/) })
  })

  it('the Секции sync sends the API address when the API is up', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/sections/abroad') ? ok([TROMSO]) : ok([]))))
    const { loadBrevoSectionFields } = await import('./admin')
    const result = await loadBrevoSectionFields(fakeDb(), { view: 'all', mir: '', q: '', publishedOnly: true })
    if ('error' in result) throw new Error(result.error)
    expect(result[0]).toMatchObject({ publishedSection: '320902332', sectionAddress: 'Kvaløyvegen 332, 9016 Tromsø', sectionPlace: 'Тромсьо, Норвегия' })
  })

  it('the пълномощно update leaves SECTION_ADDRESS out instead of blanking it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    const { loadBrevoSectionFieldsForIds } = await import('./admin')
    const { designationSectionAttributes } = await import('./designation-brevo')
    const fields = (await loadBrevoSectionFieldsForIds(fakeDb(), ['signup-1'])).get('signup-1')
    expect(fields?.sectionAddress).toBe('')
    const account = ['SECTION_ADDRESS', 'SECTION_PLACE', 'SECTION_ID', 'MIR'].map((name) => ({ name, type: 'text' }))
    const attributes = designationSectionAttributes(fields!, account as never)
    expect(attributes).not.toHaveProperty('SECTION_ADDRESS')
    expect(attributes.SECTION_PLACE).toBe('Тромсьо, Норвегия')
  })
})
