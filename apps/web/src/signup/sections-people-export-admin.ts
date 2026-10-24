import { createServerFn } from '@tanstack/react-start'

/** „Секции с хора“ CSV (admins): every section with at least one person, one row per person, no ЕГН. */
export const adminSectionsPeopleExport = createServerFn({ method: 'POST' }).handler(async () => {
  const { handleSectionsPeopleExport } = await import('./sections-people-export.server')
  return handleSectionsPeopleExport()
})
