import { describe, expect, it } from 'vitest'
import { schemaFingerprint } from './schema-version'

describe('schemaFingerprint', () => {
  it('is stable for the same statements', () => {
    expect(schemaFingerprint(['CREATE TABLE a (x)', ['CREATE INDEX i ON a(x)']])).toBe(schemaFingerprint(['CREATE TABLE a (x)', ['CREATE INDEX i ON a(x)']]))
  })

  it('changes when a statement changes, is added or moves', () => {
    const base = schemaFingerprint(['CREATE TABLE a (x)', 'CREATE INDEX i ON a(x)'])
    expect(schemaFingerprint(['CREATE TABLE a (y)', 'CREATE INDEX i ON a(x)'])).not.toBe(base)
    expect(schemaFingerprint(['CREATE TABLE a (x)', 'CREATE INDEX i ON a(x)', 'CREATE TABLE b (x)'])).not.toBe(base)
    expect(schemaFingerprint(['CREATE INDEX i ON a(x)', 'CREATE TABLE a (x)'])).not.toBe(base)
    expect(schemaFingerprint(['CREATE TABLE a (x)CREATE INDEX i ON a(x)'])).not.toBe(base)
  })
})
