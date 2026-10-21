/**
 * Which numbered people a „за подпис“ ZIP holds. Client-safe (no Worker imports).
 *
 * - `new`: numbered, no signed file, never in a ZIP for signing (designation_signing_generated_at).
 * - `unsigned`: numbered, no signed file.
 * - `all`: everyone numbered (the old behaviour, still the server default for bare links).
 */
export type SignScope = 'new' | 'unsigned' | 'all'

export const SIGN_SCOPES: SignScope[] = ['new', 'unsigned', 'all']

export const SIGN_SCOPE_LABELS: Record<SignScope, string> = {
  new: 'Само новите',
  unsigned: 'Без подписан файл',
  all: 'Всички',
}

export const SIGN_SCOPE_HINTS: Record<SignScope, string> = {
  new: 'Номерирани, без подписан файл и още не свалени за подпис.',
  unsigned: 'Всички номерирани без подписан файл, и вече свалените.',
  all: 'Всички номерирани, и подписаните.',
}

export type SignScopeCounts = Record<SignScope, number>

export function parseSignScope(value: string | null | undefined): SignScope {
  return value === 'new' || value === 'unsigned' ? value : 'all'
}

/** WHERE fragment for one row of signups or partner_people (no leading AND). */
export function signScopeWhere(scope: SignScope) {
  if (scope === 'new') return 'designation_signed_at IS NULL AND designation_signing_generated_at IS NULL'
  if (scope === 'unsigned') return 'designation_signed_at IS NULL'
  return '1 = 1'
}

/** Count one person into every scope it belongs to. */
export function addToSignScopeCounts(
  counts: SignScopeCounts,
  person: { number: number | null; signedAt: string | null; signingGeneratedAt: string | null },
) {
  if (person.number == null) return counts
  counts.all += 1
  if (!person.signedAt) {
    counts.unsigned += 1
    if (!person.signingGeneratedAt) counts.new += 1
  }
  return counts
}

export function emptySignScopeCounts(): SignScopeCounts {
  return { new: 0, unsigned: 0, all: 0 }
}

/**
 * `new` shrinks as each ZIP marks its people, so it always starts at offset 0 and offers one
 * „next batch“ link; the other scopes keep fixed offsets.
 */
export function signScopeBatches(scope: SignScope, count: number, size: number) {
  const step = Math.max(1, Math.floor(size) || 1)
  if (count <= 0) return []
  if (scope === 'new') {
    const limit = Math.min(step, count)
    return [{ offset: 0, limit, from: 1, to: limit }]
  }
  const batches: Array<{ offset: number; limit: number; from: number; to: number }> = []
  for (let offset = 0; offset < count; offset += step) {
    const limit = Math.min(step, count - offset)
    batches.push({ offset, limit, from: offset + 1, to: offset + limit })
  }
  return batches
}

/** Added at runtime by db-core and in sql/2026-10-21-signing-generated.sql. */
export const SIGNING_GENERATED_COLUMNS = [
  'ALTER TABLE signups ADD COLUMN designation_signing_generated_at TEXT',
  'ALTER TABLE partner_people ADD COLUMN designation_signing_generated_at TEXT',
]
