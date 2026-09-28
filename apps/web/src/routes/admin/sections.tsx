import { createFileRoute } from '@tanstack/react-router'
import { parseSectionSearch } from '../../signup/admin-search'
import { SectionsPage } from './-sections-page'

export const Route = createFileRoute('/admin/sections')({
  validateSearch: (search: Record<string, unknown>) => parseSectionSearch(search),
  component: SectionsPage,
})
