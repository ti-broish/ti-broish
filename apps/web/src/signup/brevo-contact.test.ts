import { describe, expect, it } from 'vitest'
import {
  BREVO_ROLE_LABELS,
  BREVO_SECTIONS_HEADERS,
  brevoAttributesForApi,
  brevoContactCsvCells,
  brevoRoleLabel,
  buildBrevoContact,
  normalizeBrevoSms,
} from './brevo-contact'

describe('BREVO_ROLE_LABELS', () => {
  it('maps signup roles to Brevo labels', () => {
    expect(BREVO_ROLE_LABELS.section).toBe('Представител')
    expect(BREVO_ROLE_LABELS.mobile).toBe('Представител')
    expect(BREVO_ROLE_LABELS.video).toBe('Наблюдател')
    expect(brevoRoleLabel('section')).toBe('Представител')
    expect(brevoRoleLabel('video')).toBe('Наблюдател')
    expect(brevoRoleLabel('')).toBe('')
    expect(brevoRoleLabel('unknown')).toBe('')
  })
})

describe('normalizeBrevoSms', () => {
  it('normalizes Bulgarian and international phones to +E.164', () => {
    expect(normalizeBrevoSms('0888 123 456')).toBe('+359888123456')
    expect(normalizeBrevoSms('359888123456')).toBe('+359888123456')
    expect(normalizeBrevoSms('00359888123456')).toBe('+359888123456')
    expect(normalizeBrevoSms('+44 7123 456789')).toBe('+447123456789')
    expect(normalizeBrevoSms('888123456')).toBe('+359888123456')
    expect(normalizeBrevoSms('')).toBe('')
    expect(normalizeBrevoSms('12')).toBe('')
    expect(normalizeBrevoSms('not-a-phone')).toBe('')
  })
})

describe('buildBrevoContact', () => {
  it('builds published section attributes with zero-padded MIR and ROLE label', () => {
    const contact = buildBrevoContact({
      email: ' Ivan@Example.com ',
      firstName: 'Иван',
      lastName: 'Иванов',
      phone: '0888 123 456',
      mir: '3',
      publishedSection: '034600101',
      sectionAddress: 'ул. Пример 1',
      sectionPlace: 'гр.София',
      role: 'section',
      sectionPublished: true,
    })
    expect(contact.email).toBe('ivan@example.com')
    expect(contact.attributes.SMS).toBe('+359888123456')
    expect(contact.attributes.MIR).toBe('03')
    expect(contact.attributes.SECTION_ID).toBe(34600101)
    expect(contact.attributes.SECTION_CODE).toBe('034600101')
    expect(contact.attributes.SECTION_ID_TEXT).toBe('034600101')
    expect(contact.attributes.ROLE).toBe('Представител')
    expect(contact.attributes.SECTION_PUBLISHED).toBe(true)
  })

  it('falls back MIR from section and omits section ids when unpublished', () => {
    const contact = buildBrevoContact({
      email: 'a@example.com',
      firstName: 'А',
      lastName: 'Б',
      phone: '',
      mir: '',
      publishedSection: '234600101',
      sectionAddress: '',
      sectionPlace: '',
      role: 'video',
      sectionPublished: false,
    })
    expect(contact.attributes.MIR).toBe('23')
    expect(contact.attributes.SECTION_ID).toBeUndefined()
    expect(contact.attributes.SECTION_CODE).toBeUndefined()
    expect(contact.attributes.ROLE).toBe('Наблюдател')
    expect(contact.attributes.SECTION_PUBLISHED).toBe(false)
  })

  it('omits empty strings for API but keeps SECTION_PUBLISHED', () => {
    const contact = buildBrevoContact({
      email: 'a@example.com',
      firstName: '',
      lastName: 'Б',
      phone: 'bad',
      mir: '',
      publishedSection: '',
      sectionAddress: '',
      sectionPlace: 'място',
      role: '',
      sectionPublished: false,
    })
    const api = brevoAttributesForApi(contact.attributes)
    expect(api.SECTION_PUBLISHED).toBe(false)
    expect(api.LASTNAME).toBe('Б')
    expect(api.SECTION_PLACE).toBe('място')
    expect(api).not.toHaveProperty('FIRSTNAME')
    expect(api).not.toHaveProperty('SMS')
    expect(api).not.toHaveProperty('ROLE')
    expect(api).not.toHaveProperty('SECTION_ID')
  })

  it('csv cells follow the shared header order', () => {
    const contact = buildBrevoContact({
      email: 'a@example.com',
      firstName: 'А',
      lastName: 'Б',
      phone: '0888123456',
      mir: '23',
      publishedSection: '234600101',
      sectionAddress: 'адрес',
      sectionPlace: 'място',
      role: 'mobile',
      sectionPublished: true,
    })
    const cells = brevoContactCsvCells(contact)
    expect(BREVO_SECTIONS_HEADERS).toHaveLength(cells.length)
    expect(cells[0]).toBe('a@example.com')
    expect(cells[5]).toBe('234600101')
    expect(cells[6]).toBe('234600101')
    expect(cells[7]).toBe('234600101')
    expect(cells[10]).toBe('Представител')
    expect(cells[11]).toBe('true')
  })
})

describe('PALNOMOSHTNO_URL', () => {
  const base = {
    email: 'a@example.com',
    firstName: 'А',
    lastName: 'Б',
    phone: '',
    mir: '23',
    publishedSection: '234600101',
    sectionAddress: '',
    sectionPlace: '',
    role: 'section',
    sectionPublished: true,
  }

  it('goes to the API when a link is stored, never into the CSV', () => {
    const contact = buildBrevoContact({ ...base, palnomoshtnoUrl: ' https://drive.google.com/file/d/x/view ' })
    expect(brevoAttributesForApi(contact.attributes).PALNOMOSHTNO_URL).toBe('https://drive.google.com/file/d/x/view')
    expect(brevoContactCsvCells(contact)).toHaveLength(BREVO_SECTIONS_HEADERS.length)
  })

  it('is left out when there is no link, so Brevo keeps its value', () => {
    const contact = buildBrevoContact(base)
    expect('PALNOMOSHTNO_URL' in brevoAttributesForApi(contact.attributes)).toBe(false)
  })
})
