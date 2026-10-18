import type { SectionSearch } from './admin-search'

export const BREVO_SECTIONS_BUTTON = 'CSV за Brevo: секции и адреси'

export const BREVO_SECTIONS_HINT =
  'Обновява съществуващи контакти в Brevo по EMAIL с атрибути FIRSTNAME, LASTNAME, SMS, MIR, SECTION, SECTION_ADDRESS, SECTION_PLACE, ROLE, SECTION_PUBLISHED. Само хора с публикувана секция, които не са се отказали.'

export type BrevoSectionsScope = {
  view: 'assigned' | 'abroad' | 'mir'
  mir: string
  q: string
  label: string
}

/**
 * The Brevo sections file only carries published sections. On Секции the
 * „Без секция“ and „Чернова“ tabs would export nothing useful, so they widen to
 * every published section. МИР, Чужбина and the search box narrow the file.
 */
export function brevoSectionsScope(search: Pick<SectionSearch, 'view' | 'mir' | 'q'>): BrevoSectionsScope {
  const q = search.q.trim()
  const mir = search.mir.trim()
  const view = search.view === 'mir' ? 'mir' : search.view === 'abroad' ? 'abroad' : 'assigned'
  const where = view === 'mir' ? `МИР ${mir || '—'}` : view === 'abroad' ? 'Чужбина' : 'цялата страна и чужбина'
  const label = `Обхват: всички публикувани секции, ${where}${q ? `, търсене „${q}“` : ''}.`
  return { view, mir: view === 'mir' ? mir : '', q, label }
}
