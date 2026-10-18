import { describe, expect, it } from 'vitest'
import {
  checkBrevoAttributes,
  checkBrevoSender,
  chunkContacts,
  convertRoleForBrevo,
  mapBrevoHttpError,
  maskEmail,
  parseBrevoUnauthorisedIp,
  type BrevoImportContact,
} from './brevo-sync'

describe('chunkContacts', () => {
  it('splits by contact count', () => {
    const contacts = Array.from({ length: 2500 }, (_, index) => ({
      email: `u${index}@example.com`,
      attributes: { FIRSTNAME: 'A' },
    }))
    const batches = chunkContacts(contacts, 1000, 5 * 1024 * 1024)
    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(1000)
    expect(batches[1]).toHaveLength(1000)
    expect(batches[2]).toHaveLength(500)
  })

  it('splits further when serialised size exceeds the byte budget', () => {
    const fat: BrevoImportContact = {
      email: 'fat@example.com',
      attributes: { NOTE: 'x'.repeat(2000) },
    }
    const contacts = Array.from({ length: 5 }, () => ({ ...fat, attributes: { ...fat.attributes } }))
    const batches = chunkContacts(contacts, 1000, 5000)
    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) {
      expect(JSON.stringify(batch).length).toBeLessThanOrEqual(5000 + 200) // small slack for wrapper
      expect(batch.length).toBeGreaterThan(0)
    }
  })
})

describe('convertRoleForBrevo', () => {
  const category = {
    name: 'ROLE',
    type: 'category',
    enumeration: [
      { value: 1, label: 'Наблюдател' },
      { value: 2, label: 'Представител' },
    ],
  }

  it('uses enumeration value for category attributes', () => {
    expect(convertRoleForBrevo('Представител', category)).toEqual({ ok: true, value: 2 })
  })

  it('uses label array for multiple-choice', () => {
    expect(convertRoleForBrevo('Наблюдател', { name: 'ROLE', type: 'multiple-choice' })).toEqual({
      ok: true,
      value: ['Наблюдател'],
    })
  })

  it('uses plain string for text', () => {
    expect(convertRoleForBrevo('Представител', { name: 'ROLE', type: 'text' })).toEqual({
      ok: true,
      value: 'Представител',
    })
  })

  it('omits unknown category labels with a warning', () => {
    const result = convertRoleForBrevo('Друго', category)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.warning).toContain('Друго')
  })
})

describe('checkBrevoAttributes', () => {
  it('accepts a complete attribute set', () => {
    const attrs = [
      { name: 'SECTION_ID', type: 'float' },
      { name: 'SECTION_CODE', type: 'text' },
      { name: 'SECTION_ID_TEXT', type: 'text' },
      { name: 'MIR', type: 'text' },
      {
        name: 'ROLE',
        type: 'category',
        enumeration: [
          { value: 1, label: 'Наблюдател' },
          { value: 2, label: 'Представител' },
        ],
      },
      { name: 'FIRSTNAME', type: 'text' },
      { name: 'LASTNAME', type: 'text' },
      { name: 'SMS', type: 'text' },
      { name: 'SECTION_ADDRESS', type: 'text' },
      { name: 'SECTION_PLACE', type: 'text' },
      { name: 'SECTION_PUBLISHED', type: 'boolean' },
      { name: 'PALNOMOSHTNO_URL', type: 'text' },
    ]
    expect(checkBrevoAttributes(attrs).ok).toBe(true)
  })

  it('reports missing, wrong type and ROLE label gaps', () => {
    const result = checkBrevoAttributes([
      { name: 'SECTION_ID', type: 'text' },
      {
        name: 'ROLE',
        type: 'category',
        enumeration: [{ value: 1, label: 'Наблюдател' }],
      },
      { name: 'FIRSTNAME', type: 'text' },
    ])
    expect(result.ok).toBe(false)
    expect(result.missing).toContain('SECTION_CODE')
    expect(result.wrongType.some((item) => item.name === 'SECTION_ID')).toBe(true)
    expect(result.roleLabelGaps).toContain('Представител')
  })
})

