import { describe, expect, it } from 'vitest'
import { validateViolation } from './reports-validate'
import { apiErrorMessage, apiPhone, sendViolation, violationBody } from './violation-api'

const VIOLATIONS_API = 'https://api.tibroish.bg'

const place = {
  regionCode: '23',
  regionName: 'София-град',
  municipalityCode: '46',
  municipalityName: 'Столична',
  townId: 68134,
  townName: 'гр. София',
  sectionId: '234615001',
}

const jpeg = { contentType: 'image/jpeg', data: `/9j/${'A'.repeat(40)}` }

function valid(patch: Record<string, unknown> = {}) {
  const parsed = validateViolation({
    name: 'Иван Иванов',
    email: 'ivan@example.com',
    phone: '0888 123 456',
    description: 'Председателят не записа забележката в протокола.',
    place,
    photos: [],
    ...patch,
  })
  if (typeof parsed === 'string') throw new Error(parsed)
  return parsed
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('signal to the API', () => {
  it('writes phones the way the API accepts them', () => {
    expect(apiPhone('0888123456')).toBe('+359888123456')
    expect(apiPhone('0888 123 456')).toBe('+359888123456')
    expect(apiPhone('00359888123456')).toBe('+359888123456')
    expect(apiPhone('359888123456')).toBe('+359888123456')
    expect(apiPhone('+44 7700 900123')).toBe('+447700900123')
  })

  it('builds the old form body: town code, optional section, picture ids', () => {
    const parsed = valid()
    expect(violationBody(parsed.payload, ['p1', 'p2'])).toEqual({
      town: 68134,
      section: '234615001',
      description: 'Председателят не записа забележката в протокола.',
      name: 'Иван Иванов',
      email: 'ivan@example.com',
      phone: '+359888123456',
      type: 'standard',
      pictures: ['p1', 'p2'],
    })
    const noSection = valid({ place: { ...place, sectionId: undefined } })
    const body = violationBody(noSection.payload, [])
    expect(body).not.toHaveProperty('section')
    expect(body).not.toHaveProperty('pictures')
  })

  it('refuses what the API would refuse', () => {
    const base = { name: 'Иван', email: 'ivan@example.com', phone: '0888123456', place, photos: [] }
    expect(validateViolation({ ...base, description: 'а'.repeat(2001) })).toMatch(/2000/)
    expect(validateViolation({ ...base, description: 'а'.repeat(30), place: { ...place, townId: undefined } })).toMatch(/населено място/)
    expect(validateViolation({ ...base, description: 'а'.repeat(30), place: { ...place, sectionId: '12' } })).toMatch(/Секцията/)
  })

  it('uploads pictures first, then the violation with their ids', async () => {
    const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = []
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> })
      if (url.endsWith('/pictures')) return json(201, { id: `pic${calls.length}`, url: `https://tibroish.bg/photos/k${calls.length}.jpg` })
      return json(201, { id: '01TESTVIOLATION0000000000', secret: 's3cr3t' })
    }
    const parsed = valid({ photos: [jpeg, jpeg] })
    const result = await sendViolation(parsed.payload, parsed.photos, { fetch: fetcher, recaptcha: async (action) => `t-${action}` })
    expect(result).toEqual({
      ok: true,
      id: '01TESTVIOLATION0000000000',
      secret: 's3cr3t',
      pictures: [
        { id: 'pic1', url: 'https://tibroish.bg/photos/k1.jpg' },
        { id: 'pic2', url: 'https://tibroish.bg/photos/k2.jpg' },
      ],
    })
    expect(calls.map((call) => call.url)).toEqual([`${VIOLATIONS_API}/pictures`, `${VIOLATIONS_API}/pictures`, `${VIOLATIONS_API}/violations`])
    expect(calls[0].body.image).toMatch(/^data:image\/jpeg;base64,\/9j\//)
    expect(calls[0].headers['x-recaptcha-token']).toBe('t-sendViolationImage')
    expect(calls[2].body.pictures).toEqual(['pic1', 'pic2'])
    expect(calls[2].headers['x-recaptcha-token']).toBe('t-sendViolation')
    expect(calls[2].headers['Accept-Language']).toBe('bg-BG')
  })

  it('sends no recaptcha header when it is off', async () => {
    let headers: Record<string, string> = {}
    const parsed = valid()
    await sendViolation(parsed.payload, parsed.photos, {
      fetch: async (_url, init) => {
        headers = init?.headers as Record<string, string>
        return json(201, { id: 'v1', secret: 's' })
      },
    })
    expect(headers).not.toHaveProperty('x-recaptcha-token')
  })

  it('stops before the violation when a picture fails', async () => {
    const urls: string[] = []
    const parsed = valid({ photos: [jpeg] })
    const result = await sendViolation(parsed.payload, parsed.photos, {
      fetch: async (url) => {
        urls.push(url)
        return json(400, { statusCode: 400, message: ['errors.image should not be empty'] })
      },
    })
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/^Снимките не се качиха\. Снимката не се чете/) })
    expect(urls).toEqual([`${VIOLATIONS_API}/pictures`])
  })

  it('turns API validation errors into Bulgarian', () => {
    const body = {
      statusCode: 400,
      message: [
        'errors.section.id must be a number string',
        'errors.section.Section with ID "x" does not exist!',
        'errors.town.Town with code "999999999" does not exist!',
        'errors.description must be longer than or equal to 20 characters',
        'errors.email must be an email',
        'Телефонният номер е невалиден',
      ],
    }
    const message = apiErrorMessage(400, body)
    expect(message).toContain('Секцията не е намерена.')
    expect(message).toContain('Населеното място не е намерено.')
    expect(message).toContain('Описанието трябва да е между 20 и 2000 знака.')
    expect(message).toContain('Напиши валиден имейл.')
    expect(message).toContain('Телефонният номер е невалиден.')
    expect(message.match(/Секцията/g)).toHaveLength(1)
    expect(message).not.toMatch(/errors\./)
    expect(apiErrorMessage(500, null)).toMatch(/не отговаря/)
    expect(apiErrorMessage(400, { message: 'Invalid reCAPTCHA' })).toMatch(/ботове/)
    expect(apiErrorMessage(400, { message: 'something new' })).toMatch(/Провери полетата/)
  })

  it('reports a network failure without throwing', async () => {
    const parsed = valid()
    const result = await sendViolation(parsed.payload, parsed.photos, {
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/не отговаря/) })
  })
})
