import { describe, expect, it } from 'vitest'
import { addToSignScopeCounts, emptySignScopeCounts, parseSignScope, signScopeBatches, signScopeWhere } from './designation-sign-scope'

describe('signing ZIP scope', () => {
  it('defaults bare links to all', () => {
    expect(parseSignScope(null)).toBe('all')
    expect(parseSignScope('new')).toBe('new')
    expect(parseSignScope('unsigned')).toBe('unsigned')
    expect(parseSignScope('x')).toBe('all')
  })

  it('counts new as numbered, unsigned and never zipped for signing', () => {
    const rows = [
      { number: 501, signedAt: '2026-10-20', signingGeneratedAt: '2026-10-19' },
      { number: 502, signedAt: null, signingGeneratedAt: null },
      { number: 503, signedAt: null, signingGeneratedAt: '2026-10-21' },
      { number: null, signedAt: null, signingGeneratedAt: null },
    ]
    expect(rows.reduce(addToSignScopeCounts, emptySignScopeCounts())).toEqual({ new: 1, unsigned: 2, all: 3 })
  })

  it('new always reads one next batch from 0; others page by offset', () => {
    expect(signScopeBatches('new', 250, 100)).toEqual([{ offset: 0, limit: 100, from: 1, to: 100 }])
    expect(signScopeBatches('new', 0, 100)).toEqual([])
    expect(signScopeBatches('unsigned', 150, 100).map((b) => b.offset)).toEqual([0, 100])
  })

  it('filters in SQL', () => {
    expect(signScopeWhere('new')).toContain('designation_signing_generated_at IS NULL')
    expect(signScopeWhere('unsigned')).toBe('designation_signed_at IS NULL')
    expect(signScopeWhere('all')).toBe('1 = 1')
  })
})
