import { describe, expect, it } from 'vitest'
import { roleAllows } from './staff'
import {
  contentDisposition,
  httpStatusForStaffDenial,
  namesFromPayload,
  personIdOk,
  previewNumber,
  previewPersonInput,
} from './designation-preview'

describe('designation admin preview helpers', () => {
  it('maps staff denials to HTTP statuses used by the PDF route', () => {
    expect(httpStatusForStaffDenial('signed-out')).toBe(401)
    expect(httpStatusForStaffDenial('unconfirmed')).toBe(401)
    expect(httpStatusForStaffDenial('forbidden')).toBe(403)
    expect(httpStatusForStaffDenial('nodb')).toBe(503)
    expect(roleAllows('viewer', 'view')).toBe(true)
    expect(roleAllows(null, 'view')).toBe(false)
  })

  it('accepts signup ids and reads names from the payload', () => {
    expect(personIdOk('abc-1')).toBe(true)
    expect(personIdOk('../etc/passwd')).toBe(false)
    expect(namesFromPayload('{"firstName":"Иван","middleName":"Петров","lastName":"Иванов"}')).toEqual({
      firstName: 'Иван',
      middleName: 'Петров',
      lastName: 'Иванов',
    })
    const person = previewPersonInput({
      payload: '{"firstName":"Иван","lastName":"Иванов"}',
      egn: '0000000000',
      published_section: '234600001',
      section_place: 'гр. София',
    })
    expect(person.sectionCode).toBe('234600001')
    expect(previewNumber(null)).toBe(null)
    expect(previewNumber(4)).toBe(4)
    expect(contentDisposition('Пълномощно 1 – Иван.pdf')).toContain("filename*=UTF-8''")
    expect(contentDisposition('Пълномощно 1 – Иван.pdf')).not.toContain('0000000000')
  })
})
