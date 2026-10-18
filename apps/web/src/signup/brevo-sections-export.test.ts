import { describe, expect, it } from 'vitest'
import { brevoSectionsScope } from './brevo-sections-export'

describe('brevoSectionsScope', () => {
  it('widens the unassigned and draft tabs to every published section', () => {
    expect(brevoSectionsScope({ view: 'unassigned', mir: '', q: '' })).toEqual({
      view: 'assigned',
      mir: '',
      q: '',
      label: 'Обхват: всички публикувани секции, цялата страна и чужбина.',
    })
    expect(brevoSectionsScope({ view: 'draft', mir: '23', q: '' }).view).toBe('assigned')
    expect(brevoSectionsScope({ view: 'draft', mir: '23', q: '' }).mir).toBe('')
    expect(brevoSectionsScope({ view: 'assigned', mir: '', q: '' }).view).toBe('assigned')
  })

  it('keeps the MIR filter', () => {
    const scope = brevoSectionsScope({ view: 'mir', mir: ' 23 ', q: '' })
    expect(scope).toMatchObject({ view: 'mir', mir: '23' })
    expect(scope.label).toContain('МИР 23')
  })

  it('keeps abroad', () => {
    const scope = brevoSectionsScope({ view: 'abroad', mir: '', q: '' })
    expect(scope.view).toBe('abroad')
    expect(scope.label).toContain('Чужбина')
  })

  it('keeps the search text', () => {
    const scope = brevoSectionsScope({ view: 'mir', mir: '24', q: '  Петрова ' })
    expect(scope.q).toBe('Петрова')
    expect(scope.label).toBe('Обхват: всички публикувани секции, МИР 24, търсене „Петрова“.')
  })
})
