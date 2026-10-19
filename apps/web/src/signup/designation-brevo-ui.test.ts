import { describe, expect, it } from 'vitest'
import { brevoCountsLine, uploadBrevoCell, uploadBrevoOf, uploadSummary } from './designation-brevo-ui'

describe('upload Brevo result', () => {
  it('reads the brevo field of an upload response', () => {
    expect(uploadBrevoOf({ ok: true, brevo: { ok: true, attribute: 'DOCUMENT_URL' } })).toEqual({ ok: true, attribute: 'DOCUMENT_URL', created: false })
    expect(uploadBrevoOf({ ok: true, brevo: { ok: false, attribute: 'DOCUMENT_URL', error: 'Key not found' } })).toEqual({
      ok: false,
      attribute: 'DOCUMENT_URL',
      skipped: false,
      error: 'Key not found',
    })
  })

  it('treats a response without brevo as not synced, never as success', () => {
    expect(uploadBrevoOf({ ok: true })).toEqual({ ok: false, attribute: 'DOCUMENT_URL', error: 'сървърът не върна резултат за Brevo' })
  })

  it('labels the Brevo cell', () => {
    expect(uploadBrevoCell({ ok: true, attribute: 'DOCUMENT_URL' })).toBe('обновен')
    expect(uploadBrevoCell({ ok: true, attribute: 'DOCUMENT_URL', created: true })).toBe('създаден контакт')
    expect(uploadBrevoCell({ ok: false, attribute: 'DOCUMENT_URL', skipped: true, error: 'липсва BREVO_API_KEY' })).toBe('пропуснат: липсва BREVO_API_KEY')
    expect(uploadBrevoCell({ ok: false, attribute: 'DOCUMENT_URL', error: 'x' })).toBe('грешка: x')
  })
})

describe('Brevo summary lines', () => {
  it('counts updated and failed with distinct reasons and the total', () => {
    expect(brevoCountsLine('DOCUMENT_URL', 85, ['a', 'a'], 87)).toBe('Brevo (DOCUMENT_URL): 85 обновени / 2 грешки: a')
    expect(brevoCountsLine('DOCUMENT_URL', 80, ['a'], 87)).toBe('Brevo (DOCUMENT_URL): 80 обновени / 1 грешки (от 87): a')
    expect(brevoCountsLine('DOCUMENT_URL', 87, [], 87)).toBe('Brevo (DOCUMENT_URL): 87 обновени / 0 грешки.')
  })

  it('summarises a bulk upload with its Brevo outcome', () => {
    expect(uploadSummary(2, [{ ok: true, attribute: 'DOCUMENT_URL' }, { ok: true, attribute: 'DOCUMENT_URL', created: true }])).toEqual({
      tone: 'ok',
      text: 'Качени 2 от 2; Brevo (DOCUMENT_URL): 2 обновени / 0 грешки.',
    })
    expect(uploadSummary(2, [{ ok: false, attribute: 'DOCUMENT_URL', error: 'Key not found' }])).toEqual({
      tone: 'error',
      text: 'Качени 1 от 2; Brevo (DOCUMENT_URL): 0 обновени / 1 грешки: Key not found',
    })
    expect(uploadSummary(1, [])).toEqual({ tone: 'error', text: 'Качени 0 от 1.' })
  })
})