describe('parseBrevoUnauthorisedIp', () => {
  it('extracts the blocked IP into a Bulgarian message', () => {
    const message = parseBrevoUnauthorisedIp('unrecognised IP address 203.0.113.10')
    expect(message).toContain('203.0.113.10')
    expect(message).toContain('Authorised IPs')
  })

  it('returns null when there is no IP denial', () => {
    expect(parseBrevoUnauthorisedIp('Key not found')).toBeNull()
  })
})

describe('mapBrevoHttpError', () => {
  it('maps key-not-found 401', () => {
    expect(mapBrevoHttpError(401, 'Key not found')).toContain('невалиден')
  })

  it('maps unrecognised IP 401', () => {
    expect(mapBrevoHttpError(401, 'unrecognised IP address 1.2.3.4')).toContain('1.2.3.4')
  })
})

describe('checkBrevoSender', () => {
  it('flags a missing or inactive sender', () => {
    expect(checkBrevoSender([], 'team@tibroish.bg').found).toBe(false)
    expect(checkBrevoSender([{ email: 'team@tibroish.bg', active: false }], 'team@tibroish.bg').active).toBe(false)
    expect(checkBrevoSender([{ email: 'team@tibroish.bg', active: true, verified: true }], 'team@tibroish.bg').active).toBe(true)
    expect(checkBrevoSender([{ email: 'team@tibroish.bg', active: true }], 'team@tibroish.bg').active).toBe(true)
  })
})

describe('maskEmail', () => {
  it('masks the local part', () => {
    expect(maskEmail('ivan@example.com')).toBe('i***@example.com')
  })
})

describe('Brevo attribute shapes as the API returns them', () => {
  const categoryRole = {
    name: 'ROLE',
    category: 'category',
    type: 'text',
    enumeration: [
      { value: 1, label: 'Наблюдател' },
      { value: 2, label: 'Представител' },
    ],
  }
  const multiRole = {
    name: 'ROLE',
    category: 'normal',
    type: 'multiple-choice',
    multiCategoryOptions: ['Наблюдател', 'Представител'],
  }

  it('treats category "category" as single choice even when type is text', () => {
    expect(convertRoleForBrevo('Наблюдател', categoryRole)).toEqual({ ok: true, value: 1 })
  })

  it('checks multiple-choice options and sends an array', () => {
    expect(convertRoleForBrevo('Представител', multiRole)).toEqual({ ok: true, value: ['Представител'] })
    expect(convertRoleForBrevo('Друго', multiRole).ok).toBe(false)
  })

  it('accepts ROLE as category or multiple-choice with both labels', () => {
    const base = [
      { name: 'SECTION_ID', category: 'normal', type: 'float' },
      { name: 'SECTION_CODE', category: 'normal', type: 'text' },
      { name: 'SECTION_ID_TEXT', category: 'normal', type: 'text' },
      { name: 'MIR', category: 'normal', type: 'text' },
      { name: 'FIRSTNAME', category: 'normal', type: 'text' },
      { name: 'LASTNAME', category: 'normal', type: 'text' },
      { name: 'SMS', category: 'normal', type: 'text' },
      { name: 'SECTION_ADDRESS', category: 'normal', type: 'text' },
      { name: 'SECTION_PLACE', category: 'normal', type: 'text' },
      { name: 'SECTION_PUBLISHED', category: 'normal', type: 'boolean' },
      { name: 'PALNOMOSHTNO_URL', category: 'normal', type: 'text' },
    ]
    expect(checkBrevoAttributes([...base, categoryRole]).ok).toBe(true)
    expect(checkBrevoAttributes([...base, multiRole]).ok).toBe(true)
    const textRole = checkBrevoAttributes([...base, { name: 'ROLE', category: 'normal', type: 'text' }])
    expect(textRole.wrongType.map((item) => item.name)).toEqual(['ROLE'])
    const gap = checkBrevoAttributes([...base, { ...multiRole, multiCategoryOptions: ['Представител'] }])
    expect(gap.roleLabelGaps).toEqual(['Наблюдател'])
    const wrongNumber = checkBrevoAttributes([...base.filter((item) => item.name !== 'SECTION_ID'), { name: 'SECTION_ID', category: 'normal', type: 'text' }, categoryRole])
    expect(wrongNumber.wrongType.map((item) => item.name)).toEqual(['SECTION_ID'])
  })
})
