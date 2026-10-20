import { describe, expect, it } from 'vitest'
import { adminProfileIdFor } from './partner-people-sql'

describe('admin profile links on Пълномощни', () => {
  it('links signups to their profile and never „И аз“ partner people', () => {
    expect(adminProfileIdFor('e2e-maria')).toBe('e2e-maria')
    expect(adminProfileIdFor('pp-abc')).toBeNull()
    expect(adminProfileIdFor('')).toBeNull()
  })
})
