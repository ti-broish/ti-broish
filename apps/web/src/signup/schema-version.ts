/**
 * The signup schema bootstrap is ~100 sequential D1 round trips. Run once per isolate, that
 * pushed past the 10 s deadline on prod (22.10.2026, v0.0.62: /admin hung while every request
 * retried a bootstrap that never finished). The DDL is idempotent, so it only needs to run when it
 * changed: its fingerprint is stored in app_meta and a matching value skips the whole DDL pass.
 */
export const SIGNUP_SCHEMA_META_KEY = 'signup_schema'

/** FNV-1a over every DDL statement (and helper source) the bootstrap runs, in order. */
export function schemaFingerprint(parts: ReadonlyArray<string | ReadonlyArray<string>>): string {
  let hash = 0x811c9dc5
  for (const part of parts.flat()) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    hash ^= 0x1f
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
