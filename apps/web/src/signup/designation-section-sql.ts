/**
 * The section a volunteer's пълномощно is drawn for: the published section, or, for a volunteer who
 * already holds a number but has no published section yet, the number's МИР (as for „И аз“: the
 * document names only the МИР). A volunteer added from a coordinator's list is numbered in their МИР
 * before allocation, so they can be signed and filed with the РИК before Секции publishes a section.
 * Client-safe: an SQL string only.
 */
export const SIGNUP_DESIGNATION_SECTION_SQL = `COALESCE(NULLIF(published_section, ''), CASE WHEN designation_number IS NOT NULL THEN NULLIF(designation_mir, '') END, '')`

/** Placeholder address for a volunteer added without an e-mail (…@tibroish.invalid). Never sent to Brevo. */
export { isPlaceholderEmail } from './no-email'
